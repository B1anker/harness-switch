import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  HarnessSummary,
  PreviewResponse,
  ProfilePublic,
} from '@seaveyon/harness-switch-shared';
import { createApp } from '../src/app';
import { createServices } from '../src/bootstrap';
import { IAuthService } from '../src/services/auth';
import { IEnvironmentService } from '../src/services/environment';

let homeDir = '';

type TestApp = {
  app: ReturnType<typeof createApp>;
  cookie: string;
  password: string;
  dataDir: string;
};

async function createTestApp(): Promise<TestApp> {
  homeDir = await mkdtemp(join(tmpdir(), 'hsw-home-'));
  process.env.HSW_HOME_DIR = homeDir;
  process.env.HSW_DATA_DIR = join(homeDir, '.harness-switch');
  const services = createServices();
  services.get(IEnvironmentService).ensureDataDir();
  const password = services.get(IAuthService).ensurePassword();
  const app = createApp(services);
  const login = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  expect(login.status).toBe(200);
  return {
    app,
    cookie: login.headers.get('set-cookie') ?? '',
    password,
    dataDir: process.env.HSW_DATA_DIR,
  };
}

function claudeSettings(): string {
  return join(homeDir, '.claude', 'settings.json');
}

async function createProfile(
  { app, cookie }: TestApp,
  harness: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return app.request(`/api/harnesses/${harness}/profiles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });
}

async function activate(
  { app, cookie }: TestApp,
  harness: string,
  name: string,
): Promise<Response> {
  return app.request(`/api/harnesses/${harness}/profiles/${name}/activate`, {
    method: 'POST',
    headers: { Cookie: cookie },
  });
}

async function summary({ app, cookie }: TestApp, harness: string): Promise<HarnessSummary> {
  const response = await app.request(`/api/harnesses/${harness}`, { headers: { Cookie: cookie } });
  expect(response.status).toBe(200);
  return (await response.json()) as HarnessSummary;
}

function profileOf(harness: HarnessSummary, name: string): ProfilePublic {
  const profile = harness.profiles.find((item) => item.name === name);
  if (!profile) {
    throw new Error(`profile ${name} missing`);
  }
  return profile;
}

describe('rest api', () => {
  afterEach(async () => {
    delete process.env.HSW_HOME_DIR;
    delete process.env.HSW_DATA_DIR;
    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  test('rejects unauthenticated harness access', async () => {
    const { app } = await createTestApp();
    const response = await app.request('/api/harnesses');
    expect(response.status).toBe(401);
    expect((await app.request('/api/backups')).status).toBe(401);
  });

  test('issues a session cookie the browser cannot read from script', async () => {
    const { app, password } = await createTestApp();
    const login = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    const cookie = login.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });

  test('rejects a wrong password and an unparsable login body', async () => {
    const { app } = await createTestApp();
    const wrong = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'not-it' }),
    });
    expect(wrong.status).toBe(401);

    const garbage = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(garbage.status).toBe(401);
  });

  test('logging out invalidates the session immediately', async () => {
    const context = await createTestApp();
    expect(
      (await context.app.request('/api/auth/session', { headers: { Cookie: context.cookie } }))
        .status,
    ).toBe(200);

    await context.app.request('/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: context.cookie },
    });

    expect(
      (await context.app.request('/api/auth/session', { headers: { Cookie: context.cookie } }))
        .status,
    ).toBe(401);
  });

  test('denies a state-changing request from another origin', async () => {
    const context = await createTestApp();
    const response = await context.app.request('/api/harnesses/claude/profiles', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: context.cookie,
        Origin: 'https://evil.example.com',
        Host: '127.0.0.1:8787',
      },
      body: JSON.stringify({ name: 'x', baseUrl: 'https://a', apiKey: 'sk' }),
    });
    expect(response.status).toBe(403);
  });

  test('reports unknown harnesses, profiles and bodies without a 500', async () => {
    const context = await createTestApp();
    const { app, cookie } = context;

    expect(
      (await app.request('/api/harnesses/gemini', { headers: { Cookie: cookie } })).status,
    ).toBe(404);
    expect((await activate(context, 'claude', 'ghost')).status).toBe(404);
    expect(
      (
        await app.request('/api/harnesses/claude/profiles/ghost/preview', {
          headers: { Cookie: cookie },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request('/api/harnesses/claude/profiles/ghost', {
          method: 'DELETE',
          headers: { Cookie: cookie },
        })
      ).status,
    ).toBe(404);

    const badBody = await app.request('/api/harnesses/claude/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: 'not json',
    });
    expect(badBody.status).toBe(400);

    const noKey = await createProfile(context, 'claude', {
      name: 'main',
      baseUrl: 'https://api.example.com/v1',
    });
    expect(noKey.status).toBe(400);
  });

  test('describes each harness with its write mode, fields and live targets', async () => {
    const context = await createTestApp();
    const claude = await summary(context, 'claude');
    const kimi = await summary(context, 'kimi');

    expect(claude.mode).toBe('replace');
    expect(claude.targets[0]?.path).toBe(claudeSettings());
    expect(claude.fields.map((field) => field.key)).toContain('authVar');

    expect(kimi.mode).toBe('additive');
    // Kimi Code never reads credentials from the shell, so env.sh must not pretend it does.
    expect(kimi.envVars).toEqual([]);
    expect(kimi.envNote).toBeString();
  });

  test('creates, activates and switches a claude profile', async () => {
    const context = await createTestApp();
    expect(
      (
        await createProfile(context, 'claude', {
          name: 'openrouter-main',
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'sk-test',
          model: 'claude-sonnet-4-5',
          notes: 'demo',
        })
      ).status,
    ).toBe(201);

    expect((await activate(context, 'claude', 'openrouter-main')).status).toBe(200);

    const settings = JSON.parse(await readFile(claudeSettings(), 'utf8'));
    expect(settings.env.ANTHROPIC_BASE_URL).toBe('https://api.example.com/v1');
    expect(settings.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-test');

    const env = await readFile(join(context.dataDir, 'env.sh'), 'utf8');
    expect(env).toContain("export ANTHROPIC_AUTH_TOKEN='sk-test'");
  });

  test('refuses to delete the active profile so no orphan config is left behind', async () => {
    const context = await createTestApp();
    await createProfile(context, 'claude', {
      name: 'main',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
    });
    await activate(context, 'claude', 'main');

    const blocked = await context.app.request('/api/harnesses/claude/profiles/main', {
      method: 'DELETE',
      headers: { Cookie: context.cookie },
    });
    expect(blocked.status).toBe(409);

    await createProfile(context, 'claude', {
      name: 'spare',
      baseUrl: 'https://spare.example.com/v1',
      apiKey: 'sk-spare',
    });
    await activate(context, 'claude', 'spare');

    const deleted = await context.app.request('/api/harnesses/claude/profiles/main', {
      method: 'DELETE',
      headers: { Cookie: context.cookie },
    });
    expect(deleted.status).toBe(200);
  });

  test('editing the active profile reaches the live file immediately', async () => {
    const context = await createTestApp();
    await createProfile(context, 'claude', {
      name: 'main',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
    });
    await activate(context, 'claude', 'main');

    const patched = await context.app.request('/api/harnesses/claude/profiles/main', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: context.cookie },
      body: JSON.stringify({ baseUrl: 'https://edited.example.com/v1' }),
    });
    expect(patched.status).toBe(200);

    const settings = JSON.parse(await readFile(claudeSettings(), 'utf8'));
    expect(settings.env.ANTHROPIC_BASE_URL).toBe('https://edited.example.com/v1');
  });

  test('switching away saves hand edits without wiping fields the live file cannot hold', async () => {
    const context = await createTestApp();
    await createProfile(context, 'claude', {
      name: 'main',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      notes: 'keep this note',
      extras: { authVar: 'ANTHROPIC_AUTH_TOKEN' },
    });
    await createProfile(context, 'claude', {
      name: 'spare',
      baseUrl: 'https://spare.example.com/v1',
      apiKey: 'sk-spare',
    });
    await activate(context, 'claude', 'main');

    const edited = JSON.parse(await readFile(claudeSettings(), 'utf8'));
    edited.env.ANTHROPIC_BASE_URL = 'https://edited-by-hand.example.com/v1';
    await writeFile(claudeSettings(), JSON.stringify(edited));

    await activate(context, 'claude', 'spare');

    const main = profileOf(await summary(context, 'claude'), 'main');
    expect(main.baseUrl).toBe('https://edited-by-hand.example.com/v1');
    expect(main.notes).toBe('keep this note');
    expect(main.extras.authVar).toBe('ANTHROPIC_AUTH_TOKEN');
  });

  test('an override takes over the file and can be handed back', async () => {
    const context = await createTestApp();
    await createProfile(context, 'claude', {
      name: 'main',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
    });

    const preview = (await (
      await context.app.request('/api/harnesses/claude/profiles/main/preview', {
        headers: { Cookie: context.cookie },
      })
    ).json()) as PreviewResponse;
    expect(preview.targets[0]?.overridden).toBe(false);
    expect(preview.targets[0]?.content).toContain('sk-test');

    await context.app.request('/api/harnesses/claude/profiles/main', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: context.cookie },
      body: JSON.stringify({ overrides: { settings: '{"env":{"HAND_WRITTEN":"1"}}\n' } }),
    });
    await activate(context, 'claude', 'main');

    const settings = JSON.parse(await readFile(claudeSettings(), 'utf8'));
    expect(settings.env.HAND_WRITTEN).toBe('1');
    expect(settings.env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(profileOf(await summary(context, 'claude'), 'main').overriddenTargets).toEqual([
      'settings',
    ]);

    await context.app.request('/api/harnesses/claude/profiles/main', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: context.cookie },
      body: JSON.stringify({ overrides: {} }),
    });
    await activate(context, 'claude', 'main');

    const regenerated = JSON.parse(await readFile(claudeSettings(), 'utf8'));
    expect(regenerated.env.ANTHROPIC_BASE_URL).toBe('https://api.example.com/v1');
  });

  test('rejects an override that the harness could not parse back', async () => {
    const context = await createTestApp();
    await createProfile(context, 'claude', {
      name: 'main',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
    });
    await context.app.request('/api/harnesses/claude/profiles/main', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: context.cookie },
      body: JSON.stringify({ overrides: { settings: '{ not json' } }),
    });

    const activated = await activate(context, 'claude', 'main');
    expect(activated.status).toBe(400);
  });

  test('deleting an additive profile removes its provider from the live file', async () => {
    const context = await createTestApp();
    await createProfile(context, 'kimi', {
      name: 'first',
      baseUrl: 'https://api.moonshot.cn/v1',
      apiKey: 'sk-first',
      model: 'kimi-k2',
    });
    await createProfile(context, 'kimi', {
      name: 'second',
      baseUrl: 'https://api.z.ai/api/paas/v4',
      apiKey: 'sk-second',
      model: 'glm-4.6',
    });
    await activate(context, 'kimi', 'first');
    await activate(context, 'kimi', 'second');

    const configPath = join(homeDir, '.kimi-code', 'config.toml');
    expect(await readFile(configPath, 'utf8')).toContain('[providers.first]');

    const deleted = await context.app.request('/api/harnesses/kimi/profiles/first', {
      method: 'DELETE',
      headers: { Cookie: context.cookie },
    });
    expect(deleted.status).toBe(200);

    const config = await readFile(configPath, 'utf8');
    expect(config).not.toContain('[providers.first]');
    expect(config).toContain('[providers.second]');
    expect(config).toContain('default_model = "second"');
  });

  test('the env file only carries variables the tool actually honours', async () => {
    const context = await createTestApp();
    await createProfile(context, 'codex', {
      name: 'via-env',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-or',
      extras: { authMode: 'env_key', envKeyName: 'MY_KEY' },
    });
    await createProfile(context, 'kimi', {
      name: 'kimi-main',
      baseUrl: 'https://api.moonshot.cn/v1',
      apiKey: 'sk-kimi',
      model: 'kimi-k2',
    });
    await activate(context, 'codex', 'via-env');
    await activate(context, 'kimi', 'kimi-main');

    const env = await readFile(join(context.dataDir, 'env.sh'), 'utf8');
    expect(env).toContain("export MY_KEY='sk-or'");
    // Kimi Code never reads the shell, so exporting a key would be a lie.
    expect(env).not.toContain('sk-kimi');

    const config = await readFile(join(homeDir, '.codex', 'config.toml'), 'utf8');
    expect(config).toContain('env_key = "MY_KEY"');
    expect(config).not.toContain('sk-or');
  });

  test('choosing the auth.json mode backs up the login cache first', async () => {
    const context = await createTestApp();
    await mkdir(join(homeDir, '.codex'), { recursive: true });
    const authFile = join(homeDir, '.codex', 'auth.json');
    const original = JSON.stringify({ tokens: { refresh_token: 'official-login' } });
    await writeFile(authFile, original);

    await createProfile(context, 'codex', {
      name: 'third-party',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-or',
      extras: { authMode: 'openai_auth' },
    });
    await activate(context, 'codex', 'third-party');

    expect(JSON.parse(await readFile(authFile, 'utf8')).OPENAI_API_KEY).toBe('sk-or');

    const listed = (await (
      await context.app.request('/api/backups', { headers: { Cookie: context.cookie } })
    ).json()) as { items: Array<{ id: string; files: Array<{ path: string }> }> };
    expect(listed.items[0]?.files.map((file) => file.path)).toContain(authFile);

    await context.app.request(
      `/api/backups/${encodeURIComponent(listed.items[0]?.id ?? '')}/restore`,
      { method: 'POST', headers: { Cookie: context.cookie } },
    );
    expect(await readFile(authFile, 'utf8')).toBe(original);
  });

  test('a failed activation leaves the recorded active profile untouched', async () => {
    const context = await createTestApp();
    await createProfile(context, 'claude', {
      name: 'good',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-good',
    });
    await createProfile(context, 'claude', {
      name: 'broken',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-broken',
      overrides: { settings: '{ not json' },
    });
    await activate(context, 'claude', 'good');

    expect((await activate(context, 'claude', 'broken')).status).toBe(400);

    expect((await summary(context, 'claude')).active?.name).toBe('good');
    const settings = JSON.parse(await readFile(claudeSettings(), 'utf8'));
    expect(settings.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-good');
  });

  test('a profile store left over from a removed harness does not break reads', async () => {
    const context = await createTestApp();
    await writeFile(
      join(context.dataDir, 'profiles.json'),
      JSON.stringify({
        zcode: { legacy: { base_url: 'https://old', api_key: {}, model: '', notes: '' } },
      }),
    );

    const response = await context.app.request('/api/harnesses', {
      headers: { Cookie: context.cookie },
    });
    expect(response.status).toBe(200);

    expect(
      (
        await createProfile(context, 'claude', {
          name: 'main',
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'sk-test',
        })
      ).status,
    ).toBe(201);
    expect((await summary(context, 'claude')).profiles).toHaveLength(1);
  });

  test('lists backups and restores the file they captured', async () => {
    const context = await createTestApp();
    await mkdir(join(homeDir, '.claude'), { recursive: true });
    await writeFile(claudeSettings(), '{"env":{"ORIGINAL":"1"}}\n');

    await createProfile(context, 'claude', {
      name: 'main',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
    });
    await activate(context, 'claude', 'main');

    const listed = (await (
      await context.app.request('/api/backups', { headers: { Cookie: context.cookie } })
    ).json()) as { items: Array<{ id: string }> };
    expect(listed.items).not.toBeEmpty();

    const restored = await context.app.request(
      `/api/backups/${encodeURIComponent(listed.items[0]?.id ?? '')}/restore`,
      { method: 'POST', headers: { Cookie: context.cookie } },
    );
    expect(restored.status).toBe(200);
    expect(await readFile(claudeSettings(), 'utf8')).toBe('{"env":{"ORIGINAL":"1"}}\n');
  });
});
