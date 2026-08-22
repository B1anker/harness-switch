import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DriftSummary } from '@seaveyon/harness-switch-shared';
import { ERROR_CODES } from '@seaveyon/harness-switch-shared';
import { createServices } from '../src/bootstrap';
import { IActivationService } from '../src/services/activation';
import { IDriftService, semanticEqual } from '../src/services/drift';
import { IEnvironmentService } from '../src/services/environment';
import { IProfileService } from '../src/services/profiles';
import { expectHttpError } from './support/http-error';

let homeDir = '';
let services: ReturnType<typeof createServices>;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), 'hsw-drift-'));
  process.env.HSW_HOME_DIR = homeDir;
  process.env.HSW_DATA_DIR = join(homeDir, '.harness-switch');
  process.env.CODEX_HOME = join(homeDir, '.codex');
  services = createServices();
  services.get(IEnvironmentService).ensureDataDir();
});

afterEach(() => {
  delete process.env.HSW_HOME_DIR;
  delete process.env.HSW_DATA_DIR;
  delete process.env.CODEX_HOME;
  rmSync(homeDir, { recursive: true, force: true });
});

function drift() {
  return services.get(IDriftService);
}

function profiles() {
  return services.get(IProfileService);
}

function activation() {
  return services.get(IActivationService);
}

function claudeSettings(): string {
  return join(homeDir, '.claude', 'settings.json');
}

function activateClaude(name = 'main') {
  profiles().upsert(
    'claude',
    {
      name,
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-5',
    },
    true,
  );
  activation().activate('claude', name);
}

function fileOf(report: DriftSummary, key: string) {
  const file = report.files.find((candidate) => candidate.key === key);
  if (!file) {
    throw new Error(`target ${key} missing from drift report`);
  }
  return file;
}

describe('drift inspect', () => {
  test('reports unknown for a harness with no active profile', () => {
    const report = drift().inspect('claude');
    expect(report.status).toBe('unknown');
    expect(report.active).toBe(false);
    expect(report.files).toEqual([]);
  });

  test('an untouched active profile is in-sync', () => {
    activateClaude();
    const report = drift().inspect('claude');
    expect(report.status).toBe('in-sync');
    expect(report.files.every((file) => file.status === 'in-sync')).toBe(true);
  });

  test('does not report an absent unmanaged Codex login cache as drift', () => {
    activation().activateOfficial('codex');

    const report = drift().inspect('codex');
    expect(report.status).toBe('in-sync');
    expect(report.files.some((file) => file.key === 'auth')).toBe(false);
  });

  test('a hand edit shows as drifted with expected and live content', () => {
    activateClaude();
    const settings = JSON.parse(readFileSync(claudeSettings(), 'utf8'));
    settings.env.ANTHROPIC_BASE_URL = 'https://edited-by-hand.example.com/v1';
    writeFileSync(claudeSettings(), JSON.stringify(settings));

    const report = drift().inspect('claude');
    expect(report.status).toBe('drifted');
    const file = fileOf(report, 'settings');
    expect(file.status).toBe('drifted');
    expect(file.currentContent).toContain('edited-by-hand.example.com');
    expect(file.expectedContent).toContain('api.example.com');
  });

  test('a deleted live file shows as missing', () => {
    activateClaude();
    rmSync(claudeSettings());
    const report = drift().inspect('claude');
    expect(fileOf(report, 'settings').status).toBe('missing');
    expect(report.status).toBe('missing');
  });

  test('an unparsable live file shows as invalid', () => {
    activateClaude();
    writeFileSync(claudeSettings(), '{ not json');
    const report = drift().inspect('claude');
    expect(fileOf(report, 'settings').status).toBe('invalid');
    expect(report.status).toBe('invalid');
  });

  test('semantic equivalence ignores key order and int/float differences', () => {
    expect(semanticEqual('json', '{"a":1,"b":2}', '{\n  "b": 2,\n  "a": 1\n}')).toBe(true);
    expect(semanticEqual('json', '{"a":[1,2]}', '{"a":[2,1]}')).toBe(false);
    expect(semanticEqual('toml', 'a = 1', 'a = 1.0')).toBe(true);
    expect(semanticEqual('yaml', 'a: 1\nb:\n  - x\n', 'b:\n  - x\na: 1\n')).toBe(true);
    expect(semanticEqual('text', 'line1\n', 'line2\n')).toBe(false);
    expect(semanticEqual('json', '', '  ')).toBe(true);
    expect(semanticEqual('json', '{"a":1}', '{"a":2}')).toBe(false);
    expect(semanticEqual('yaml', 'a: 1', 'a: "1"')).toBe(false);
  });

  test('an official-login harness only checks live parseability', () => {
    profiles().upsert(
      'claude',
      { name: 'main', baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test' },
      true,
    );
    activation().activate('claude', 'main');
    activation().activateOfficial('claude');
    const report = drift().inspect('claude');
    expect(report.active).toBe(true);
    expect(report.status).toBe('in-sync');

    writeFileSync(claudeSettings(), '{ not json');
    expect(drift().inspect('claude').status).toBe('invalid');
  });
});

describe('drift reapply', () => {
  test('restores the expected content over a hand edit and creates a backup', () => {
    activateClaude();
    writeFileSync(
      claudeSettings(),
      JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://edited.example.com/v1' } }),
    );
    expect(drift().inspect('claude').status).toBe('drifted');

    const result = drift().reapply('claude');
    expect(result.ok).toBe(true);
    expect(result.files.every((file) => file.status === 'in-sync')).toBe(true);
    const settings = JSON.parse(readFileSync(claudeSettings(), 'utf8'));
    expect(settings.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-test');
  });

  test('rejects reapply when nothing is active', () => {
    expectHttpError(() => drift().reapply('claude'), ERROR_CODES.noActiveProfile, 400);
  });
});

describe('drift adopt', () => {
  test('persists live content back into the profile record', () => {
    activateClaude();
    writeFileSync(
      claudeSettings(),
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: 'https://edited.example.com/v1',
          ANTHROPIC_AUTH_TOKEN: 'sk-test',
        },
      }),
    );

    const result = drift().adopt('claude');
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
    // The profile record now carries the edited value while the live file is untouched.
    expect(profiles().decrypt('claude', 'main').baseUrl).toBe('https://edited.example.com/v1');
    expect(drift().inspect('claude').status).toBe('in-sync');
  });

  test('refuses to adopt when the profile has manual overrides', () => {
    profiles().upsert(
      'claude',
      {
        name: 'main',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-test',
        overrides: { settings: '{"env":{}}\n' },
      },
      true,
    );
    activation().activate('claude', 'main');
    expect(() => drift().adopt('claude')).toThrow(/override/);
  });

  test('refuses to adopt unparsable live files', () => {
    activateClaude();
    writeFileSync(claudeSettings(), '{ not json');
    expect(() => drift().adopt('claude')).toThrow(/not valid json/);
  });

  test('refuses to adopt in official mode', () => {
    profiles().upsert(
      'claude',
      { name: 'main', baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test' },
      true,
    );
    activation().activate('claude', 'main');
    activation().activateOfficial('claude');
    expectHttpError(() => drift().adopt('claude'), ERROR_CODES.officialProfileCannotAdopt, 400);
  });

  test('adopting a codex config with semantic drift keeps the file parseable', () => {
    mkdirSync(join(homeDir, '.codex'), { recursive: true });
    profiles().upsert(
      'codex',
      {
        name: 'main',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-test',
        extras: { authMode: 'bearer_token' },
      },
      true,
    );
    activation().activate('codex', 'main');
    const configPath = join(homeDir, '.codex', 'config.toml');
    writeFileSync(
      configPath,
      'model_provider = "main"\n\n[model_providers.main]\nname = "main"\nbase_url = "https://edited.example.com/v1"\nwire_api = "responses"\nexperimental_bearer_token = "sk-edited"\n',
    );

    drift().adopt('codex');
    const decrypted = profiles().decrypt('codex', 'main');
    expect(decrypted.baseUrl).toBe('https://edited.example.com/v1');
    expect(decrypted.apiKey).toBe('sk-edited');
  });
});
