import type { HarnessId, ProfilePublic } from '@seaveyon/harness-switch-shared';
import { HttpError } from '../common/errors';
import { createDecorator, inject } from '../di';
import type { AdapterProfile } from './adapters';
import { IAdapterRegistry } from './adapters';
import { type EncryptedValue, ICryptoService } from './crypto';
import { IEnvironmentService } from './environment';
import { IFileService } from './files';
import { IHarnessRegistry } from './registry';

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
}

export const IProfileService = createDecorator<IProfileService>('profileService');

@inject(IEnvironmentService, IFileService, ICryptoService, IHarnessRegistry, IAdapterRegistry)
export class ProfileService implements IProfileService {
  declare readonly _serviceBrand: undefined;

  constructor(
    private readonly environment: IEnvironmentService,
    private readonly files: IFileService,
    private readonly crypto: ICryptoService,
    private readonly harnesses: IHarnessRegistry,
    private readonly adapters: IAdapterRegistry,
  ) {}

  list(harness: HarnessId): ProfilePublic[] {
    const store = this.read();
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
    const apiKey = input.apiKey || (prior ? this.crypto.decrypt(prior.api_key) : '');
    if (isCreate && !apiKey) {
      throw new HttpError(400, 'apiKey is required');
    }

    const next: StoredProfile = {
      base_url: (input.baseUrl ?? prior?.base_url ?? '').trim(),
      api_key: this.crypto.encrypt(apiKey),
      model: (input.model ?? prior?.model ?? '').trim(),
      notes: input.notes ?? prior?.notes ?? '',
      extras: input.extras ?? prior?.extras ?? {},
      overrides: input.overrides ?? prior?.overrides ?? {},
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
      baseUrl: stored.base_url || '',
      apiKey: this.crypto.decrypt(stored.api_key),
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
    if (values.apiKey) {
      stored.api_key = this.crypto.encrypt(values.apiKey);
    }
    if (values.extras !== undefined) {
      stored.extras = { ...stored.extras, ...values.extras };
    }
    this.files.writeJson(this.environment.files.profiles, store);
  }

  private read(): ProfileStore {
    return this.files.readJson<ProfileStore>(this.environment.files.profiles, {});
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
      updatedAt: profile.updated_at || '',
    };
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
