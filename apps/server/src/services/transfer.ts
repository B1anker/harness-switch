import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import {
  type CodexAuthJsonEffect,
  HARNESS_IDS,
  type HarnessId,
  isHarnessId,
  type TransferConflictPolicy,
  type TransferEnvelope,
  type TransferExportPreview,
  type TransferImportResponse,
  type TransferPreview,
} from '@seaveyon/harness-switch-shared';
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
import { IVaultService } from './vault';

const FORMAT = 'harness-switch-encrypted-export' as const;
const VERSION = 1 as const;
const MAX_ENCRYPTED_BYTES = 10 * 1024 * 1024;

type PortableProfile = {
  harness: HarnessId;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  notes: string;
  extras: Record<string, string>;
  overrides: Record<string, string>;
};

type PortableActive = {
  harness: HarnessId;
  name: string;
  official: boolean;
};

type PortablePayload = {
  format: 'harness-switch-portable-config';
  version: 1;
  exportedAt: string;
  profiles: PortableProfile[];
  active: PortableActive[];
  /** Present only when the user explicitly included the native Codex login session. */
  codexLoginCache?: string;
};

type ImportPlan = {
  store: ProfileStore;
  imported: number;
  overwritten: number;
  skipped: number;
  codexActivationAuthEffect: CodexAuthJsonEffect;
};

export interface ITransferService {
  readonly _serviceBrand: undefined;
  exportPreview(): TransferExportPreview;
  exportAll(passphrase: string, includeCodexLoginCache: boolean): TransferEnvelope;
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
    migrateCodexLoginCache: boolean,
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

  exportAll(passphrase: string, includeCodexLoginCache: boolean): TransferEnvelope {
    this.assertPassphrase(passphrase);
    const codexLoginCache = includeCodexLoginCache
      ? this.codexLoginCache.readOptional()
      : undefined;
    if (includeCodexLoginCache && codexLoginCache === undefined) {
      throw new HttpError(400, '当前用户没有可导出的 Codex 登录缓存');
    }
    const store = this.readStore();
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
    return encrypt(
      {
        format: 'harness-switch-portable-config',
        version: VERSION,
        exportedAt: new Date().toISOString(),
        profiles,
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
    const plan = this.planImport(payload, existing, conflictPolicy, restoreActive);
    return {
      exportedAt: payload.exportedAt,
      profileCount: payload.profiles.length,
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
        targetExists: this.codexLoginCache.exists(),
      },
    };
  }

  importAll(
    envelope: TransferEnvelope,
    passphrase: string,
    conflictPolicy: TransferConflictPolicy,
    restoreActive: boolean,
    migrateCodexLoginCache: boolean,
  ): TransferImportResponse {
    this.assertConflictPolicy(conflictPolicy);
    const payload = this.decrypt(envelope, passphrase);
    if (migrateCodexLoginCache && payload.codexLoginCache === undefined) {
      throw new HttpError(400, '导出包不包含可迁移的 Codex 登录缓存');
    }
    const cacheWrite: PlannedWrite[] = migrateCodexLoginCache
      ? [
          {
            ...this.codexLoginCache.prepareWrite(payload.codexLoginCache!),
            format: 'json',
            secret: true,
          },
        ]
      : [];
    const plan = this.planImport(payload, this.readStore(), conflictPolicy, restoreActive);

    const profilesPath = this.environment.files.profiles;
    const profileSnapshot = this.files.readOptional(profilesPath);
    this.liveWrite.transaction('codex', '导入登录缓存', cacheWrite, () => {
      try {
        this.files.writeJson(profilesPath, plan.store);
      } catch (error) {
        this.restore(profilesPath, profileSnapshot);
        throw error;
      }
    });

    const warnings: string[] = [];
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
          warnings.push(
            `${active.harness}/${active.name} 未能恢复激活状态：${(error as Error).message}`,
          );
        }
      }
    }

    return {
      ok: true,
      imported: plan.imported,
      overwritten: plan.overwritten,
      skipped: plan.skipped,
      activeRestored,
      codexLoginCacheMigrated: cacheWrite.length > 0,
      warnings,
    };
  }

  private decrypt(envelope: TransferEnvelope, passphrase: string): PortablePayload {
    this.assertPassphrase(passphrase);
    const payload = decrypt(envelope, passphrase);
    if (
      payload.format !== 'harness-switch-portable-config' ||
      payload.version !== VERSION ||
      !Array.isArray(payload.profiles) ||
      !Array.isArray(payload.active) ||
      typeof payload.exportedAt !== 'string'
    ) {
      throw new HttpError(400, '不支持的导出文件格式');
    }
    if (payload.profiles.length > 10_000) {
      throw new HttpError(400, '导出文件包含过多配置');
    }
    for (const profile of payload.profiles) {
      if (!isPortableProfile(profile)) {
        throw new HttpError(400, '导出文件中的配置数据无效');
      }
    }
    for (const active of payload.active) {
      if (!isPortableActive(active)) {
        throw new HttpError(400, '导出文件中的激活状态无效');
      }
    }
    if (payload.codexLoginCache !== undefined) {
      if (typeof payload.codexLoginCache !== 'string') {
        throw new HttpError(400, '导出文件中的 Codex 登录缓存无效');
      }
      this.codexLoginCache.validate(payload.codexLoginCache);
    }
    this.validatePayload(payload);
    return payload;
  }

  private assertConflictPolicy(conflictPolicy: TransferConflictPolicy): void {
    if (conflictPolicy !== 'skip' && conflictPolicy !== 'overwrite') {
      throw new HttpError(400, 'invalid conflict policy');
    }
  }

  private validatePayload(payload: PortablePayload): void {
    const profileIds = new Set<string>();
    for (const profile of payload.profiles) {
      this.validateProfile(profile);
      const id = profileId(profile.harness, profile.name);
      if (profileIds.has(id)) {
        throw new HttpError(400, '导出文件包含重复的配置');
      }
      profileIds.add(id);
    }

    const activeHarnesses = new Set<HarnessId>();
    for (const active of payload.active) {
      if (activeHarnesses.has(active.harness)) {
        throw new HttpError(400, '导出文件包含重复的激活状态');
      }
      activeHarnesses.add(active.harness);
      const adapter = this.adapters.get(active.harness);
      if (active.official) {
        if (active.name !== '官方登录' || !adapter.renderOfficial) {
          throw new HttpError(400, '导出文件中的官方登录状态无效');
        }
      } else if (!profileIds.has(profileId(active.harness, active.name))) {
        throw new HttpError(400, '导出文件中的激活状态引用了不存在的配置');
      }
    }
  }

  private planImport(
    payload: PortablePayload,
    existing: ProfileStore,
    conflictPolicy: TransferConflictPolicy,
    restoreActive: boolean,
  ): ImportPlan {
    const store = structuredClone(existing);
    let imported = 0;
    let overwritten = 0;
    let skipped = 0;

    for (const profile of payload.profiles) {
      store[profile.harness] ||= {};
      const exists = store[profile.harness]![profile.name] !== undefined;
      if (exists && conflictPolicy === 'skip') {
        skipped++;
        continue;
      }
      store[profile.harness]![profile.name] = this.toStored(profile);
      if (exists) {
        overwritten++;
      } else {
        imported++;
      }
    }

    return {
      store,
      imported,
      overwritten,
      skipped,
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
      throw new HttpError(400, '导出文件包含无效的配置名称');
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

  private restore(path: string, snapshot: string | undefined): void {
    try {
      if (snapshot === undefined) this.files.remove(path);
      else this.files.writeSecure(path, snapshot);
    } catch {
      // Preserve the original import failure; the cache transaction rolls its own write back.
    }
  }

  /** Exports flatten vault references into the inline key the destination can decrypt. */
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
      throw new HttpError(400, '迁移密码至少需要 8 个字符');
    }
  }
}

function encrypt(payload: PortablePayload, passphrase: string): TransferEnvelope {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return {
    format: FORMAT,
    version: VERSION,
    kdf: { name: 'scrypt', salt: salt.toString('base64url') },
    cipher: {
      name: 'aes-256-gcm',
      iv: iv.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'),
      data: data.toString('base64url'),
    },
  };
}

function decrypt(envelope: TransferEnvelope, passphrase: string): PortablePayload {
  try {
    if (
      envelope?.format !== FORMAT ||
      envelope.version !== VERSION ||
      envelope.kdf?.name !== 'scrypt' ||
      envelope.cipher?.name !== 'aes-256-gcm' ||
      typeof envelope.kdf.salt !== 'string' ||
      typeof envelope.cipher.iv !== 'string' ||
      typeof envelope.cipher.tag !== 'string' ||
      typeof envelope.cipher.data !== 'string' ||
      envelope.cipher.data.length > MAX_ENCRYPTED_BYTES
    ) {
      throw new Error('invalid envelope');
    }
    const salt = Buffer.from(envelope.kdf.salt, 'base64url');
    const key = scryptSync(passphrase, salt, 32);
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(envelope.cipher.iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(envelope.cipher.tag, 'base64url'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(envelope.cipher.data, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(plain) as PortablePayload;
  } catch {
    throw new HttpError(400, '迁移密码错误或导出文件已损坏');
  }
}

function profileId(harness: HarnessId, name: string): string {
  return `${harness} ${name}`;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === 'string')
  );
}

function isPortableProfile(value: unknown): value is PortableProfile {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const profile = value as Partial<PortableProfile>;
  return (
    typeof profile.harness === 'string' &&
    isHarnessId(profile.harness) &&
    typeof profile.name === 'string' &&
    typeof profile.baseUrl === 'string' &&
    typeof profile.apiKey === 'string' &&
    typeof profile.model === 'string' &&
    typeof profile.notes === 'string' &&
    isStringRecord(profile.extras) &&
    isStringRecord(profile.overrides)
  );
}

function isPortableActive(value: unknown): value is PortableActive {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const active = value as Partial<PortableActive>;
  return (
    typeof active.harness === 'string' &&
    isHarnessId(active.harness) &&
    typeof active.name === 'string' &&
    typeof active.official === 'boolean'
  );
}
