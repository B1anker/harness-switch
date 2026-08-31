import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DoctorCheck, DoctorResponse } from '@seaveyon/harness-switch-shared';
import { DOCTOR_CODES, PROBE_CODES } from '@seaveyon/harness-switch-shared';
import { createServices } from '../src/bootstrap';
import { IActivationService } from '../src/services/activation';
import { IDoctorService } from '../src/services/doctor';
import { IEnvironmentService } from '../src/services/environment';
import { IProfileService } from '../src/services/profiles';

let homeDir = '';
let binDir = '';
let services: ReturnType<typeof createServices>;
let originalPath = '';
let originalFetch: typeof globalThis.fetch;
let originalUpdateCheck: string | undefined;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), 'hsw-doctor-'));
  binDir = join(homeDir, 'bin');
  mkdirSync(binDir, { recursive: true });
  process.env.HSW_HOME_DIR = homeDir;
  process.env.HSW_DATA_DIR = join(homeDir, '.harness-switch');
  process.env.CODEX_HOME = join(homeDir, '.codex');
  originalPath = process.env.PATH ?? '';
  originalUpdateCheck = process.env.HSW_UPDATE_CHECK;
  process.env.HSW_UPDATE_CHECK = '0';
  process.env.PATH = binDir;
  // The registry update check must never hit the real network in tests.
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('offline');
  }) as unknown as typeof globalThis.fetch;
  services = createServices();
  services.get(IEnvironmentService).ensureDataDir();
});

afterEach(() => {
  delete process.env.HSW_HOME_DIR;
  delete process.env.HSW_DATA_DIR;
  delete process.env.CODEX_HOME;
  if (originalUpdateCheck === undefined) delete process.env.HSW_UPDATE_CHECK;
  else process.env.HSW_UPDATE_CHECK = originalUpdateCheck;
  process.env.PATH = originalPath;
  globalThis.fetch = originalFetch;
  rmSync(homeDir, { recursive: true, force: true });
});

function doctor() {
  return services.get(IDoctorService);
}

function fakeBin(name: string): void {
  writeFileSync(join(binDir, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
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
    chmodSync(join(homeDir, '.claude', 'settings.json'), 0o644);
    const report = await doctor().run({ harness: 'claude' });
    const check = checksOf(report, 'claude', 'claude.files.settings')[0];
    expect(check?.status).toBe('warn');
    const detail = check?.detail as { mode?: number } | undefined;
    expect(detail?.mode).toBe(0o644);
  });

  test('flags an unparsable live file as a parse error', async () => {
    fakeBin('claude');
    mkdirSync(join(homeDir, '.claude'), { recursive: true });
    writeFileSync(join(homeDir, '.claude', 'settings.json'), '{ not json');
    const report = await doctor().run({ harness: 'claude' });
    const check = checksOf(report, 'claude', 'claude.parse.settings')[0];
    expect(check?.status).toBe('error');
  });

  test('reports an unreadable live file without failing the whole run', async () => {
    fakeBin('claude');
    mkdirSync(join(homeDir, '.claude'), { recursive: true });
    const settings = join(homeDir, '.claude', 'settings.json');
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
    chmodSync(join(homeDir, '.claude', 'settings.json'), 0o000);
    const report = await doctor().run({ harness: 'claude' });
    // Unreadable is reported as invalid, never as missing: "missing" would invite a
    // reapply that overwrites a config the manager never managed to read.
    const check = checksOf(report, 'claude', 'claude.drift')[0];
    expect(check?.status).toBe('error');
    expect(check?.code).toBe('doctor.check.driftInvalid');
  });

  test('a full run survives one unreadable harness and still reports the rest', async () => {
    mkdirSync(join(homeDir, '.claude'), { recursive: true });
    const settings = join(homeDir, '.claude', 'settings.json');
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

    const settingsPath = join(homeDir, '.claude', 'settings.json');
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
