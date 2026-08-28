import type { HarnessId, ProfilePublic, ProviderPublic } from '@seaveyon/harness-switch-shared';
import { HttpError } from '../common/errors';
import { createDecorator, inject } from '../di';
import type { AdapterProfile } from './adapters';
import { IAdapterRegistry } from './adapters';
import { type EncryptedValue, ICryptoService } from './crypto';
import { IEnvironmentService } from './environment';
import { IFileService } from './files';
import { ILogService } from './log';
import { IHarnessRegistry } from './registry';
import { IVaultService, type ProviderEndpoint } from './vault';

export type StoredProfile = {
  base_url: string;
  api_key: EncryptedValue;
  model: string;
  notes: string;
  /** Harness-specific structured fields, as declared by the adapter's FieldSpec list. */
  extras?: Record<string, string>;
  /**
   * Target key to verbatim file content. Present only for files the user took over in
   * the advanced editor, which then win over anything the form fields would render.
   */
  overrides?: Record<string, string>;
  /**
   * Optional reference to a Provider Vault entry. When set, the vault owns the
   * credential: `api_key` below is only a materialized cache of the latest value,
   * and `decrypt` resolves through the vault instead.
   */
  provider_id?: string;
  /** Optional named endpoint under the vault entry; its base URL wins when set. */
  provider_endpoint?: string;
  updated_at: string;
};

export type ProfileStore = Record<string, Record<string, StoredProfile>>;

export type ProfileInput = {
  name: string;
  /** Existing key used to locate a profile while renaming it. */
  sourceName?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  notes?: string;
  extras?: Record<string, string>;
  overrides?: Record<string, string>;
  /**
   * Reference a Provider Vault entry instead of an inline apiKey. An explicit empty
   * string detaches the profile from the vault (keeping the cached key inline).
   */
  providerId?: string;
  providerEndpoint?: string;
};

export type DecryptedProfile = AdapterProfile & {
  overrides: Record<string, string>;
};

export interface IProfileService {
  readonly _serviceBrand: undefined;
  list(harness: HarnessId): ProfilePublic[];
  get(harness: HarnessId, name: string): ProfilePublic | undefined;
  upsert(harness: HarnessId, input: ProfileInput, isCreate: boolean): ProfilePublic;
  remove(harness: HarnessId, name: string): void;
  decrypt(harness: HarnessId, name: string): DecryptedProfile;
  /** Used by the pre-switch backfill to persist values recovered from a live file. */
  applyBackfill(harness: HarnessId, name: string, values: Partial<AdapterProfile>): void;
  /**
   * Refreshes the cached credential and endpoint base URL of every profile that
   * references the given vault entry. Called after a vault rotation or endpoint edit.
   */
  sweepVaultCache(vaultId: string, apiKey: string, endpoints: ProviderEndpoint[]): number;
}

export const IProfileService = createDecorator<IProfileService>('profileService');

@inject(
  IEnvironmentService,
  IFileService,
  ICryptoService,
  IHarnessRegistry,
  IAdapterRegistry,
  IVaultService,
  ILogService,
)
export class ProfileService implements IProfileService {
  declare readonly _serviceBrand: undefined;

  constructor(
    private readonly environment: IEnvironmentService,
    private readonly files: IFileService,
    private readonly crypto: ICryptoService,
    private readonly harnesses: IHarnessRegistry,
    private readonly adapters: IAdapterRegistry,
    private readonly vault: IVaultService,
    private readonly log: ILogService,
  ) {}

  list(harness: HarnessId): ProfilePublic[] {
    const store = this.read();
    if (this.repairEndpointReferences(store, harness)) {
      this.files.writeJson(this.environment.files.profiles, store);
    }
    return Object.entries(store[harness] ?? {}).map(([name, profile]) =>
      this.toPublic(harness, name, profile),
    );
  }

  get(harness: HarnessId, name: string): ProfilePublic | undefined {
    const stored = this.read()[harness]?.[name];
    return stored ? this.toPublic(harness, name, stored) : undefined;
  }

  upsert(harness: HarnessId, input: ProfileInput, isCreate: boolean): ProfilePublic {
    this.harnesses.require(harness);
    const name = input.name.trim();
    const sourceName = isCreate ? name : input.sourceName?.trim() || name;
    this.assertName(name);
    this.assertName(sourceName);
    const store = this.read();
    store[harness] ||= {};
    const prior = store[harness][sourceName];
    if (isCreate && prior) {
      throw new HttpError(409, 'profile already exists');
    }
    if (!isCreate && !prior) {
      throw new HttpError(404, 'profile not found');
    }
    if (!isCreate && sourceName !== name && store[harness][name]) {
      throw new HttpError(409, 'profile already exists');
    }

    // Resolve the credential: a vault reference wins over an inline apiKey, and an
    // explicit empty providerId detaches the profile back to an inline credential.
    const hasProvider = input.providerId !== undefined;
    const providerId = input.providerId?.trim() || undefined;
    const providerEndpoint = input.providerEndpoint?.trim() || undefined;
    const hasInlineKey = input.apiKey !== undefined && input.apiKey.trim() !== '';
    const inlineKey = (input.apiKey ?? '').trim();

    let nextProviderId = prior?.provider_id;
    let nextProviderEndpoint = prior?.provider_endpoint;
    let apiKey = '';

    if (hasProvider && providerId) {
      const entry = this.vault.get(providerId);
      if (providerEndpoint) {
        const endpoint = entry.endpoints.find((candidate) => candidate.key === providerEndpoint);
        if (!endpoint) {
          throw new HttpError(400, `endpoint ${providerEndpoint} not found`);
        }
        nextProviderEndpoint = providerEndpoint;
      } else {
        nextProviderEndpoint = undefined;
      }
      nextProviderId = providerId;
      apiKey = this.vault.decrypt(providerId);
    } else if (hasProvider && !providerId) {
      // Explicit detach: keep the last cached credential as the profile's own key.
      nextProviderId = undefined;
      nextProviderEndpoint = undefined;
      apiKey = hasInlineKey ? inlineKey : prior ? this.crypto.decrypt(prior.api_key) : '';
    } else if (hasInlineKey) {
      nextProviderId = undefined;
      nextProviderEndpoint = undefined;
      apiKey = inlineKey;
    } else if (prior) {
      apiKey = prior.provider_id
        ? this.vault.decrypt(prior.provider_id)
        : this.crypto.decrypt(prior.api_key);
    }

    if (isCreate && !apiKey) {
      throw new HttpError(400, 'apiKey is required');
    }

    const baseUrl = this.resolveBaseUrl(
      (input.baseUrl ?? prior?.base_url ?? '').trim(),
      providerId || nextProviderId,
      providerEndpoint || nextProviderEndpoint,
    );

    const next: StoredProfile = {
      base_url: baseUrl,
      api_key: this.crypto.encrypt(apiKey),
      model: (input.model ?? prior?.model ?? '').trim(),
      notes: input.notes ?? prior?.notes ?? '',
      extras: input.extras ?? prior?.extras ?? {},
      overrides: input.overrides ?? prior?.overrides ?? {},
      provider_id: nextProviderId,
      provider_endpoint: nextProviderEndpoint,
      updated_at: new Date().toISOString(),
    };

    this.adapters.get(harness).validate?.({
      name,
      baseUrl: next.base_url,
      apiKey,
      model: next.model,
      extras: next.extras ?? {},
    });

    store[harness][name] = next;
    if (sourceName !== name) {
      delete store[harness][sourceName];
    }
    this.files.writeJson(this.environment.files.profiles, store);
    return this.toPublic(harness, name, next);
  }

  remove(harness: HarnessId, name: string): void {
    const store = this.read();
    if (!store[harness]?.[name]) {
      throw new HttpError(404, 'profile not found');
    }
    delete store[harness][name];
    this.files.writeJson(this.environment.files.profiles, store);
  }

  decrypt(harness: HarnessId, name: string): DecryptedProfile {
    const stored = this.read()[harness]?.[name];
    if (!stored) {
      throw new HttpError(404, 'profile not found');
    }
    return {
      name,
      baseUrl: this.resolveBaseUrl(
        stored.base_url || '',
        stored.provider_id,
        stored.provider_endpoint,
      ),
      apiKey: this.resolveKey(stored),
      model: stored.model || '',
      extras: stored.extras ?? {},
      overrides: stored.overrides ?? {},
    };
  }

  /** Only touches values an adapter explicitly recovered from its live files. */
  applyBackfill(harness: HarnessId, name: string, values: Partial<AdapterProfile>): void {
    const store = this.read();
    const stored = store[harness]?.[name];
    if (!stored) {
      return;
    }
    if (values.baseUrl !== undefined) {
      stored.base_url = values.baseUrl;
    }
    if (values.model !== undefined) {
      stored.model = values.model;
    }
    // A vault-referenced profile shares its credential with other profiles; a hand
    // edit of one live file must not silently change the shared secret.
    if (values.apiKey && !stored.provider_id) {
      stored.api_key = this.crypto.encrypt(values.apiKey);
    }
    if (values.extras !== undefined) {
      stored.extras = { ...stored.extras, ...values.extras };
    }
    this.files.writeJson(this.environment.files.profiles, store);
  }

  sweepVaultCache(vaultId: string, apiKey: string, endpoints: ProviderEndpoint[]): number {
    const store = this.read();
    let updated = 0;
    for (const profiles of Object.values(store)) {
      for (const stored of Object.values(profiles)) {
        if (stored.provider_id !== vaultId) {
          continue;
        }
        stored.api_key = this.crypto.encrypt(apiKey);
        const endpoint =
          stored.provider_endpoint !== undefined
            ? endpoints.find((candidate) => candidate.key === stored.provider_endpoint)
            : undefined;
        if (endpoint) {
          stored.base_url = endpoint.baseUrl;
        } else if (stored.provider_endpoint !== undefined && endpoints.length > 0) {
          stored.provider_endpoint = endpoints[0]!.key;
          stored.base_url = endpoints[0]!.baseUrl;
        }
        updated++;
      }
    }
    if (updated > 0) {
      this.files.writeJson(this.environment.files.profiles, store);
    }
    return updated;
  }

  private read(): ProfileStore {
    // Strict: a corrupt profile store must never be mistaken for an empty one,
    // or a later write would overwrite the user's encrypted profiles.
    return this.files.readJsonStrict<ProfileStore>(this.environment.files.profiles, {});
  }

  private repairEndpointReferences(store: ProfileStore, harness: HarnessId): boolean {
    let changed = false;
    for (const stored of Object.values(store[harness] ?? {})) {
      if (!stored.provider_id || !stored.provider_endpoint) continue;
      try {
        const provider = this.vault.get(stored.provider_id);
        if (provider.endpoints.some((endpoint) => endpoint.key === stored.provider_endpoint))
          continue;
        const fallback = provider.endpoints[0];
        if (!fallback) continue;
        stored.provider_endpoint = fallback.key;
        stored.base_url = fallback.baseUrl;
        changed = true;
      } catch {
        // A missing provider still degrades to the encrypted cache in resolveKey.
      }
    }
    return changed;
  }

  private toPublic(harness: HarnessId, name: string, profile: StoredProfile): ProfilePublic {
    return {
      harness,
      name,
      baseUrl: profile.base_url || '',
      model: profile.model || '',
      notes: profile.notes || '',
      extras: profile.extras ?? {},
      overriddenTargets: Object.keys(profile.overrides ?? {}),
      providerId: profile.provider_id,
      providerEndpoint: profile.provider_endpoint,
      updatedAt: profile.updated_at || '',
    };
  }

  /**
   * The vault owns the credential when provider_id is set; the inline field is a cache.
   * A referenced entry that vanished degrades to the cache rather than breaking every
   * reader, but the degradation is logged so the drift is visible.
   */
  private resolveKey(stored: StoredProfile): string {
    if (!stored.provider_id) {
      return this.crypto.decrypt(stored.api_key);
    }
    try {
      return this.vault.decrypt(stored.provider_id);
    } catch {
      this.log.warn(`profile ${stored.provider_id} 引用的 provider 不存在，回退到内联缓存凭据`);
      return this.crypto.decrypt(stored.api_key);
    }
  }

  /**
   * An endpoint reference wins over the profile's own base URL. When the named
   * endpoint is gone from the vault, fall back to the provider's first endpoint;
   * when the provider itself is gone, keep the profile's own value (never throw).
   */
  private resolveBaseUrl(
    fallback: string,
    providerId: string | undefined,
    providerEndpoint: string | undefined,
  ): string {
    if (!providerId || !providerEndpoint) {
      return fallback;
    }
    let entry: ProviderPublic;
    try {
      entry = this.vault.get(providerId);
    } catch {
      this.log.warn(`profile 引用的 provider ${providerId} 不存在，回退到内联 base_url`);
      return fallback;
    }
    const endpoint = entry.endpoints.find((candidate) => candidate.key === providerEndpoint);
    if (endpoint) {
      return endpoint.baseUrl;
    }
    if (entry.endpoints.length > 0) {
      this.log.warn(
        `endpoint ${providerEndpoint} 已不存在，回退到 provider ${providerId} 的首个 endpoint`,
      );
      return entry.endpoints[0]!.baseUrl;
    }
    return fallback;
  }

  private assertName(name: string): void {
    if (!name) {
      throw new HttpError(400, 'name is required');
    }
    if (name.includes('/') || name.includes('\\')) {
      throw new HttpError(400, 'name cannot contain slashes');
    }
    if (name.length > 120) {
      throw new HttpError(400, 'name is too long');
    }
  }
}
