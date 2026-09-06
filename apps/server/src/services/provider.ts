import type {
  CompletionProtocol,
  LocalizedMessage,
  ProbeResult,
  ProviderMutationResponse,
  ProviderPublic,
  UpdateProviderRequest,
} from '@seaveyon/harness-switch-shared';
import { ERROR_CODES, PROBE_CODES, WARNING_CODES } from '@seaveyon/harness-switch-shared';
import { HttpError } from '../common/errors';
import { createDecorator, inject } from '../di';
import { IActivationService } from './activation';
import { ILogService } from './log';
import { IModelFavoriteStore } from './model-favorite-store';
import { IProbeService } from './probe';
import { IProfileService } from './profiles';
import { IHarnessRegistry } from './registry';
import { IVaultService } from './vault';

export type ProviderProbeOptions = {
  endpoint?: string;
  completion?: boolean;
  model?: string;
  protocol?: CompletionProtocol;
};

export interface IProviderService {
  readonly _serviceBrand: undefined;
  /** Rewrites the entry, then re-syncs every profile and live file that mirrors it. */
  update(id: string, input: UpdateProviderRequest): ProviderMutationResponse;
  remove(id: string): void;
  probe(id: string, options: ProviderProbeOptions): Promise<ProbeResult>;
}

export const IProviderService = createDecorator<IProviderService>('providerService');

/**
 * The write-side workflows of `/api/providers`.
 *
 * These live outside `IVaultService` on purpose: they need the profile store and the
 * activation path, and `IProfileService` already depends on the vault — putting them
 * there would close a dependency cycle.
 */
@inject(
  IVaultService,
  IProfileService,
  IActivationService,
  IProbeService,
  IHarnessRegistry,
  ILogService,
  IModelFavoriteStore,
)
export class ProviderService implements IProviderService {
  declare readonly _serviceBrand: undefined;

  constructor(
    private readonly vault: IVaultService,
    private readonly profiles: IProfileService,
    private readonly activation: IActivationService,
    private readonly probes: IProbeService,
    private readonly harnesses: IHarnessRegistry,
    private readonly log: ILogService,
    private readonly favorites: IModelFavoriteStore,
  ) {}

  update(id: string, input: UpdateProviderRequest): ProviderMutationResponse {
    const references = this.favorites
      .list()
      .flatMap((favorite) =>
        favorite.connections.filter((connection) => connection.providerId === id),
      );
    if (
      input.endpoints &&
      references.some(
        (connection) =>
          !input.endpoints!.some((endpoint) => endpoint.key === connection.endpointKey),
      )
    ) {
      throw new HttpError(409, ERROR_CODES.favoriteEndpointMissing, {
        code: ERROR_CODES.favoriteEndpointMissing,
      });
    }
    const { provider, affected } = this.vault.update(id, input);

    // Refresh the cached credential/base URL of every referencing profile so the
    // store stays a faithful mirror of the vault (single write for all of them).
    this.profiles.sweepVaultCache(id, this.vault.decrypt(id), provider.endpoints);

    // Re-apply every ACTIVE profile that references this provider so the live files
    // reflect the rotation/endpoint change immediately. Failures are reported, never
    // raised: the store is already updated and the vault stays the source of truth.
    const warnings: LocalizedMessage[] = [];
    for (const ref of affected) {
      // A hand-edited store can name a harness this build does not know; skip it
      // rather than letting an unknown id reach the activation path.
      if (!this.harnesses.has(ref.harness)) {
        continue;
      }
      const harness = ref.harness;
      if (this.activation.getActive(harness)?.name !== ref.name) {
        continue;
      }
      const profile = this.profiles.get(harness, ref.name);
      if (
        profile?.providerEndpoint &&
        !provider.endpoints.some((endpoint) => endpoint.key === profile.providerEndpoint)
      ) {
        warnings.push({
          code: WARNING_CODES.endpointFallback,
          data: { harness, profile: ref.name, endpoint: profile.providerEndpoint },
        });
      }
      try {
        this.activation.activate(harness, ref.name);
      } catch (error) {
        const reason = (error as Error).message;
        this.log.error(`providers update: failed to re-apply ${harness}/${ref.name}`, error);
        warnings.push({
          code: WARNING_CODES.reapplyFailed,
          data: { harness, profile: ref.name, reason },
        });
      }
    }
    return { provider, warnings };
  }

  remove(id: string): void {
    if (
      this.favorites
        .list()
        .some((favorite) => favorite.connections.some((connection) => connection.providerId === id))
    ) {
      throw new HttpError(409, ERROR_CODES.favoriteInUse, { code: ERROR_CODES.favoriteInUse });
    }
    this.vault.remove(id);
  }

  async probe(id: string, options: ProviderProbeOptions): Promise<ProbeResult> {
    const apiKey = this.vault.decrypt(id);
    const baseUrl = endpointBaseUrl(this.vault.get(id), options.endpoint);
    if (!baseUrl) {
      return { ok: false, code: PROBE_CODES.missingBaseUrl };
    }
    return this.probes.probe({
      baseUrl,
      apiKey,
      // A vault entry owns a credential, not a model, so there is no per-profile
      // outcome to cache: the model comes from the request or from the catalog.
      completion: options.completion,
      model: options.model,
      protocol: options.protocol,
    });
  }
}

/** A named endpoint wins; absent or unknown names fall back to the first endpoint. */
function endpointBaseUrl(entry: ProviderPublic, endpointKey: string | undefined): string | null {
  if (endpointKey?.trim()) {
    const named = entry.endpoints.find((candidate) => candidate.key === endpointKey.trim());
    if (named) {
      return named.baseUrl;
    }
  }
  return entry.endpoints[0]?.baseUrl ?? null;
}
