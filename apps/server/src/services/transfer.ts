import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import {
  HARNESS_IDS,
  type HarnessId,
  isHarnessId,
  type TransferConflictPolicy,
  type TransferEnvelope,
  type TransferImportResponse,
  type TransferPreview,
} from '@seaveyon/harness-switch-shared';
import { HttpError } from '../common/errors';
import { createDecorator, inject } from '../di';
import { IActivationService } from './activation';
import { IAdapterRegistry } from './adapters';
import { ICryptoService } from './crypto';
import { IEnvironmentService } from './environment';
import { IFileService } from './files';
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
};

export interface ITransferService {
  readonly _serviceBrand: undefined;
  exportAll(passphrase: string): TransferEnvelope;
  preview(envelope: TransferEnvelope, passphrase: string): TransferPreview;
  importAll(
    envelope: TransferEnvelope,
    passphrase: string,
    conflictPolicy: TransferConflictPolicy,
    restoreActive: boolean,
  ): TransferImportResponse;
}

export const ITransferService = createDecorator<ITransferService>('transferService');

@inject(
  IEnvironmentService,
  IFileService,
  ICryptoService,
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
    private readonly adapters: IAdapterRegistry,
    private readonly activation: IActivationService,
    private readonly vault: IVaultService,
  ) {}

  exportAll(passphrase: string): TransferEnvelope {
    this.assertPassphrase(passphrase);
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
      },
      passphrase,
    );
  }

  preview(envelope: TransferEnvelope, passphrase: string): TransferPreview {
    const payload = this.decrypt(envelope, passphrase);
    const store = this.readStore();
    return {
      exportedAt: payload.exportedAt,
      profileCount: payload.profiles.length,
      harnesses: HARNESS_IDS.map((harness) => ({
        harness,
        profiles: payload.profiles.filter((profile) => profile.harness === harness).length,
      })).filter((item) => item.profiles > 0),
      conflicts: payload.profiles
        .filter((profile) => store[profile.harness]?.[profile.name] !== undefined)
        .map(({ harness, name }) => ({ harness, name })),
      activeCount: payload.active.length,
    };
  }

  importAll(
    envelope: TransferEnvelope,
    passphrase: string,
    conflictPolicy: TransferConflictPolicy,
    restoreActive: boolean,
  ): TransferImportResponse {
    if (conflictPolicy !== 'skip' && conflictPolicy !== 'overwrite') {
      throw new HttpError(400, 'invalid conflict policy');
    }
    const payload = this.decrypt(envelope, passphrase);
    const store = structuredClone(this.readStore());
    let imported = 0;
    let overwritten = 0;
    let skipped = 0;

    for (const profile of payload.profiles) {
      this.validateProfile(profile);
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

    this.files.writeJson(this.environment.files.profiles, store);

    const warnings: string[] = [];
    let activeRestored = 0;
    if (restoreActive) {
      for (const active of payload.active) {
        try {
          if (active.official) {
            this.activation.activateOfficial(active.harness);
          } else if (store[active.harness]?.[active.name]) {
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

    return { ok: true, imported, overwritten, skipped, activeRestored, warnings };
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
    return payload;
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
