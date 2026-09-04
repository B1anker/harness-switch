import type { CompletionProtocol, HarnessId, ProbeResult } from '@seaveyon/harness-switch-shared';
import { createDecorator, inject } from '../di';
import { IAdapterRegistry } from './adapters';
import type { AdapterProfile } from './adapters/types';
import { IProbeService } from './probe';
import { IProbeCacheService } from './probe-cache';

export type ProfileProbeOptions = {
  /** Send one minimal completion as well; off by default because it costs tokens. */
  completion?: boolean;
  /** Model to complete against. Defaults to the profile's own model. */
  model?: string;
  /** Wire protocol to try first. Defaults to the one the harness itself would use. */
  protocol?: CompletionProtocol;
  /** Ignore a cached completion outcome and send a fresh request. */
  refresh?: boolean;
};

export interface IProbeProfileService {
  readonly _serviceBrand: undefined;
  probe(
    harness: HarnessId,
    profile: AdapterProfile,
    options?: ProfileProbeOptions,
  ): Promise<ProbeResult>;
}

export const IProbeProfileService = createDecorator<IProbeProfileService>('probeProfileService');

/**
 * Probes a saved profile, replaying a still-valid cached completion instead of paying for
 * a new one.
 *
 * Shared by the profile probe route and by doctor so both resolve the protocol the same
 * way and, more importantly, spend a token in exactly the same cases: `doctor --probe
 * --completion` on a five-harness machine would otherwise bill five completions per run.
 */
@inject(IProbeService, IProbeCacheService, IAdapterRegistry)
export class ProbeProfileService implements IProbeProfileService {
  declare readonly _serviceBrand: undefined;

  constructor(
    private readonly probes: IProbeService,
    private readonly cache: IProbeCacheService,
    private readonly adapters: IAdapterRegistry,
  ) {}

  async probe(
    harness: HarnessId,
    profile: AdapterProfile,
    options: ProfileProbeOptions = {},
  ): Promise<ProbeResult> {
    // An explicit request wins; otherwise the harness's own wire protocol is used, so the
    // completion tests the shape the tool will really call instead of sweeping all three.
    const protocol = options.protocol ?? this.adapters.get(harness).completionProtocol?.(profile);
    const model = (options.model ?? profile.model).trim();
    const input = {
      baseUrl: profile.baseUrl,
      apiKey: profile.apiKey,
      ...(model ? { model } : {}),
      ...(protocol ? { protocol } : {}),
    };
    if (!options.completion) {
      return this.probes.probe(input);
    }

    // A cached outcome has to describe a repeatable test. Without a named model the probe
    // completes against whatever the catalog happened to list first, which is not the same
    // model from one run to the next, so those never read or write the cache.
    const key = model
      ? { baseUrl: profile.baseUrl, model, protocol, apiKey: profile.apiKey }
      : undefined;
    const cached = key && !options.refresh ? this.cache.get(harness, profile.name, key) : undefined;
    if (cached) {
      // The catalog read is free, so it always runs live: a replayed completion is still
      // reported next to a current reachability verdict.
      return { ...(await this.probes.probe(input)), completion: cached };
    }

    const result = await this.probes.probe({ ...input, completion: true });
    if (key && result.completion) {
      this.cache.set(harness, profile.name, key, result.completion);
    }
    return result;
  }
}
