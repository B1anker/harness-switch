import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HarnessId, ProbeCompletion, ProbeResult } from '@seaveyon/harness-switch-shared';
import { PROBE_CODES } from '@seaveyon/harness-switch-shared';
import { createServices } from '../src/bootstrap';
import type { AdapterProfile, HarnessAdapter } from '../src/services/adapters/types';
import { IEnvironmentService } from '../src/services/environment';
import { IFileService } from '../src/services/files';
import type { IProbeService, ProbeInput } from '../src/services/probe';
import { IProbeCacheService } from '../src/services/probe-cache';
import { probeSavedProfile } from '../src/services/probe-profile';

let homeDir = '';
let services: ReturnType<typeof createServices>;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), 'hsw-probe-cache-'));
  process.env.HSW_HOME_DIR = homeDir;
  process.env.HSW_DATA_DIR = join(homeDir, '.harness-switch');
  services = createServices();
  services.get(IEnvironmentService).ensureDataDir();
});

afterEach(() => {
  delete process.env.HSW_HOME_DIR;
  delete process.env.HSW_DATA_DIR;
  rmSync(homeDir, { recursive: true, force: true });
});

function cache(): IProbeCacheService {
  return services.get(IProbeCacheService);
}

const KEY = { baseUrl: 'https://api.example.com/v1', model: 'gpt-x', apiKey: 'sk-one' };

function completion(overrides: Partial<ProbeCompletion> = {}): ProbeCompletion {
  return { ok: true, model: 'gpt-x', protocol: 'openai-chat', latencyMs: 12, ...overrides };
}

/**
 * Rewrites a stored entry's timestamp so TTL expiry can be tested without waiting hours.
 * The store is a plain JSON file by design, so ageing it is a file edit.
 */
function ageEntry(harness: HarnessId, profile: string, ms: number): void {
  const path = services.get(IEnvironmentService).files.probeCache;
  const files = services.get(IFileService);
  const store = files.readJson<Record<string, Record<string, { at: string }>>>(path, {});
  const entry = store[harness]?.[profile];
  if (!entry) throw new Error('no entry to age');
  entry.at = new Date(Date.now() - ms).toISOString();
  files.writeJson(path, store);
}

describe('probe cache', () => {
  test('a stored outcome comes back stamped with when it was measured', () => {
    cache().set('claude', 'main', KEY, completion());
    const hit = cache().get('claude', 'main', KEY);
    expect(hit?.ok).toBe(true);
    expect(hit?.model).toBe('gpt-x');
    // `cachedAt` is what lets the UI say "answered four hours ago" rather than "answers".
    expect(typeof hit?.cachedAt).toBe('string');
    expect(Number.isNaN(Date.parse(hit?.cachedAt ?? ''))).toBe(false);
  });

  test('an absent entry is a miss, and so is another profile or harness', () => {
    cache().set('claude', 'main', KEY, completion());
    expect(cache().get('claude', 'other', KEY)).toBeUndefined();
    expect(cache().get('codex', 'main', KEY)).toBeUndefined();
  });

  test('every part of the fingerprint invalidates the entry when it changes', () => {
    cache().set('claude', 'main', { ...KEY, protocol: 'openai-chat' }, completion());
    expect(cache().get('claude', 'main', { ...KEY, protocol: 'openai-chat' })).toBeDefined();

    // A profile now pointing elsewhere, at another model, over another protocol, or with a
    // rotated key describes a different test; none may replay the old verdict.
    expect(
      cache().get('claude', 'main', {
        ...KEY,
        baseUrl: 'https://other.example.com/v1',
        protocol: 'openai-chat',
      }),
    ).toBeUndefined();
    expect(
      cache().get('claude', 'main', { ...KEY, model: 'gpt-y', protocol: 'openai-chat' }),
    ).toBeUndefined();
    expect(
      cache().get('claude', 'main', { ...KEY, protocol: 'anthropic-messages' }),
    ).toBeUndefined();
    expect(
      cache().get('claude', 'main', { ...KEY, apiKey: 'sk-two', protocol: 'openai-chat' }),
    ).toBeUndefined();
  });

  test('the file holds a digest of the credential, never the credential', () => {
    cache().set('claude', 'main', KEY, completion());
    const raw = services
      .get(IFileService)
      .readText(services.get(IEnvironmentService).files.probeCache);
    expect(raw).not.toContain('sk-one');
  });

  test('a success outlives a failure, and both eventually expire', () => {
    const hour = 60 * 60 * 1000;
    cache().set('claude', 'ok-profile', KEY, completion());
    // Six hours for a success: enough that repeated doctor runs cost nothing.
    ageEntry('claude', 'ok-profile', 5 * hour);
    expect(cache().get('claude', 'ok-profile', KEY)).toBeDefined();
    ageEntry('claude', 'ok-profile', 7 * hour);
    expect(cache().get('claude', 'ok-profile', KEY)).toBeUndefined();

    // Five minutes for a failure: a transient outage must not be reported as broken later.
    const failed = completion({ ok: false, code: PROBE_CODES.completionHttpError, status: 500 });
    cache().set('claude', 'bad-profile', KEY, failed);
    ageEntry('claude', 'bad-profile', 2 * 60 * 1000);
    expect(cache().get('claude', 'bad-profile', KEY)).toBeDefined();
    ageEntry('claude', 'bad-profile', 10 * 60 * 1000);
    expect(cache().get('claude', 'bad-profile', KEY)).toBeUndefined();
  });

  test('a future or unparseable timestamp is treated as expired, not trusted forever', () => {
    cache().set('claude', 'main', KEY, completion());
    ageEntry('claude', 'main', -60 * 60 * 1000);
    expect(cache().get('claude', 'main', KEY)).toBeUndefined();

    const path = services.get(IEnvironmentService).files.probeCache;
    const files = services.get(IFileService);
    const store = files.readJson<Record<string, Record<string, { at: string }>>>(path, {});
    store.claude!.main!.at = 'not a date';
    files.writeJson(path, store);
    expect(cache().get('claude', 'main', KEY)).toBeUndefined();
  });

  test('a replay is never re-cached as a fresh measurement', () => {
    cache().set('claude', 'main', KEY, completion());
    const replayed = cache().get('claude', 'main', KEY);
    expect(replayed?.cachedAt).toBeDefined();

    // Writing a replay back must record when it was measured, not that it was replayed.
    cache().set('claude', 'main', KEY, replayed!);
    const path = services.get(IEnvironmentService).files.probeCache;
    const raw = services.get(IFileService).readText(path);
    expect(raw).not.toContain('cachedAt');
  });

  test('forget drops one profile and leaves the rest alone', () => {
    cache().set('claude', 'main', KEY, completion());
    cache().set('claude', 'spare', KEY, completion());
    cache().forget('claude', 'main');
    expect(cache().get('claude', 'main', KEY)).toBeUndefined();
    expect(cache().get('claude', 'spare', KEY)).toBeDefined();
    // Forgetting what was never there is a no-op, not a throw.
    expect(() => cache().forget('claude', 'main')).not.toThrow();
  });

  test('a corrupt store reads as empty rather than raising', () => {
    writeFileSync(services.get(IEnvironmentService).files.probeCache, '{ not json');
    expect(cache().get('claude', 'main', KEY)).toBeUndefined();
    // And it recovers: a write over the garbage restores a usable store.
    cache().set('claude', 'main', KEY, completion());
    expect(cache().get('claude', 'main', KEY)).toBeDefined();
  });
});

/* ------------------------------------------------------------------ */
/* probeSavedProfile                                                   */
/* ------------------------------------------------------------------ */

/** Records what it was asked and answers with a fixed catalog plus optional completion. */
function recordingProbe(): IProbeService & { inputs: ProbeInput[] } {
  const inputs: ProbeInput[] = [];
  return {
    _serviceBrand: undefined,
    inputs,
    async probe(input: ProbeInput): Promise<ProbeResult> {
      inputs.push(input);
      const result: ProbeResult = { ok: true, status: 200, models: ['gpt-x'] };
      return input.completion
        ? { ...result, completion: completion({ latencyMs: inputs.length }) }
        : result;
    },
  };
}

function fakeAdapter(protocol?: 'openai-chat' | 'anthropic-messages'): HarnessAdapter {
  return {
    completionProtocol: () => protocol,
  } as unknown as HarnessAdapter;
}

const PROFILE: AdapterProfile = {
  name: 'main',
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-one',
  model: 'gpt-x',
  extras: {},
};

describe('probeSavedProfile', () => {
  test('without a completion request it is a plain catalog read', async () => {
    const probe = recordingProbe();
    const result = await probeSavedProfile(
      { probe, cache: cache(), adapter: fakeAdapter('openai-chat') },
      'claude',
      PROFILE,
    );
    expect(result.ok).toBe(true);
    expect(result.completion).toBeUndefined();
    expect(probe.inputs[0]?.completion).toBeUndefined();
    // Nothing was measured, so nothing was stored.
    expect(cache().get('claude', 'main', { ...KEY, protocol: 'openai-chat' })).toBeUndefined();
  });

  test('the harness protocol is used so the probe tests the shape the tool will call', async () => {
    const probe = recordingProbe();
    await probeSavedProfile(
      { probe, cache: cache(), adapter: fakeAdapter('anthropic-messages') },
      'claude',
      PROFILE,
      { completion: true },
    );
    expect(probe.inputs[0]?.protocol).toBe('anthropic-messages');

    // An explicit request still wins over the adapter's own answer.
    const explicit = recordingProbe();
    await probeSavedProfile(
      { probe: explicit, cache: cache(), adapter: fakeAdapter('anthropic-messages') },
      'claude',
      PROFILE,
      { completion: true, protocol: 'openai-chat', refresh: true },
    );
    expect(explicit.inputs[0]?.protocol).toBe('openai-chat');
  });

  test('a second run replays the completion instead of paying for another', async () => {
    const first = recordingProbe();
    const fresh = await probeSavedProfile(
      { probe: first, cache: cache(), adapter: fakeAdapter('openai-chat') },
      'claude',
      PROFILE,
      { completion: true },
    );
    expect(fresh.completion?.ok).toBe(true);
    expect(fresh.completion?.cachedAt).toBeUndefined();

    const second = recordingProbe();
    const replayed = await probeSavedProfile(
      { probe: second, cache: cache(), adapter: fakeAdapter('openai-chat') },
      'claude',
      PROFILE,
      { completion: true },
    );
    expect(replayed.completion?.cachedAt).toBeDefined();
    // The catalog read is free, so it still ran live; only the completion was replayed.
    expect(second.inputs).toHaveLength(1);
    expect(second.inputs[0]?.completion).toBeUndefined();
    expect(replayed.ok).toBe(true);
  });

  test('refresh bypasses a cached verdict the user asked to redo', async () => {
    await probeSavedProfile(
      { probe: recordingProbe(), cache: cache(), adapter: fakeAdapter('openai-chat') },
      'claude',
      PROFILE,
      { completion: true },
    );
    const again = recordingProbe();
    const result = await probeSavedProfile(
      { probe: again, cache: cache(), adapter: fakeAdapter('openai-chat') },
      'claude',
      PROFILE,
      { completion: true, refresh: true },
    );
    expect(again.inputs[0]?.completion).toBe(true);
    expect(result.completion?.cachedAt).toBeUndefined();
  });

  test('an edited endpoint is a cache miss, not a stale replay', async () => {
    await probeSavedProfile(
      { probe: recordingProbe(), cache: cache(), adapter: fakeAdapter('openai-chat') },
      'claude',
      PROFILE,
      { completion: true },
    );
    const moved = recordingProbe();
    const result = await probeSavedProfile(
      { probe: moved, cache: cache(), adapter: fakeAdapter('openai-chat') },
      'claude',
      { ...PROFILE, baseUrl: 'https://elsewhere.example.com/v1' },
      { completion: true },
    );
    expect(moved.inputs[0]?.completion).toBe(true);
    expect(result.completion?.cachedAt).toBeUndefined();
  });

  test('a probe with no model never touches the cache', async () => {
    // Without a named model the probe completes against whatever the catalog listed first,
    // which is not the same model from one run to the next — not a repeatable test.
    const modelless = { ...PROFILE, model: '' };
    const first = recordingProbe();
    await probeSavedProfile(
      { probe: first, cache: cache(), adapter: fakeAdapter('openai-chat') },
      'claude',
      modelless,
      { completion: true },
    );
    expect(first.inputs[0]?.model).toBeUndefined();

    const second = recordingProbe();
    const result = await probeSavedProfile(
      { probe: second, cache: cache(), adapter: fakeAdapter('openai-chat') },
      'claude',
      modelless,
      { completion: true },
    );
    expect(second.inputs[0]?.completion).toBe(true);
    expect(result.completion?.cachedAt).toBeUndefined();
  });

  test('an option-named model is cached separately from the profile default', async () => {
    await probeSavedProfile(
      { probe: recordingProbe(), cache: cache(), adapter: fakeAdapter('openai-chat') },
      'claude',
      PROFILE,
      { completion: true },
    );
    const other = recordingProbe();
    await probeSavedProfile(
      { probe: other, cache: cache(), adapter: fakeAdapter('openai-chat') },
      'claude',
      PROFILE,
      { completion: true, model: 'gpt-y' },
    );
    // Testing a different model has to send a request, however recent the other verdict is.
    expect(other.inputs[0]?.completion).toBe(true);
    expect(other.inputs[0]?.model).toBe('gpt-y');
  });

  test('an adapter with no protocol opinion leaves the probe to try each in turn', async () => {
    const probe = recordingProbe();
    await probeSavedProfile(
      { probe, cache: cache(), adapter: fakeAdapter(undefined) },
      'claude',
      PROFILE,
      { completion: true },
    );
    expect(probe.inputs[0]?.protocol).toBeUndefined();
  });
});
