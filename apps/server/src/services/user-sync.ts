import type {
  HarnessId,
  TransferConflict,
  TransferConflictPolicy,
  UserSyncPreview,
  UserSyncResponse,
} from '@seaveyon/harness-switch-shared';
import { HttpError } from '../common/errors';
import { createDecorator, inject } from '../di';
import { IActivationService } from './activation';
import { ICodexLoginCacheService } from './codex-login-cache';
import { ICryptoService } from './crypto';
import { IEnvironmentService, type LocalUser } from './environment';
import { IFileService } from './files';
import { ILiveWriteService, type PlannedWrite } from './live-write';
import type { ProfileStore, StoredProfile } from './profiles';
import { IUserService } from './users';
import type { VaultEntry, VaultStore } from './vault';

type PortableProvider = Omit<VaultEntry, 'api_key'> & { apiKey: string };
type PortableProfile = Omit<StoredProfile, 'api_key'> & { apiKey: string };
type PortableUserData = {
  profiles: Record<string, Record<string, PortableProfile>>;
  providers: Record<string, PortableProvider>;
};

export interface IUserSyncService {
  readonly _serviceBrand: undefined;
  preview(sourceUsername: string): UserSyncPreview;
  sync(
    sourceUsername: string,
    conflictPolicy: TransferConflictPolicy,
    migrateCodexLoginCache: boolean,
  ): UserSyncResponse;
}

export const IUserSyncService = createDecorator<IUserSyncService>('userSyncService');

@inject(
  IEnvironmentService,
  IUserService,
  IFileService,
  ICryptoService,
  ICodexLoginCacheService,
  ILiveWriteService,
  IActivationService,
)
export class UserSyncService implements IUserSyncService {
  declare readonly _serviceBrand: undefined;

  constructor(
    private readonly environment: IEnvironmentService,
    private readonly users: IUserService,
    private readonly files: IFileService,
    private readonly crypto: ICryptoService,
    private readonly codexLoginCache: ICodexLoginCacheService,
    private readonly liveWrite: ILiveWriteService,
    private readonly activation: IActivationService,
  ) {}

  preview(sourceUsername: string): UserSyncPreview {
    const target = this.environment.currentUser;
    const source = this.requireSource(sourceUsername, target);
    const portable = this.readPortable(source);
    const targetProfiles = this.readProfiles();
    const conflicts: TransferConflict[] = [];
    let profileCount = 0;
    const referencedProviders = new Set<string>();
    for (const [harness, profiles] of Object.entries(portable.profiles)) {
      for (const [name, profile] of Object.entries(profiles)) {
        profileCount++;
        if (targetProfiles[harness]?.[name]) {
          conflicts.push({ harness: harness as TransferConflict['harness'], name });
        }
        if (profile.provider_id) referencedProviders.add(profile.provider_id);
      }
    }
    return {
      sourceUser: source.username,
      targetUser: target.username,
      profileCount,
      providerCount: referencedProviders.size,
      conflicts,
      codexLoginCache: {
        available: this.environment.runAsUser(source, () => this.codexLoginCache.exists()),
        targetExists: this.codexLoginCache.exists(),
      },
    };
  }

  sync(
    sourceUsername: string,
    conflictPolicy: TransferConflictPolicy,
    migrateCodexLoginCache: boolean,
  ): UserSyncResponse {
    if (conflictPolicy !== 'skip' && conflictPolicy !== 'overwrite') {
      throw new HttpError(400, 'invalid conflict policy');
    }
    const target = this.environment.currentUser;
    const source = this.requireSource(sourceUsername, target);
    const portable = this.readPortable(source);
    const cacheContent = migrateCodexLoginCache
      ? this.environment.runAsUser(source, () => this.codexLoginCache.readOptional())
      : undefined;
    if (migrateCodexLoginCache && cacheContent === undefined) {
      throw new HttpError(400, '来源用户没有可迁移的 Codex 登录缓存');
    }
    const cacheWrite: PlannedWrite[] = cacheContent
      ? [
          {
            ...this.codexLoginCache.prepareWrite(cacheContent),
            format: 'json',
            secret: true,
          },
        ]
      : [];
    const profilesPath = this.environment.files.profiles;
    const vaultPath = this.environment.files.vault;
    const profileSnapshot = this.files.readOptional(profilesPath);
    const vaultSnapshot = this.files.readOptional(vaultPath);
    const targetProfiles = structuredClone(this.readProfiles());
    const targetVault = structuredClone(this.readVault());
    const active = this.files.readJson<Record<string, { name?: string }>>(
      this.environment.files.active,
      {},
    );
    const warnings: string[] = [];
    const activeProfilesToReapply = new Map<HarnessId, string>();

    let imported = 0;
    let overwritten = 0;
    let skipped = 0;
    const selected: Array<{ harness: string; name: string; profile: PortableProfile }> = [];
    for (const [harness, profiles] of Object.entries(portable.profiles)) {
      for (const [name, profile] of Object.entries(profiles)) {
        const exists = targetProfiles[harness]?.[name] !== undefined;
        if (exists && conflictPolicy === 'skip') {
          skipped++;
          continue;
        }
        selected.push({ harness, name, profile });
        if (exists) {
          overwritten++;
          if (active[harness]?.name === name) {
            activeProfilesToReapply.set(harness as HarnessId, name);
          }
        } else imported++;
      }
    }

    const providerMap = new Map<string, string>();
    for (const { profile } of selected) {
      const sourceId = profile.provider_id;
      if (!sourceId || providerMap.has(sourceId)) continue;
      const provider = portable.providers[sourceId];
      if (!provider) {
        // A cached profile credential is still sufficient; detach below rather
        // than creating a broken reference in the destination.
        continue;
      }
      const targetId = this.availableProviderId(sourceId, source.username, targetVault);
      providerMap.set(sourceId, targetId);
      const { apiKey, ...storedProvider } = provider;
      targetVault.entries[targetId] = {
        ...storedProvider,
        id: targetId,
        api_key: this.crypto.encrypt(apiKey),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        synced_from: { username: source.username, provider_id: sourceId },
      };
    }

    for (const { harness, name, profile } of selected) {
      targetProfiles[harness] ||= {};
      const mappedProvider = profile.provider_id ? providerMap.get(profile.provider_id) : undefined;
      const { apiKey, ...storedProfile } = profile;
      targetProfiles[harness]![name] = {
        ...storedProfile,
        api_key: this.crypto.encrypt(apiKey),
        provider_id: mappedProvider,
        provider_endpoint: mappedProvider ? profile.provider_endpoint : undefined,
        updated_at: new Date().toISOString(),
      };
    }

    this.liveWrite.transaction('codex', `同步-${source.username}`, cacheWrite, () => {
      try {
        this.files.writeJson(vaultPath, targetVault);
        this.files.writeJson(profilesPath, targetProfiles);
      } catch (error) {
        this.restore(vaultPath, vaultSnapshot);
        this.restore(profilesPath, profileSnapshot);
        throw error;
      }
    });

    for (const [harness, name] of activeProfilesToReapply) {
      try {
        const result = this.activation.activate(harness, name);
        warnings.push(...result.warnings.map((warning) => `${harness}/${name}: ${warning}`));
      } catch (error) {
        warnings.push(
          `${harness}/${name} 已更新配置库，但自动重新激活失败：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return {
      ok: true,
      sourceUser: source.username,
      targetUser: target.username,
      imported,
      overwritten,
      skipped,
      providersCopied: providerMap.size,
      codexLoginCacheMigrated: cacheWrite.length > 0,
      warnings,
    };
  }

  private requireSource(sourceUsername: string, target: LocalUser): LocalUser {
    const source = this.users.require(sourceUsername);
    if (source.username === target.username) {
      throw new HttpError(400, '来源用户不能与当前目标用户相同');
    }
    return source;
  }

  private readPortable(source: LocalUser): PortableUserData {
    return this.environment.runAsUser(source, () => {
      const profiles = this.readProfiles();
      const vault = this.readVault();
      const portableProviders: Record<string, PortableProvider> = {};
      for (const [id, entry] of Object.entries(vault.entries)) {
        portableProviders[id] = { ...entry, apiKey: this.crypto.decrypt(entry.api_key) };
      }
      const portableProfiles: PortableUserData['profiles'] = {};
      for (const [harness, entries] of Object.entries(profiles)) {
        portableProfiles[harness] = {};
        for (const [name, profile] of Object.entries(entries)) {
          const providerKey = profile.provider_id
            ? portableProviders[profile.provider_id]?.apiKey
            : undefined;
          portableProfiles[harness]![name] = {
            ...profile,
            apiKey: providerKey ?? this.crypto.decrypt(profile.api_key),
          };
        }
      }
      return { profiles: portableProfiles, providers: portableProviders };
    });
  }

  private readProfiles(): ProfileStore {
    return this.files.readJsonStrict<ProfileStore>(this.environment.files.profiles, {});
  }

  private readVault(): VaultStore {
    return this.files.readJsonStrict<VaultStore>(this.environment.files.vault, {
      version: 1,
      entries: {},
    });
  }

  private availableProviderId(
    sourceId: string,
    sourceUsername: string,
    target: VaultStore,
  ): string {
    const previous = Object.values(target.entries).find(
      (entry) =>
        entry.synced_from?.username === sourceUsername &&
        entry.synced_from.provider_id === sourceId,
    );
    if (previous) return previous.id;
    if (!target.entries[sourceId]) return sourceId;
    const suffix = sourceUsername
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .slice(0, 24);
    const base = `${sourceId}-${suffix || 'copy'}`.slice(0, 60);
    let candidate = base;
    let index = 2;
    while (target.entries[candidate]) {
      candidate = `${base}-${index}`.slice(0, 64);
      index++;
    }
    return candidate;
  }

  private restore(path: string, snapshot: string | undefined): void {
    try {
      if (snapshot === undefined) this.files.remove(path);
      else this.files.writeSecure(path, snapshot);
    } catch {
      // Preserve the original sync failure. The regular backup/diagnostic paths
      // can still surface a failed rollback for manual recovery.
    }
  }
}
