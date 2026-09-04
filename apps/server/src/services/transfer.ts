import {
  type CodexAuthJsonEffect,
  ERROR_CODES,
  type ErrorCode,
  HARNESS_IDS,
  type HarnessId,
  type LocalizedMessage,
  portablePayloadSchema,
  type TransferConflictPolicy,
  type TransferEnvelope,
  type TransferExportPreview,
  type TransferImportResponse,
  type TransferPreview,
  transferEnvelopeSchema,
  WARNING_CODES,
} from '@seaveyon/harness-switch-shared';
import type { ZodError, z } from 'zod';
import { HttpError } from '../common/errors';
import { createDecorator, inject } from '../di';
import { IActivationService } from './activation';
import { IAdapterRegistry } from './adapters';
import { ICodexLoginCacheService } from './codex-login-cache';
import { ICryptoService } from './crypto';
import { IEnvironmentService } from './environment';
import { IFileService } from './files';
import { ILiveWriteService, type PlannedWrite } from './live-write';
import type { ProfileStore, StoredProfile } from './profiles';
import type { VaultStore } from './vault';
import { IVaultService } from './vault';

const FORMAT = 'harness-switch-encrypted-export' as const;
const VERSION = 1 as const;
const MAX_ENCRYPTED_BYTES = 10 * 1024 * 1024;

/**
 * The export shapes, taken from the schema that validates them on the way back in.
 *
 * Declaring them separately is how an export ends up writing a field the importer
 * then rejects, so the writer and the reader share one definition. `PortableProvider`
 * is a vault entry with its credential in plaintext — only ever inside the envelope.
 */
type PortablePayload = z.infer<typeof portablePayloadSchema>;
type PortableProfile = PortablePayload['profiles'][number];
type PortableActive = PortablePayload['active'][number];

type ImportPlan = {
  store: ProfileStore;
  vault: VaultStore;
  imported: number;
  overwritten: number;
  skipped: number;
  providersCopied: number;
  codexActivationAuthEffect: CodexAuthJsonEffect;
};

export interface ITransferService {
  readonly _serviceBrand: undefined;
  exportPreview(): TransferExportPreview;
  exportAll(passphrase: string, includeCodexLoginCache?: boolean): TransferEnvelope;
  preview(
    envelope: TransferEnvelope,
    passphrase: string,
    conflictPolicy: TransferConflictPolicy,
    restoreActive: boolean,
  ): TransferPreview;
  importAll(
    envelope: TransferEnvelope,
    passphrase: string,
    conflictPolicy: TransferConflictPolicy,
    restoreActive: boolean,
    migrateCodexLoginCache?: boolean,
  ): TransferImportResponse;
}

export const ITransferService = createDecorator<ITransferService>('transferService');

@inject(
  IEnvironmentService,
  IFileService,
  ICryptoService,
  ICodexLoginCacheService,
  ILiveWriteService,
  IAdapterRegistry,
  IActivationService,
  IVaultService,
)
export class TransferService implements ITransferService {
  declare readonly _serviceBrand: undefined;

  constructor(
    private readonly environment: IEnvironmentService,
    private readonly files: IFileService,
    private readonly crypto: ICryptoService,
    private readonly codexLoginCache: ICodexLoginCacheService,
    private readonly liveWrite: ILiveWriteService,
    private readonly adapters: IAdapterRegistry,
    private readonly activation: IActivationService,
    private readonly vault: IVaultService,
  ) {}

  exportPreview(): TransferExportPreview {
    return { codexLoginCacheAvailable: this.codexLoginCache.exists() };
  }

  exportAll(passphrase: string, includeCodexLoginCache = true): TransferEnvelope {
    this.assertPassphrase(passphrase);
    const codexLoginCache = includeCodexLoginCache
      ? this.codexLoginCache.readOptional()
      : undefined;
    const store = this.readStore();
    const vault = this.readVault();
    const providers = Object.values(vault.entries).map((entry) => ({
      id: entry.id,
      name: entry.name,
      apiKey: this.crypto.decrypt(entry.api_key),
      notes: entry.notes,
      endpoints: entry.endpoints,
    }));
    const profiles: PortableProfile[] = [];
    for (const harness of HARNESS_IDS) {
      for (const [name, stored] of Object.entries(store[harness] ?? {})) {
        profiles.push({
          harness,
          name,
          baseUrl: stored.base_url || '',
          apiKey: this.resolveKey(stored),
          model: stored.model || '',
          notes: stored.notes || '',
          extras: stored.extras ?? {},
          overrides: stored.overrides ?? {},
          ...(stored.provider_id && vault.entries[stored.provider_id]
            ? {
                providerId: stored.provider_id,
                ...(stored.provider_endpoint ? { providerEndpoint: stored.provider_endpoint } : {}),
              }
            : {}),
        });
      }
    }
    const active = HARNESS_IDS.flatMap((harness) => {
      const entry = this.activation.getActive(harness);
      return entry
        ? [
            {
              harness,
              name: entry.name,
              official: entry.official === true,
            } satisfies PortableActive,
          ]
        : [];
    });
    return this.seal(
      {
        format: 'harness-switch-portable-config',
        version: VERSION,
        exportedAt: new Date().toISOString(),
        profiles,
        providers,
        active,
        codexLoginCache,
      },
      passphrase,
    );
  }

  preview(
    envelope: TransferEnvelope,
    passphrase: string,
    conflictPolicy: TransferConflictPolicy,
    restoreActive: boolean,
  ): TransferPreview {
    this.assertConflictPolicy(conflictPolicy);
    const payload = this.decrypt(envelope, passphrase);
    const existing = this.readStore();
    const plan = this.planImport(
      payload,
      existing,
      this.readVault(),
      conflictPolicy,
      restoreActive,
    );
    const targetCodexLoginCacheExists = this.codexLoginCache.exists();
    return {
      exportedAt: payload.exportedAt,
      profileCount: payload.profiles.length,
      providerCount: payload.providers?.length ?? 0,
      harnesses: HARNESS_IDS.map((harness) => ({
        harness,
        profiles: payload.profiles.filter((profile) => profile.harness === harness).length,
      })).filter((item) => item.profiles > 0),
      conflicts: payload.profiles
        .filter((profile) => existing[profile.harness]?.[profile.name] !== undefined)
        .map(({ harness, name }) => ({ harness, name })),
      activeCount: payload.active.length,
      conflictPolicy,
      restoreActive,
      codexActivationAuthEffect: plan.codexActivationAuthEffect,
      codexLoginCache: {
        available: payload.codexLoginCache !== undefined,
        targetExists: targetCodexLoginCacheExists,
        migrationNeeded:
          payload.codexLoginCache !== undefined &&
          !this.codexLoginCache.matchesCurrent(payload.codexLoginCache),
      },
    };
  }

  importAll(
    envelope: TransferEnvelope,
    passphrase: string,
    conflictPolicy: TransferConflictPolicy,
    restoreActive: boolean,
    migrateCodexLoginCache = true,
  ): TransferImportResponse {
    this.assertConflictPolicy(conflictPolicy);
    const payload = this.decrypt(envelope, passphrase);
    const cacheWrite: PlannedWrite[] =
      migrateCodexLoginCache &&
      payload.codexLoginCache !== undefined &&
      !this.codexLoginCache.matchesCurrent(payload.codexLoginCache)
        ? [
            {
              ...this.codexLoginCache.prepareWrite(payload.codexLoginCache),
              format: 'json',
              secret: true,
            },
          ]
        : [];
    const plan = this.planImport(
      payload,
      this.readStore(),
      this.readVault(),
      conflictPolicy,
      restoreActive,
    );

    const profilesPath = this.environment.files.profiles;
    const vaultPath = this.environment.files.vault;
    const profileSnapshot = this.files.readOptional(profilesPath);
    const vaultSnapshot = this.files.readOptional(vaultPath);
    this.liveWrite.transaction(
      {
        kind: 'import',
        harness: 'codex',
        profile: '导入登录缓存',
        writes: cacheWrite,
        metadata: ['profiles', 'vault'],
      },
      () => {
        try {
          this.files.writeJson(vaultPath, plan.vault);
          this.files.writeJson(profilesPath, plan.store);
        } catch (error) {
          this.restore(vaultPath, vaultSnapshot);
          this.restore(profilesPath, profileSnapshot);
          throw error;
        }
      },
    );

    const warnings: LocalizedMessage[] = [];
    let activeRestored = 0;
    if (restoreActive) {
      for (const active of payload.active) {
        try {
          if (active.official) {
            this.activation.activateOfficial(active.harness);
          } else if (plan.store[active.harness]?.[active.name]) {
            this.activation.activate(active.harness, active.name);
          } else {
            throw new Error('对应配置不存在');
          }
          activeRestored++;
        } catch (error) {
          const reason = (error as Error).message;
          warnings.push({
            code: WARNING_CODES.transferActiveRestoreFailed,
            data: { harness: active.harness, profile: active.name, reason },
          });
        }
      }
    }

    return {
      ok: true,
      imported: plan.imported,
      overwritten: plan.overwritten,
      skipped: plan.skipped,
      providersCopied: plan.providersCopied,
      activeRestored,
      codexLoginCacheMigrated: cacheWrite.length > 0,
      warnings,
    };
  }

  private decrypt(envelope: TransferEnvelope, passphrase: string): PortablePayload {
    this.assertPassphrase(passphrase);
    const parsed = portablePayloadSchema.safeParse(this.open(envelope, passphrase));
    if (!parsed.success) {
      throw new HttpError(400, 'invalid export payload', {
        code: payloadErrorCode(parsed.error),
      });
    }
    const payload = parsed.data;
    if (payload.codexLoginCache !== undefined) {
      this.codexLoginCache.validate(payload.codexLoginCache);
    }
    this.validatePayload(payload);
    return payload;
  }

  private assertConflictPolicy(conflictPolicy: TransferConflictPolicy): void {
    if (conflictPolicy !== 'skip' && conflictPolicy !== 'overwrite') {
      throw new HttpError(400, 'invalid conflict policy', {
        code: ERROR_CODES.invalidConflictPolicy,
      });
    }
  }

  private validatePayload(payload: PortablePayload): void {
    const profileIds = new Set<string>();
    const providerIds = new Set<string>();
    for (const provider of payload.providers ?? []) {
      if (providerIds.has(provider.id)) {
        throw new HttpError(400, '导出文件包含重复的凭据库条目', {
          code: ERROR_CODES.transferDuplicateProvider,
        });
      }
      providerIds.add(provider.id);
    }
    for (const profile of payload.profiles) {
      this.validateProfile(profile);
      const id = profileId(profile.harness, profile.name);
      if (profileIds.has(id)) {
        throw new HttpError(400, '导出文件包含重复的配置', {
          code: ERROR_CODES.transferDuplicateProfile,
        });
      }
      profileIds.add(id);
      if (profile.providerId && !providerIds.has(profile.providerId)) {
        throw new HttpError(400, '导出文件中的配置引用了不存在的凭据库条目', {
          code: ERROR_CODES.transferProviderMissing,
        });
      }
    }

    const activeHarnesses = new Set<HarnessId>();
    for (const active of payload.active) {
      if (activeHarnesses.has(active.harness)) {
        throw new HttpError(400, '导出文件包含重复的激活状态', {
          code: ERROR_CODES.transferDuplicateActive,
        });
      }
      activeHarnesses.add(active.harness);
      const adapter = this.adapters.get(active.harness);
      if (active.official) {
        if (active.name !== '官方登录' || !adapter.renderOfficial) {
          throw new HttpError(400, '导出文件中的官方登录状态无效', {
            code: ERROR_CODES.transferOfficialActiveInvalid,
          });
        }
      } else if (!profileIds.has(profileId(active.harness, active.name))) {
        throw new HttpError(400, '导出文件中的激活状态引用了不存在的配置', {
          code: ERROR_CODES.transferActiveProfileMissing,
        });
      }
    }
  }

  private planImport(
    payload: PortablePayload,
    existing: ProfileStore,
    existingVault: VaultStore,
    conflictPolicy: TransferConflictPolicy,
    restoreActive: boolean,
  ): ImportPlan {
    const store = structuredClone(existing);
    const vault = structuredClone(existingVault);
    let imported = 0;
    let overwritten = 0;
    let skipped = 0;
    const selected: PortableProfile[] = [];

    for (const profile of payload.profiles) {
      store[profile.harness] ||= {};
      const exists = store[profile.harness]![profile.name] !== undefined;
      if (exists && conflictPolicy === 'skip') {
        skipped++;
        continue;
      }
      selected.push(profile);
    }

    const providerMap = new Map<string, string>();
    // The vault is a first-class part of a machine migration: include standalone
    // credentials too, not only the entries a profile happens to reference today.
    for (const provider of payload.providers ?? []) {
      const targetId = this.availableProviderId(provider.id, vault);
      vault.entries[targetId] = {
        id: targetId,
        name: provider.name,
        api_key: this.crypto.encrypt(provider.apiKey),
        notes: provider.notes,
        endpoints: provider.endpoints,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      providerMap.set(provider.id, targetId);
    }

    for (const profile of selected) {
      store[profile.harness] ||= {};
      const exists = store[profile.harness]![profile.name] !== undefined;
      store[profile.harness]![profile.name] = this.toStored(profile);
      const mappedProvider = profile.providerId ? providerMap.get(profile.providerId) : undefined;
      if (mappedProvider) {
        store[profile.harness]![profile.name]!.provider_id = mappedProvider;
        store[profile.harness]![profile.name]!.provider_endpoint = profile.providerEndpoint;
      }
      if (exists) {
        overwritten++;
      } else {
        imported++;
      }
    }

    return {
      store,
      vault,
      imported,
      overwritten,
      skipped,
      providersCopied: providerMap.size,
      codexActivationAuthEffect: this.codexActivationAuthEffect(payload, store, restoreActive),
    };
  }

  private codexActivationAuthEffect(
    payload: PortablePayload,
    store: ProfileStore,
    restoreActive: boolean,
  ): CodexAuthJsonEffect {
    if (!restoreActive) {
      return 'none';
    }
    const active = payload.active.find((item) => item.harness === 'codex');
    if (!active) {
      return 'none';
    }
    if (active.official) {
      // Codex's official renderer removes a stale OPENAI_API_KEY when one is present.
      return 'official-cleanup';
    }
    const profile = store.codex?.[active.name];
    if (!profile) {
      return 'none';
    }
    if (profile.overrides?.auth !== undefined) {
      return 'auth-override';
    }
    return profile.extras?.authMode === 'openai_auth' ? 'openai-api-key' : 'none';
  }

  private validateProfile(profile: PortableProfile): void {
    if (!profile.name || profile.name.length > 120 || /[\\/]/.test(profile.name)) {
      throw new HttpError(400, '导出文件包含无效的配置名称', {
        code: ERROR_CODES.transferProfileNameInvalid,
      });
    }
    this.adapters.get(profile.harness).validate?.({
      name: profile.name,
      baseUrl: profile.baseUrl,
      apiKey: profile.apiKey,
      model: profile.model,
      extras: profile.extras,
    });
  }

  private toStored(profile: PortableProfile): StoredProfile {
    return {
      base_url: profile.baseUrl,
      api_key: this.crypto.encrypt(profile.apiKey),
      model: profile.model,
      notes: profile.notes,
      extras: profile.extras,
      overrides: profile.overrides,
      updated_at: new Date().toISOString(),
    };
  }

  private readStore(): ProfileStore {
    return this.files.readJsonStrict<ProfileStore>(this.environment.files.profiles, {});
  }

  private readVault(): VaultStore {
    return this.files.readJsonStrict<VaultStore>(this.environment.files.vault, {
      version: 1,
      entries: {},
    });
  }

  /** Never overwrite a local vault entry: imported entries get isolated copies. */
  private availableProviderId(sourceId: string, vault: VaultStore): string {
    if (!vault.entries[sourceId]) return sourceId;
    const base = `${sourceId}-imported`.slice(0, 60);
    let candidate = base;
    let index = 2;
    while (vault.entries[candidate]) {
      candidate = `${base}-${index}`.slice(0, 64);
      index++;
    }
    return candidate;
  }

  private restore(path: string, snapshot: string | undefined): void {
    try {
      this.files.restore(path, snapshot);
    } catch {
      // Preserve the original import failure; the cache transaction rolls its own write back.
    }
  }

  /** Inline keys remain as a recovery cache if a bundled vault entry cannot be restored. */
  private resolveKey(stored: StoredProfile): string {
    if (!stored.provider_id) {
      return this.crypto.decrypt(stored.api_key);
    }
    try {
      return this.vault.decrypt(stored.provider_id);
    } catch {
      return this.crypto.decrypt(stored.api_key);
    }
  }

  private assertPassphrase(passphrase: string): void {
    if (passphrase.length < 8) {
      throw new HttpError(400, '迁移密码至少需要 8 个字符', {
        code: ERROR_CODES.transferPassphraseTooShort,
      });
    }
  }

  private seal(payload: PortablePayload, passphrase: string): TransferEnvelope {
    const { salt, iv, tag, data } = this.crypto.seal(JSON.stringify(payload), passphrase);
    return {
      format: FORMAT,
      version: VERSION,
      kdf: { name: 'scrypt', salt },
      cipher: { name: 'aes-256-gcm', iv, tag, data },
    };
  }

  /**
   * Opens the envelope. The result is still untrusted JSON — knowing the passphrase
   * proves nothing about the shape of what was sealed — so the caller validates it.
   */
  private open(envelope: TransferEnvelope, passphrase: string): unknown {
    try {
      const sealed = transferEnvelopeSchema.parse(envelope);
      if (sealed.cipher.data.length > MAX_ENCRYPTED_BYTES) {
        throw new Error('envelope too large');
      }
      return JSON.parse(this.crypto.open({ salt: sealed.kdf.salt, ...sealed.cipher }, passphrase));
    } catch {
      throw new HttpError(400, '迁移密码错误或导出文件已损坏', {
        code: ERROR_CODES.transferDecryptFailed,
      });
    }
  }
}

function profileId(harness: HarnessId, name: string): string {
  return `${harness} ${name}`;
}

/**
 * Which part of the export the importer should be told about.
 *
 * The schema reports one issue per bad field, but the user needs to know *what* in
 * their file is wrong — a bad profile and a bad vault entry are fixed differently.
 * The first issue's path names the section it came from.
 */
function payloadErrorCode(error: ZodError): ErrorCode {
  const [issue] = error.issues;
  if (issue?.path[0] === 'profiles') {
    return issue.code === 'too_big'
      ? ERROR_CODES.transferTooManyProfiles
      : ERROR_CODES.transferProfilesInvalid;
  }
  if (issue?.path[0] === 'providers') return ERROR_CODES.transferProvidersInvalid;
  if (issue?.path[0] === 'active') return ERROR_CODES.transferActiveInvalid;
  if (issue?.path[0] === 'codexLoginCache') return ERROR_CODES.transferCodexCacheInvalid;
  return ERROR_CODES.transferEnvelopeInvalid;
}
