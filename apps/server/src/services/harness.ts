import type {
  CreateProfileRequest,
  HarnessesResponse,
  HarnessId,
  HarnessSummary,
  ProfilePublic,
  UpdateProfileRequest,
} from '@seaveyon/harness-switch-shared';
import { ERROR_CODES } from '@seaveyon/harness-switch-shared';
import { HttpError } from '../common/errors';
import { createDecorator, inject } from '../di';
import { IActivationService } from './activation';
import { IAdapterRegistry } from './adapters';
import { IEnvironmentService } from './environment';
import { IFileService } from './files';
import { ILogService } from './log';
import { IProbeCacheService } from './probe-cache';
import { IProfileService } from './profiles';
import { IHarnessRegistry } from './registry';

export interface IHarnessService {
  readonly _serviceBrand: undefined;
  summary(harness: HarnessId): HarnessSummary;
  overview(): HarnessesResponse;
  createProfile(harness: HarnessId, input: CreateProfileRequest): ProfilePublic;
  updateProfile(harness: HarnessId, name: string, input: UpdateProfileRequest): ProfilePublic;
  deleteProfile(harness: HarnessId, name: string): void;
}

export const IHarnessService = createDecorator<IHarnessService>('harnessService');

/**
 * Assembles what the dashboard shows for a harness, and owns the profile writes that
 * have to keep the store, the active pointer and the live config files in agreement.
 */
@inject(
  IEnvironmentService,
  IFileService,
  IHarnessRegistry,
  IAdapterRegistry,
  IProfileService,
  IActivationService,
  IProbeCacheService,
  ILogService,
)
export class HarnessService implements IHarnessService {
  declare readonly _serviceBrand: undefined;

  constructor(
    private readonly environment: IEnvironmentService,
    private readonly files: IFileService,
    private readonly harnesses: IHarnessRegistry,
    private readonly adapters: IAdapterRegistry,
    private readonly profiles: IProfileService,
    private readonly activation: IActivationService,
    private readonly probeCache: IProbeCacheService,
    private readonly log: ILogService,
  ) {}

  overview(): HarnessesResponse {
    return {
      envFile: this.environment.files.env,
      items: this.harnesses.list().map((item) => this.summary(item.id)),
    };
  }

  summary(harness: HarnessId): HarnessSummary {
    const adapter = this.adapters.get(harness);
    const targets = adapter.targets();
    const current = adapter.officialNeedsCurrent
      ? Object.fromEntries(
          targets.map((target) => [target.key, this.files.readOptional(target.path)]),
        )
      : {};
    const capability = adapter.official?.(current);
    const profiles = this.profiles.list(harness);
    const linkedProfile = capability?.matchesProfile
      ? profiles.find(capability.matchesProfile)
      : undefined;
    return {
      id: harness,
      label: this.harnesses.label(harness),
      mode: adapter.mode,
      active: this.activation.getActive(harness),
      profiles,
      fields: adapter.fields,
      modelRequired: adapter.modelRequired,
      targets,
      envVars: adapter.envVarNames,
      envNote: adapter.envNote,
      envNoteCode: adapter.envNoteCode,
      ...(capability
        ? {
            official: {
              kind: capability.kind,
              available: capability.available,
              active: this.activation.getActive(harness)?.official === true,
              titleCode: capability.titleCode,
              hintCode: capability.hintCode,
              ...(linkedProfile ? { linkedProfileName: linkedProfile.name } : {}),
            },
          }
        : {}),
    };
  }

  createProfile(harness: HarnessId, input: CreateProfileRequest): ProfilePublic {
    this.assertNoSecondOfficialDsh(harness, input);
    const profile = this.profiles.upsert(
      harness,
      {
        name: input.name,
        copySourceName: input.copySourceName,
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        model: input.model,
        notes: input.notes,
        extras: input.extras,
        overrides: input.overrides,
        providerId: input.providerId,
        providerEndpoint: input.providerEndpoint,
      },
      true,
    );
    try {
      this.activation.syncProfile(harness, profile.name);
    } catch (error) {
      this.profiles.remove(harness, profile.name);
      throw error;
    }
    return profile;
  }

  updateProfile(harness: HarnessId, name: string, input: UpdateProfileRequest): ProfilePublic {
    const wasActive = this.activation.getActive(harness)?.name === name;
    // Snapshot the store before touching it: a live-file rewrite that fails part
    // way must not leave the persisted profile, the active pointer and the live
    // files each pointing at a different state.
    const snapshot = this.files.readOptional(this.environment.files.profiles);
    let persisted = false;
    try {
      const profile = this.profiles.upsert(
        harness,
        {
          name: input.name ?? name,
          sourceName: name,
          baseUrl: input.baseUrl,
          apiKey: input.apiKey,
          model: input.model,
          notes: input.notes,
          extras: input.extras,
          overrides: input.overrides,
          providerId: input.providerId,
          providerEndpoint: input.providerEndpoint,
        },
        false,
      );
      persisted = true;
      // Editing the live provider must reach the live files immediately, otherwise the UI
      // would show the new values while the tool keeps using the old ones.
      this.activation.reconcileProfileUpdate(harness, name, profile.name);
      this.activation.syncProfile(harness, profile.name);
      return profile;
    } catch (error) {
      if (persisted) {
        this.rollback(harness, name, snapshot, wasActive);
      }
      throw error;
    }
  }

  deleteProfile(harness: HarnessId, name: string): void {
    this.activation.prepareDelete(harness, name);
    this.profiles.remove(harness, name);
    // A later profile of the same name is a different endpoint; it must not inherit this
    // one's verdict, and the fingerprint alone would not catch an identical re-creation.
    this.probeCache.forget(harness, name);
  }

  /**
   * Unwinds a half-applied edit. Every failure here is logged rather than raised: the
   * caller is already throwing the error that triggered the rollback, and replacing it
   * would hide the real cause.
   */
  private rollback(
    harness: HarnessId,
    name: string,
    snapshot: string | undefined,
    wasActive: boolean,
  ): void {
    try {
      this.files.restore(this.environment.files.profiles, snapshot);
    } catch (error) {
      this.log.error(`edit rollback: failed to restore the profile store`, error);
      return;
    }
    if (!wasActive) {
      return;
    }
    try {
      // Put the live files and the active pointer back on the previous
      // profile so the edit is fully undone, not half-applied.
      this.activation.activate(harness, name);
    } catch (error) {
      this.log.error(`edit rollback: failed to re-activate ${harness}/${name}`, error);
    }
  }

  /**
   * DeepSeek's official route writes one fixed native configuration, so a second
   * official profile would be a duplicate that can never be told apart from the first.
   */
  private assertNoSecondOfficialDsh(harness: HarnessId, input: CreateProfileRequest): void {
    if (harness !== 'dsh') {
      return;
    }
    // A server-side copy may inherit its `providerType` when the request leaves
    // `extras` absent. Check the eventual type, not just the untrusted payload.
    const copiedProviderType = input.copySourceName
      ? this.profiles.get(harness, input.copySourceName)?.extras.providerType
      : undefined;
    if (
      (input.extras?.providerType ?? copiedProviderType) === 'official' &&
      this.profiles.list('dsh').some((profile) => profile.extras.providerType === 'official')
    ) {
      throw new HttpError(409, 'DeepSeek 官方配置已存在，请直接编辑现有官方配置', {
        code: ERROR_CODES.officialProfileAlreadyExists,
      });
    }
  }
}
