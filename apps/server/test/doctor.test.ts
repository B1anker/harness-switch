import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { DoctorCheck, DoctorResponse } from '@seaveyon/harness-switch-shared';
import { DOCTOR_CODES, PROBE_CODES } from '@seaveyon/harness-switch-shared';
import type { InstantiationService } from '../src/di';
import { IActivationService } from '../src/services/activation';
import { IDoctorService } from '../src/services/doctor';
import { IProfileService } from '../src/services/profiles';
import { createSandbox, createTestServices, OFFLINE, type Sandbox } from './support';

let sandbox: Sandbox;
let services: InstantiationService;

beforeEach(() => {
  sandbox = createSandbox('hsw-doctor', {
    env: (home) => ({
      CODEX_HOME: home('.codex'),
      HSW_UPDATE_CHECK: '0',
      // A fake bin directory is the only PATH entry, so a `which` hit means the test put
      // it there rather than the developer's machine happening to have the CLI installed.
      PATH: home('bin'),
    }),
  });
  mkdirSync(sandbox.home('bin'), { recursive: true });
  // The registry update check must never hit the real network in tests.
  sandbox.stubFetch(OFFLINE);
  services = createTestServices();
});

afterEach(() => {
  sandbox.dispose();
});

function doctor() {
  return services.get(IDoctorService);
}

function fakeBin(name: string): void {
  writeFileSync(sandbox.home('bin', name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
}

/**
 * Replaces the suite's throwing `fetch` with a relay that serves a catalog and answers
 * completions. Returns the POSTs it received, which is how a test proves a token was or
 * was not spent. The update check keeps failing, since it is a GET to a non-catalog path.
 */
function stubEndpoint(options: { completionStatus?: number } = {}): () => string[] {
  const posts: string[] = [];
  sandbox.stubFetch((target, init) => {
    const url = new URL(target);
    if ((init?.method ?? 'GET') === 'POST') {
      posts.push(url.pathname);
      return options.completionStatus
        ? Response.json({ error: 'model unavailable' }, { status: options.completionStatus })
        : Response.json({ content: [{ type: 'text', text: 'hi' }] });
    }
    if (url.pathname.endsWith('/models')) {
      return Response.json({ data: [{ id: 'claude-sonnet-4-5' }] });
    }
    throw new Error('offline');
  });
  return () => posts;
}

function checksOf(report: DoctorResponse, harness: string, id: string): DoctorCheck[] {
  return (
    report.items
      .find((item) => item.harness === harness)
      ?.checks.filter((check) => check.id === id) ?? []
  );
}

function messageOf(check: DoctorCheck | undefined): string {
  const detail = check?.detail as { message?: unknown } | undefined;
  return typeof detail?.message === 'string' ? detail.message : '';
}

function activateClaude() {
  services.get(IProfileService).upsert(
    'claude',
    {
      name: 'main',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-5',
    },
    true,
  );
  services.get(IActivationService).activate('claude', 'main');
}

describe('doctor', () => {
  test('reports a missing executable as an install error', async () => {
    const report = await doctor().run({ harness: 'claude' });
    expect(checksOf(report, 'claude', 'claude.install')[0]?.status).toBe('error');
  });

  test('finds executables that exist on PATH', async () => {
    fakeBin('claude');
    const report = await doctor().run({ harness: 'claude' });
    expect(checksOf(report, 'claude', 'claude.install')[0]?.status).toBe('ok');
  });

  test('skips PATH CLI install check for web-service harnesses', async () => {
    const report = await doctor().run({ harness: 'dsh' });
    const check = checksOf(report, 'dsh', 'dsh.install')[0];
    expect(check?.status).toBe('ok');
    expect(check?.code).toBe('doctor.check.installNotRequired');
    expect(messageOf(check)).toContain('Web 服务');
  });

  test('flags a missing target file as a files warning', async () => {
    fakeBin('claude');
    const report = await doctor().run({ harness: 'claude' });
    const check = checksOf(report, 'claude', 'claude.files.settings')[0];
    expect(check?.status).toBe('warn');
    expect(messageOf(check)).toContain('不存在');
  });

  test('flags group/other-readable config files as permission warnings', async () => {
    fakeBin('claude');
    activateClaude();
    chmodSync(sandbox.home('.claude', 'settings.json'), 0o644);
    const report = await doctor().run({ harness: 'claude' });
    const check = checksOf(report, 'claude', 'claude.files.settings')[0];
    expect(check?.status).toBe('warn');
    const detail = check?.detail as { mode?: number } | undefined;
    expect(detail?.mode).toBe(0o644);
  });

  test('flags an unparsable live file as a parse error', async () => {
    fakeBin('claude');
    mkdirSync(sandbox.home('.claude'), { recursive: true });
    writeFileSync(sandbox.home('.claude', 'settings.json'), '{ not json');
    const report = await doctor().run({ harness: 'claude' });
    const check = checksOf(report, 'claude', 'claude.parse.settings')[0];
    expect(check?.status).toBe('error');
  });

  test('reports an unreadable live file without failing the whole run', async () => {
    fakeBin('claude');
    mkdirSync(sandbox.home('.claude'), { recursive: true });
    const settings = sandbox.home('.claude', 'settings.json');
    writeFileSync(settings, '{}');
    chmodSync(settings, 0o000);

    const report = await doctor().run({ harness: 'claude' });
    expect(checksOf(report, 'claude', 'claude.files.settings')[0]?.code).toBe(
      'doctor.check.fileUnreadable',
    );
    const parse = checksOf(report, 'claude', 'claude.parse.settings')[0];
    expect(parse?.status).toBe('error');
    expect(parse?.code).toBe('doctor.check.parseUnreadable');
    expect((parse?.detail as { code?: string } | undefined)?.code).toBe('EACCES');
    // The point of the check: every other harness still gets reported.
    expect(checksOf(report, 'claude', 'claude.install')[0]?.status).toBe('ok');
  });

  test('an unreadable live file does not crash the drift check', async () => {
    fakeBin('claude');
    activateClaude();
    chmodSync(sandbox.home('.claude', 'settings.json'), 0o000);
    const report = await doctor().run({ harness: 'claude' });
    // Unreadable is reported as invalid, never as missing: "missing" would invite a
    // reapply that overwrites a config the manager never managed to read.
    const check = checksOf(report, 'claude', 'claude.drift')[0];
    expect(check?.status).toBe('error');
    expect(check?.code).toBe('doctor.check.driftInvalid');
  });

  test('a full run survives one unreadable harness and still reports the rest', async () => {
    mkdirSync(sandbox.home('.claude'), { recursive: true });
    const settings = sandbox.home('.claude', 'settings.json');
    writeFileSync(settings, '{}');
    chmodSync(settings, 0o000);

    const report = await doctor().run({});
    expect(report.items.length).toBeGreaterThan(1);
    for (const item of report.items) {
      expect(item.checks.length).toBeGreaterThan(0);
    }
  });

  test('reports drift against the active profile', async () => {
    fakeBin('claude');
    activateClaude();
    const report = await doctor().run({ harness: 'claude' });
    expect(checksOf(report, 'claude', 'claude.drift')[0]?.status).toBe('ok');

    const settingsPath = sandbox.home('.claude', 'settings.json');
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    settings.env.ANTHROPIC_BASE_URL = 'https://edited.example.com/v1';
    writeFileSync(settingsPath, JSON.stringify(settings));

    const drifted = await doctor().run({ harness: 'claude' });
    expect(checksOf(drifted, 'claude', 'claude.drift')[0]?.status).toBe('warn');
  });

  test('the probe is off by default; with it on, an unreachable endpoint is an error', async () => {
    fakeBin('claude');
    activateClaude();
    const withoutProbe = await doctor().run({ harness: 'claude' });
    expect(checksOf(withoutProbe, 'claude', 'claude.probe')).toEqual([]);

    // The suite stubs fetch to throw, so the probe fails without touching network.
    const withProbe = await doctor().run({ harness: 'claude', probe: true });
    const check = checksOf(withProbe, 'claude', 'claude.probe')[0];
    expect(check?.status).toBe('error');
    expect(check?.code).toBe(DOCTOR_CODES.probeFailed);
    const detail = check?.detail as { probed?: boolean; reason?: string } | undefined;
    expect(detail?.probed).toBe(true);
    expect(detail?.reason).toBe(PROBE_CODES.networkError);
  });

  test('the probe skips harnesses with no active profile', async () => {
    fakeBin('claude');
    const report = await doctor().run({ harness: 'claude', probe: true });
    const check = checksOf(report, 'claude', 'claude.probe')[0];
    expect(check?.status).toBe('unknown');
    expect(check?.code).toBe(DOCTOR_CODES.probeNoProfile);
  });

  test('no completion is sent unless it was asked for', async () => {
    fakeBin('claude');
    activateClaude();
    const posts = stubEndpoint();
    const report = await doctor().run({ harness: 'claude', probe: true });
    expect(checksOf(report, 'claude', 'claude.probe')[0]?.status).toBe('ok');
    // A probe alone must never bill a token: the completion check is absent entirely.
    expect(checksOf(report, 'claude', 'claude.completion')).toEqual([]);
    expect(posts()).toEqual([]);
  });

  test('a listed model that does not answer is its own error next to a healthy probe', async () => {
    fakeBin('claude');
    activateClaude();
    // The case this feature exists for: the catalog is fine, the model 500s.
    stubEndpoint({ completionStatus: 500 });
    const report = await doctor().run({ harness: 'claude', completion: true });

    // Reachability is reported as ok, because it is: the two verdicts stay separate.
    expect(checksOf(report, 'claude', 'claude.probe')[0]?.status).toBe('ok');
    const check = checksOf(report, 'claude', 'claude.completion')[0];
    expect(check?.status).toBe('error');
    expect(check?.code).toBe(DOCTOR_CODES.completionFailed);
    expect(check?.params?.model).toBe('claude-sonnet-4-5');
    expect(check?.params?.reason).toBe(PROBE_CODES.completionHttpError);
    const detail = check?.detail as { model?: string; status?: number } | undefined;
    expect(detail?.model).toBe('claude-sonnet-4-5');
    expect(detail?.status).toBe(500);
  });

  test('--completion implies the probe rather than silently doing nothing', async () => {
    fakeBin('claude');
    activateClaude();
    stubEndpoint();
    // `probe` is deliberately left off: a completion is only ever sent as part of one.
    const report = await doctor().run({ harness: 'claude', completion: true });
    expect(checksOf(report, 'claude', 'claude.probe')[0]?.status).toBe('ok');
    const check = checksOf(report, 'claude', 'claude.completion')[0];
    expect(check?.status).toBe('ok');
    expect(check?.code).toBe(DOCTOR_CODES.completionOk);
  });

  test('a repeated run replays the cached completion instead of paying again', async () => {
    fakeBin('claude');
    activateClaude();
    const posts = stubEndpoint();
    await doctor().run({ harness: 'claude', completion: true });
    expect(posts()).toHaveLength(1);

    // The whole point of caching per profile: doctor on a five-harness machine must not
    // bill a completion per harness per run.
    const second = await doctor().run({ harness: 'claude', completion: true });
    expect(posts()).toHaveLength(1);
    const check = checksOf(second, 'claude', 'claude.completion')[0];
    expect(check?.status).toBe('ok');
    // A replay says so, in prose and in detail: "answered" and "answered hours ago" differ.
    const detail = check?.detail as { cachedAt?: string } | undefined;
    expect(typeof detail?.cachedAt).toBe('string');
    expect(messageOf(check)).toContain('缓存');
  });

  test('the probe skips harnesses in official-login mode instead of crashing', async () => {
    fakeBin('claude');
    activateClaude();
    // Official mode stores a sentinel active pointer that has no profile record;
    // probing it must degrade to a skip, not surface the store lookup as an error.
    services.get(IActivationService).activateOfficial('claude');
    const report = await doctor().run({ harness: 'claude', probe: true });
    const check = checksOf(report, 'claude', 'claude.probe')[0];
    expect(check?.status).toBe('unknown');
    expect(check?.code).toBe(DOCTOR_CODES.probeOfficialLogin);
  });

  test('the update check degrades to updatedAvailable=false offline', async () => {
    fakeBin('claude');
    const report = await doctor().run({ harness: 'claude' });
    expect(report.updatedAvailable).toBe(false);
  });

  test('limits the report to the requested harness', async () => {
    fakeBin('codex');
    const report = await doctor().run({ harness: 'codex' });
    expect(report.items.map((item) => item.harness)).toEqual(['codex']);
    expect(report.items[0]?.checks.length).toBeGreaterThan(0);
  });

  test('rejects an unknown harness', async () => {
    await expect(doctor().run({ harness: 'gemini' as never })).rejects.toThrow(/unknown harness/);
  });
});
