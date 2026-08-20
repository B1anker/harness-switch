import type {
  CreateProviderRequest,
  ProviderEndpoint,
  ProviderPublic,
  UpdateProviderRequest,
} from '@seaveyon/harness-switch-shared';
import { HttpError } from '../common/errors';
import { createDecorator, inject } from '../di';
import { type EncryptedValue, ICryptoService } from './crypto';
import { IEnvironmentService } from './environment';
import { IFileService } from './files';
import type { ProfileStore } from './profiles';

export type VaultEntry = {
  id: string;
  name: string;
  api_key: EncryptedValue;
  notes?: string;
  endpoints: ProviderEndpoint[];
  created_at: string;
  updated_at: string;
};

export type { ProviderEndpoint } from '@seaveyon/harness-switch-shared';

export type VaultStore = {
  version: 1;
  entries: Record<string, VaultEntry>;
};

export type VaultReference = {
  harness: string;
  name: string;
};

export type VaultUpdateResult = {
  provider: ProviderPublic;
  /** Every profile that references this entry, so callers can re-apply the active ones. */
  affected: VaultReference[];
};

export interface IVaultService {
  readonly _serviceBrand: undefined;
  list(): ProviderPublic[];
  get(id: string): ProviderPublic;
  create(input: CreateProviderRequest): ProviderPublic;
  update(id: string, input: UpdateProviderRequest): VaultUpdateResult;
  remove(id: string): void;
  /** Resolves the current plaintext credential. Used by the activation path. */
  decrypt(id: string): string;
  /** Profiles referencing this entry; used for the delete guard and rotation sweep. */
  references(id: string): VaultReference[];
}

export const IVaultService = createDecorator<IVaultService>('vaultService');

const STORE_VERSION = 1 as const;

@inject(IEnvironmentService, IFileService, ICryptoService)
export class VaultService implements IVaultService {
  declare readonly _serviceBrand: undefined;

  constructor(
    private readonly environment: IEnvironmentService,
    private readonly files: IFileService,
    private readonly crypto: ICryptoService,
  ) {}

  list(): ProviderPublic[] {
    return Object.values(this.read().entries).map((entry) => this.toPublic(entry));
  }

  get(id: string): ProviderPublic {
    return this.toPublic(this.require(id));
  }

  create(input: CreateProviderRequest): ProviderPublic {
    const name = String(input.name ?? '').trim();
    if (!name) {
      throw new HttpError(400, 'name is required');
    }
    const apiKey = String(input.apiKey ?? '');
    if (!apiKey) {
      throw new HttpError(400, 'apiKey is required');
    }
    const endpoints = this.validateEndpoints(input.endpoints);
    const id = this.nextId(name);
    const now = new Date().toISOString();
    const store = this.read();
    store.entries[id] = {
      id,
      name,
      api_key: this.crypto.encrypt(apiKey),
      notes: input.notes?.trim() || undefined,
      endpoints,
      created_at: now,
      updated_at: now,
    };
    this.write(store);
    return this.toPublic(store.entries[id]!);
  }

  update(id: string, input: UpdateProviderRequest): VaultUpdateResult {
    const store = this.read();
    const entry = store.entries[id];
    if (!entry) {
      throw new HttpError(404, 'provider not found');
    }
    if (input.name !== undefined) {
      const name = String(input.name).trim();
      if (!name) {
        throw new HttpError(400, 'name is required');
      }
      entry.name = name;
    }
    if (input.apiKey !== undefined) {
      // An explicit empty apiKey means "keep the current credential" (rotation is
      // triggered by a non-empty value); leaving the field absent also keeps it.
      const apiKey = String(input.apiKey).trim();
      if (apiKey) {
        entry.api_key = this.crypto.encrypt(apiKey);
      }
    }
    if (input.notes !== undefined) {
      entry.notes = input.notes.trim() || undefined;
    }
    if (input.endpoints !== undefined) {
      entry.endpoints = this.validateEndpoints(input.endpoints);
    }
    entry.updated_at = new Date().toISOString();
    this.write(store);

    const affected = this.references(id);
    return { provider: this.toPublic(entry), affected };
  }

  remove(id: string): void {
    const store = this.read();
    if (!store.entries[id]) {
      throw new HttpError(404, 'provider not found');
    }
    const references = this.references(id);
    if (references.length > 0) {
      throw new HttpError(
        409,
        `Provider 正被 ${references.length} 个配置引用，请先移除这些引用再删除`,
      );
    }
    delete store.entries[id];
    this.write(store);
  }

  decrypt(id: string): string {
    const entry = this.require(id);
    const plain = this.crypto.decrypt(entry.api_key);
    if (!plain) {
      throw new HttpError(500, `provider ${id} 的凭据无法解密`);
    }
    return plain;
  }

  references(id: string): VaultReference[] {
    const store = this.readProfileStore();
    const found: VaultReference[] = [];
    for (const [harness, profiles] of Object.entries(store)) {
      for (const [name, profile] of Object.entries(profiles)) {
        if (profile.provider_id === id) {
          found.push({ harness, name });
        }
      }
    }
    return found;
  }

  /** Resolves the vault entry by id, throwing a 404 when it is missing. */
  private require(id: string): VaultEntry {
    const entry = this.read().entries[id];
    if (!entry) {
      throw new HttpError(404, 'provider not found');
    }
    return entry;
  }

  private read(): VaultStore {
    // Strict: a corrupt vault must never be mistaken for an empty one, or a later
    // write would overwrite the user's encrypted credentials.
    return this.files.readJsonStrict<VaultStore>(this.environment.files.vault, {
      version: STORE_VERSION,
      entries: {},
    });
  }

  private readProfileStore(): ProfileStore {
    return this.files.readJsonStrict<ProfileStore>(this.environment.files.profiles, {});
  }

  private write(store: VaultStore): void {
    this.files.writeJson(this.environment.files.vault, store);
  }

  private toPublic(entry: VaultEntry): ProviderPublic {
    return {
      id: entry.id,
      name: entry.name,
      notes: entry.notes,
      endpoints: entry.endpoints,
      apiKeyConfigured: true,
      updatedAt: entry.updated_at,
    };
  }

  private validateEndpoints(endpoints: ProviderEndpoint[] | undefined): ProviderEndpoint[] {
    if (endpoints === undefined) {
      return [];
    }
    if (!Array.isArray(endpoints)) {
      throw new HttpError(400, 'endpoints must be an array');
    }
    const seen = new Set<string>();
    return endpoints.map((endpoint) => {
      const key = String(endpoint?.key ?? '').trim();
      if (!key) {
        throw new HttpError(400, 'endpoint key is required');
      }
      if (key.includes('/') || key.includes('\\') || key.length > 60) {
        throw new HttpError(400, 'endpoint key contains invalid characters');
      }
      if (seen.has(key)) {
        throw new HttpError(400, `duplicate endpoint ${key}`);
      }
      seen.add(key);
      const baseUrl = String(endpoint.baseUrl ?? '').trim();
      if (!baseUrl) {
        throw new HttpError(400, `endpoint ${key} requires a baseUrl`);
      }
      return { key, label: endpoint.label?.trim() || key, baseUrl };
    });
  }

  private nextId(name: string): string {
    const base = name
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    const slug = base || `provider-${Date.now().toString(36)}`;
    const store = this.read();
    let candidate = slug;
    let suffix = 1;
    while (store.entries[candidate]) {
      candidate = `${slug}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }
}
