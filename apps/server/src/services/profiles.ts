import type { HarnessId, ProfilePublic } from '@seaveyon/harness-switch-shared';
import { HttpError } from '../common/errors';
import { createDecorator, inject } from '../di';
import { type EncryptedValue, ICryptoService } from './crypto';
import { IEnvironmentService } from './environment';
import { IFileService } from './files';
import { IHarnessRegistry } from './registry';

export type StoredProfile = {
  base_url: string;
  api_key: EncryptedValue;
  model: string;
  notes: string;
  updated_at: string;
};

export type ProfileStore = Record<string, Record<string, StoredProfile>>;

export type ProfileInput = {
  name: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  notes?: string;
};

export type DecryptedProfile = {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
};

export interface IProfileService {
  readonly _serviceBrand: undefined;
  list(harness: HarnessId): ProfilePublic[];
  get(harness: HarnessId, name: string): ProfilePublic | undefined;
  upsert(harness: HarnessId, input: ProfileInput, isCreate: boolean): ProfilePublic;
  remove(harness: HarnessId, name: string): void;
  decrypt(harness: HarnessId, name: string): DecryptedProfile;
}

export const IProfileService = createDecorator<IProfileService>('profileService');

@inject(IEnvironmentService, IFileService, ICryptoService, IHarnessRegistry)
export class ProfileService implements IProfileService {
  declare readonly _serviceBrand: undefined;

  constructor(
    private readonly environment: IEnvironmentService,
    private readonly files: IFileService,
    private readonly crypto: ICryptoService,
    private readonly harnesses: IHarnessRegistry,
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
    this.assertName(name);
    const store = this.read();
    store[harness] ||= {};
    const prior = store[harness][name];
    if (isCreate && prior) {
      throw new HttpError(409, 'profile already exists');
    }
    if (!isCreate && !prior) {
      throw new HttpError(404, 'profile not found');
    }
    const apiKey = input.apiKey || (prior ? this.crypto.decrypt(prior.api_key) : '');
    if (isCreate && !apiKey) {
      throw new HttpError(400, 'apiKey is required');
    }
    store[harness][name] = {
      base_url: (input.baseUrl ?? prior?.base_url ?? '').trim(),
      api_key: this.crypto.encrypt(apiKey),
      model: (input.model ?? prior?.model ?? '').trim(),
      notes: input.notes ?? prior?.notes ?? '',
      updated_at: new Date().toISOString(),
    };
    this.files.writeJson(this.environment.files.profiles, store);
    return this.toPublic(harness, name, store[harness][name]);
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
    };
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
