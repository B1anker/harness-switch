import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  HarnessSummary,
  ScanHarnessResult,
  ScanImportResponse,
} from '@seaveyon/harness-switch-shared';
import { createApp } from '../src/app';
import { createServices } from '../src/bootstrap';
import { IAuthService } from '../src/services/auth';
import { IEnvironmentService } from '../src/services/environment';

let homeDir = '';

type Context = {
  app: ReturnType<typeof createApp>;
  cookie: string;
};

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), 'hsw-scan-'));
  process.env.HSW_HOME_DIR = homeDir;
  process.env.HSW_DATA_DIR = join(homeDir, '.harness-switch');
  process.env.CODEX_HOME = join(homeDir, '.codex');
});

afterEach(() => {
  delete process.env.HSW_HOME_DIR;
  delete process.env.HSW_DATA_DIR;
  delete process.env.CODEX_HOME;
  rmSync(homeDir, { recursive: true, force: true });
});

function seed(file: string, content: string): void {
  mkdirSync(join(file, '..'), { recursive: true, mode: 0o700 });
  writeFileSync(file, content, { mode: 0o600 });
}

async function boot(): Promise<Context> {
  const services = createServices();
  services.get(IEnvironmentService).ensureDataDir();
  const password = services.get(IAuthService).ensurePassword();
  const app = createApp(services);
  const login = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  return { app, cookie: login.headers.get('set-cookie') ?? '' };
}

async function scan(context: Context): Promise<ScanHarnessResult[]> {
  const response = await context.app.request('/api/scan', {
    headers: { Cookie: context.cookie },
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { items: ScanHarnessResult[] }).items;
}

function resultFor(items: ScanHarnessResult[], harness: string): ScanHarnessResult {
  const found = items.find((item) => item.harness === harness);
  if (!found) {
    throw new Error(`no scan result for ${harness}`);
  }
  return found;
}

async function importSelections(
  context: Context,
  selections: unknown[],
): Promise<{ status: number; body: ScanImportResponse }> {
  const response = await context.app.request('/api/scan/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: context.cookie },
    body: JSON.stringify({ selections }),
  });
  return { status: response.status, body: (await response.json()) as ScanImportResponse };
}

async function summary(context: Context, harness: string): Promise<HarnessSummary> {
  const response = await context.app.request(`/api/harnesses/${harness}`, {
    headers: { Cookie: context.cookie },
  });
  return (await response.json()) as HarnessSummary;
}

function seedClaude(): void {
  seed(
    join(homeDir, '.claude', 'settings.json'),
    JSON.stringify(
      {
        env: {
          ANTHROPIC_BASE_URL: 'https://claude.example.com/api',
          ANTHROPIC_AUTH_TOKEN: 'sk-claude-existing-key',
          ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-5[1m]',
        },
      },
      null,
      2,
    ),
  );
}

function seedCodexPair(): void {
  seed(
    join(homeDir, '.codex', 'config.toml'),
    [
      'model = "gpt-5"',
      'model_provider = "alpha"',
      '',
      '[model_providers.alpha]',
      'name = "Alpha"',
      'base_url = "https://alpha.example.com/v1"',
      'wire_api = "responses"',
      'experimental_bearer_token = "sk-alpha-token"',
      '',
      '[model_providers.beta]',
      'name = "Beta"',
      'base_url = "https://beta.example.com/v1"',
      'wire_api = "responses"',
      'env_key = "BETA_API_KEY"',
      '',
    ].join('\n'),
  );
}

describe('existing configuration scan', () => {
  test('finds the routing a user set up in claude by hand', async () => {
    seedClaude();
    const context = await boot();

    const claude = resultFor(await scan(context), 'claude');
    expect(claude.candidates).toHaveLength(1);
    const candidate = claude.candidates[0]!;
    expect(candidate.baseUrl).toBe('https://claude.example.com/api');
    expect(candidate.extras.authVar).toBe('ANTHROPIC_AUTH_TOKEN');
    // The 1M suffix is a local capability flag, not part of the model id.
    expect(candidate.extras.sonnetModel).toBe('glm-5');
    expect(candidate.extras.sonnetModel1m).toBe('true');
    expect(candidate.active).toBe(true);
  });

  test('never puts the credential itself in the response', async () => {
    seedClaude();
    const context = await boot();

    const response = await context.app.request('/api/scan', {
      headers: { Cookie: context.cookie },
    });
    const body = await response.text();
    expect(body).not.toContain('sk-claude-existing-key');
    expect(body).toContain('•');

    const candidate = resultFor(JSON.parse(body).items, 'claude').candidates[0]!;
    expect(candidate.apiKeyPresent).toBe(true);
    expect(candidate.apiKeyPreview).toBe('sk-c••••••-key');
  });

  test('reports every provider of an additive tool, flagging the active one', async () => {
    seedCodexPair();
    const context = await boot();

    const codex = resultFor(await scan(context), 'codex');
    expect(codex.candidates.map((item) => item.sourceKey).toSorted()).toEqual(['alpha', 'beta']);

    const alpha = codex.candidates.find((item) => item.sourceKey === 'alpha')!;
    expect(alpha.active).toBe(true);
    expect(alpha.extras.authMode).toBe('bearer_token');
    expect(alpha.apiKeyPresent).toBe(true);

    // An env_key provider keeps its credential in the shell, not in a file we can read.
    const beta = codex.candidates.find((item) => item.sourceKey === 'beta')!;
    expect(beta.active).toBe(false);
    expect(beta.extras.authMode).toBe('env_key');
    expect(beta.extras.envKeyName).toBe('BETA_API_KEY');
    expect(beta.apiKeyPresent).toBe(false);
  });

  test('says which files it looked at, including the ones that are missing', async () => {
    const context = await boot();
    const codex = resultFor(await scan(context), 'codex');
    expect(codex.sources.map((source) => source.key).toSorted()).toEqual(['auth', 'config']);
    expect(codex.sources.every((source) => !source.exists)).toBe(true);
    expect(codex.note).toContain('没有找到');
  });

  test('refuses to guess at a config file the tool itself could not parse', async () => {
    seed(join(homeDir, '.codex', 'config.toml'), 'model = \n');
    const context = await boot();

    const codex = resultFor(await scan(context), 'codex');
    expect(codex.candidates).toHaveLength(0);
    expect(codex.note).toContain('无法解析');
  });
});

describe('scan import', () => {
  test('saves a candidate as a profile without touching the tool config', async () => {
    seedClaude();
    const context = await boot();
    const settingsPath = join(homeDir, '.claude', 'settings.json');
    const before = readFileSync(settingsPath, 'utf8');

    const { status, body } = await importSelections(context, [
      { id: 'claude:claude', name: '导入的配置', target: 'profile' },
    ]);
    expect(status).toBe(200);
    expect(body.imported).toBe(1);

    const claude = await summary(context, 'claude');
    const profile = claude.profiles.find((item) => item.name === '导入的配置');
    expect(profile?.baseUrl).toBe('https://claude.example.com/api');
    expect(profile?.extras.sonnetModel).toBe('glm-5');

    // The whole point of the wizard: adopting a setup must not rewrite it.
    expect(readFileSync(settingsPath, 'utf8')).toBe(before);
    // Nor should it switch the user onto the imported profile.
    expect(claude.active).toBeNull();
  });

  test('extracting to the vault links the profile instead of inlining the key', async () => {
    seedClaude();
    const context = await boot();

    const { body } = await importSelections(context, [
      { id: 'claude:claude', name: '走 vault', target: 'vault', providerName: '我的中转' },
    ]);
    expect(body.imported).toBe(1);
    expect(body.providersCreated).toBe(1);

    const claude = await summary(context, 'claude');
    const profile = claude.profiles.find((item) => item.name === '走 vault');
    expect(profile?.providerId).toBeTruthy();
    expect(profile?.providerEndpoint).toBe('default');

    const providers = await context.app.request('/api/providers', {
      headers: { Cookie: context.cookie },
    });
    const { items } = (await providers.json()) as { items: Array<{ name: string }> };
    expect(items.map((item) => item.name)).toContain('我的中转');
  });

  test('two candidates can share one vault entry', async () => {
    seedCodexPair();
    const context = await boot();

    const first = await importSelections(context, [
      { id: 'codex:alpha', name: 'alpha', target: 'vault', providerName: '共享凭据' },
    ]);
    expect(first.body.providersCreated).toBe(1);

    const codex = await summary(context, 'codex');
    const providerId = codex.profiles.find((item) => item.name === 'alpha')?.providerId;
    expect(providerId).toBeTruthy();

    const second = await importSelections(context, [
      { id: 'codex:beta', name: 'beta', target: 'vault', providerId },
    ]);
    expect(second.body.imported).toBe(1);
    expect(second.body.providersCreated).toBe(0);
    expect(
      (await summary(context, 'codex')).profiles.find((item) => item.name === 'beta')?.providerId,
    ).toBe(providerId);
  });

  test('a same-name profile is skipped unless overwrite is asked for', async () => {
    seedClaude();
    const context = await boot();

    expect(
      (await importSelections(context, [{ id: 'claude:claude', name: '重名', target: 'profile' }]))
        .body.imported,
    ).toBe(1);

    const again = await importSelections(context, [
      { id: 'claude:claude', name: '重名', target: 'profile' },
    ]);
    expect(again.body.imported).toBe(0);
    expect(again.body.skipped).toBe(1);
    expect(again.body.warnings[0]?.message).toContain('已存在');

    const forced = await importSelections(context, [
      { id: 'claude:claude', name: '重名', target: 'profile', overwrite: true },
    ]);
    expect(forced.body.imported).toBe(1);
  });

  test('a candidate that vanished between scan and import is reported, not invented', async () => {
    seedClaude();
    const context = await boot();
    rmSync(join(homeDir, '.claude', 'settings.json'));

    const { body } = await importSelections(context, [
      { id: 'claude:claude', name: '没了', target: 'profile' },
    ]);
    expect(body.imported).toBe(0);
    expect(body.skipped).toBe(1);
    expect(body.warnings[0]?.message).toContain('已不在磁盘上');
  });

  test('a provider whose key lives in the shell must have one supplied', async () => {
    seedCodexPair();
    const context = await boot();

    const refused = await importSelections(context, [
      { id: 'codex:beta', name: 'beta', target: 'profile' },
    ]);
    expect(refused.body.imported).toBe(0);
    expect(refused.body.warnings[0]?.message).toContain('请先填写 API key');

    const supplied = await importSelections(context, [
      { id: 'codex:beta', name: 'beta', target: 'profile', apiKey: 'sk-typed-by-hand' },
    ]);
    expect(supplied.body.imported).toBe(1);
  });

  test('an empty or malformed selection list is refused', async () => {
    const context = await boot();
    expect((await importSelections(context, [])).status).toBe(400);

    const bad = await context.app.request('/api/scan/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: context.cookie },
      body: JSON.stringify({ selections: [{ id: 'claude:claude', name: 'x', target: 'disk' }] }),
    });
    expect(bad.status).toBe(400);
  });
});
