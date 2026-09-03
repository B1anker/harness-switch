import { createHash } from 'node:crypto';
import type { HarnessId, ProbeCompletion } from '@seaveyon/harness-switch-shared';
import { createDecorator, inject } from '../di';
import { IEnvironmentService } from './environment';
import { IFileService } from './files';

/**
 * What the cached outcome was measured against. A profile that now points at a different
 * endpoint, model, protocol or credential has to be tested again, so the fingerprint is
 * compared before a cached entry is replayed.
 */
export type ProbeCacheKey = {
  baseUrl: string;
  model: string;
  protocol?: string;
  apiKey: string;
};

type CacheEntry = {
  fingerprint: string;
  /** ISO timestamp of the request that produced `completion`. */
  at: string;
  completion: ProbeCompletion;
};

type ProbeCacheStore = Record<string, Record<string, CacheEntry>>;

export interface IProbeCacheService {
  readonly _serviceBrand: undefined;
  /** The cached outcome for this profile, or undefined when absent, stale or superseded. */
  get(harness: HarnessId, profile: string, key: ProbeCacheKey): ProbeCompletion | undefined;
  set(harness: HarnessId, profile: string, key: ProbeCacheKey, value: ProbeCompletion): void;
  /** Drops a profile's entry, so a deleted profile leaves nothing behind. */
  forget(harness: HarnessId, profile: string): void;
}

export const IProbeCacheService = createDecorator<IProbeCacheService>('probeCacheService');

/**
 * A working endpoint stays working, so a success is worth holding for hours: that is what
 * keeps `doctor --probe` from billing a completion on every run.
 */
const OK_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * A failure gets a short life instead. Relays fail transiently, and a cached red X that
 * outlives the outage would report a healthy endpoint as broken — while still being short
 * enough that a UI hammering the button does not bill a request per click.
 */
const FAILURE_TTL_MS = 5 * 60 * 1000;

/**
 * Remembers the completion outcome of each profile so the token-spending part of a probe
 * does not have to be repeated on every doctor run or dialog open.
 *
 * Only the completion is cached. The catalog read is free and fast, so it always runs
 * live and its result is never replayed — which also means a cached completion is always
 * reported alongside a fresh reachability verdict.
 *
 * The store is disposable by design: a corrupt or unreadable file is treated as empty
 * rather than raised, because the worst outcome of a lost cache is one extra request.
 */
@inject(IEnvironmentService, IFileService)
export class ProbeCacheService implements IProbeCacheService {
  declare readonly _serviceBrand: undefined;

  constructor(
    private readonly environment: IEnvironmentService,
    private readonly files: IFileService,
  ) {}

  get(harness: HarnessId, profile: string, key: ProbeCacheKey): ProbeCompletion | undefined {
    const entry = this.read()[harness]?.[profile];
    if (!entry || entry.fingerprint !== fingerprint(key)) {
      return undefined;
    }
    const age = Date.now() - Date.parse(entry.at);
    // A future or unparseable timestamp means a hand-edited or clock-skewed file; treat it
    // as expired rather than trusting it forever.
    if (!Number.isFinite(age) || age < 0) {
      return undefined;
    }
    if (age > (entry.completion.ok ? OK_TTL_MS : FAILURE_TTL_MS)) {
      return undefined;
    }
    return { ...entry.completion, cachedAt: entry.at };
  }

  set(harness: HarnessId, profile: string, key: ProbeCacheKey, value: ProbeCompletion): void {
    const store = this.read();
    store[harness] ||= {};
    // `cachedAt` describes a replay, so it is never persisted: `at` already records when
    // this outcome was measured, and keeping both would let a replay be re-cached as new.
    const { cachedAt: _replayed, ...completion } = value;
    store[harness][profile] = {
      fingerprint: fingerprint(key),
      at: new Date().toISOString(),
      completion,
    };
    this.write(store);
  }

  forget(harness: HarnessId, profile: string): void {
    const store = this.read();
    if (!store[harness]?.[profile]) {
      return;
    }
    delete store[harness][profile];
    this.write(store);
  }

  private read(): ProbeCacheStore {
    return this.files.readJson<ProbeCacheStore>(this.environment.files.probeCache, {});
  }

  private write(store: ProbeCacheStore): void {
    try {
      this.files.writeJson(this.environment.files.probeCache, store);
    } catch {
      // A cache that cannot be persisted must not fail the probe that produced it.
    }
  }
}

/**
 * The credential is included so a rotated key invalidates a cached `unauthorized`, and it
 * is hashed rather than stored: this file holds no secrets, only a digest of one.
 */
function fingerprint(key: ProbeCacheKey): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        key.baseUrl,
        key.model,
        key.protocol ?? '',
        createHash('sha256').update(key.apiKey).digest('hex'),
      ]),
    )
    .digest('hex');
}
