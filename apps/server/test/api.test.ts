import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import type {
  HarnessSummary,
  PreviewResponse,
  ProfilePublic,
  TransferEnvelope,
  TransferPreview,
} from '@seaveyon/harness-switch-shared';
import { ERROR_CODES } from '@seaveyon/harness-switch-shared';
import {
  asSession,
  createSandbox,
  createTestApp,
  loginAgain,
  restartApp,
  type Sandbox,
  type TestApp,
} from './support';

let sandbox: Sandbox;

/** A restarted app carrying the session cookie the pre-restart app handed out. */
function afterRestart(context: TestApp): TestApp {
  return asSession(restartApp(), context.cookie);
}

beforeEach(() => {
  sandbox = createSandbox('hsw-home', { env: (home) => ({ CODEX_HOME: home('.codex') }) });
});

afterEach(() => {
  sandbox.dispose();
});

type PortableTestPayload = {
  format: 'harness-switch-portable-config';
  version: 1;
  exportedAt: string;
  profiles: Array<{
    harness: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    notes: string;
    extras: Record<string, string>;
    overrides: Record<string, string>;
  }>;
  active: Array<{ harness: string; name: string; official: boolean }>;
};

function encryptedPortablePayload(
  payload: PortableTestPayload,
  passphrase = 'portable-secret',
): TransferEnvelope {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return {
    format: 'harness-switch-encrypted-export',
    version: 1,
    kdf: { name: 'scrypt', salt: salt.toString('base64url') },
    cipher: {
      name: 'aes-256-gcm',
      iv: iv.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'),
      data: data.toString('base64url'),
    },
  };
}

function portableClaudeProfile(name = 'portable') {
  return {
    harness: 'claude',
    name,
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-portable-secret',
    model: '',
    notes: '',
    extras: { authVar: 'ANTHROPIC_AUTH_TOKEN' },
    overrides: {},
  };
}

function claudeSettings(): string {
  return sandbox.home('.claude', 'settings.json');
}

function createProfile(
  context: TestApp,
  harness: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return context.post(`/api/harnesses/${harness}/profiles`, body);
}

function activate(context: TestApp, harness: string, name: string): Promise<Response> {
  return context.post(`/api/harnesses/${harness}/profiles/${name}/activate`);
}

function summary(context: TestApp, harness: string): Promise<HarnessSummary> {
  return context.json<HarnessSummary>(`/api/harnesses/${harness}`);
}

function profileOf(harness: HarnessSummary, name: string): ProfilePublic {
  const profile = harness.profiles.find((item) => item.name === name);
  if (!profile) {
    throw new Error(`profile ${name} missing`);
  }
  return profile;
}

describe('rest api', () => {
  test('reports its version without authentication', async () => {
    const { app } = await createTestApp();
    const response = await app.request('/api/version');
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { name: string; version: string };
    expect(payload.name).toBe('harness-switch');
    expect(payload.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('rejects unauthenticated harness access', async () => {
    const { app } = await createTestApp();
    const response = await app.request('/api/harnesses');
    expect(response.status).toBe(401);
    expect((await app.request('/api/backups')).status).toBe(401);
    expect(
      (
        await app.request('/api/transfer/export', {
          method: 'POST',
          body: JSON.stringify({ passphrase: 'portable-secret' }),
        })
      ).status,
    ).toBe(401);
  });

  test('every guarded prefix refuses anonymous requests on both its bare and sub paths', async () => {
    const { app } = await createTestApp();
    // The guard is registered once per prefix, as `/x/*`. Hono matches that against the bare
    // `/x` too, so a single registration covers both shapes — this asserts it, and would
    // catch a Hono change to that matching behaviour as well as a prefix added to `app.ts`
    // without a guard.
    const guarded = [
      'users',
      'harnesses',
      'backups',
      'scan',
      'operations',
      'transfer',
      'github',
      'update',
      'providers',
      'probe',
      'doctor',
      'drift',
    ];

    for (const prefix of guarded) {
      for (const path of [`/api/${prefix}`, `/api/${prefix}/anything`]) {
        expect((await app.request(path)).status, `${path} should require a session`).toBe(401);
      }
    }

    // The two endpoints deliberately outside the guard stay reachable.
    expect((await app.request('/api/version')).status).toBe(200);
    expect((await app.request('/healthz')).status).toBe(200);
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

    // A body that is not JSON at all is a client bug, not a failed credential.
    const garbage = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(garbage.status).toBe(400);
  });

  test('returns a stable code, data, and an Accept-Language localized message', async () => {
    const { app } = await createTestApp();
    const response = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept-Language': 'en-US,en;q=0.9' },
      body: JSON.stringify({ password: 'not-it' }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: 'auth.invalidPassword',
      msg: 'Incorrect password',
    });
  });

  test('logging out invalidates the session immediately', async () => {
    const context = await createTestApp();
    expect((await context.get('/api/auth/session')).status).toBe(200);

    await context.post('/api/auth/logout');

    expect((await context.get('/api/auth/session')).status).toBe(401);
  });

  test('keeps a session valid across a restart', async () => {
    const context = await createTestApp();

    expect((await afterRestart(context).get('/api/auth/session')).status).toBe(200);
  });

  test('does not persist the raw token, so a leaked store cannot be replayed', async () => {
    const context = await createTestApp();
    const token = /hsw_session=([^;]+)/.exec(context.cookie)?.[1] ?? '';
    expect(token).not.toBe('');

    const stored = await readFile(sandbox.data('sessions.json'), 'utf8');
    expect(stored).not.toContain(token);
    // Replaying the stored key as if it were the token must not authenticate.
    const storedKey = Object.keys(JSON.parse(stored).sessions)[0];
    expect(
      (await asSession(restartApp(), `hsw_session=${storedKey}`).get('/api/auth/session')).status,
    ).toBe(401);
  });

  test('a logout survives the restart it outlived', async () => {
    const context = await createTestApp();
    await context.post('/api/auth/logout');

    expect((await afterRestart(context).get('/api/auth/session')).status).toBe(401);
  });

  test('changing the web password invalidates sessions that outlived it', async () => {
    const context = await createTestApp();
    await writeFile(sandbox.data('web_password'), 'rotated-password\n', { mode: 0o600 });

    expect((await afterRestart(context).get('/api/auth/session')).status).toBe(401);
  });

  test('an expired session is rejected after a restart', async () => {
    const context = await createTestApp();
    const file = sandbox.data('sessions.json');
    const store = JSON.parse(await readFile(file, 'utf8'));
    for (const key of Object.keys(store.sessions)) {
      store.sessions[key].expires = Date.now() - 1000;
    }
    await writeFile(file, JSON.stringify(store), { mode: 0o600 });

    expect((await afterRestart(context).get('/api/auth/session')).status).toBe(401);
  });

  test('survives a corrupt session store instead of crashing', async () => {
    const context = await createTestApp();
    await writeFile(sandbox.data('sessions.json'), 'not json', { mode: 0o600 });

    const restarted = restartApp();
    expect((await asSession(restarted, context.cookie).get('/api/auth/session')).status).toBe(401);

    // A store it could not read must not lock the operator out of logging in again.
    expect(await loginAgain({ ...restarted, password: context.password })).not.toBe('');
  });

  test('denies a state-changing request from another origin', async () => {
    const context = await createTestApp();
    const response = await context.request('/api/harnesses/claude/profiles', {
      method: 'POST',
      headers: { Origin: 'https://evil.example.com', Host: '127.0.0.1:8787' },
      body: JSON.stringify({ name: 'x', baseUrl: 'https://a', apiKey: 'sk' }),
    });
    expect(response.status).toBe(403);
  });

  test('reports unknown harnesses, profiles and bodies without a 500', async () => {
    const context = await createTestApp();

    expect((await context.get('/api/harnesses/gemini')).status).toBe(404);
    expect((await activate(context, 'claude', 'ghost')).status).toBe(404);
    expect((await context.get('/api/harnesses/claude/profiles/ghost/preview')).status).toBe(404);
    expect((await context.del('/api/harnesses/claude/profiles/ghost')).status).toBe(404);

    const badBody = await context.request('/api/harnesses/claude/profiles', {
      method: 'POST',
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
    expect(claude.modelRequired).toBeUndefined();
    expect(claude.targets[0]?.path).toBe(claudeSettings());
    expect(claude.fields.map((field) => field.key)).toContain('authVar');
    expect(
      claude.fields
        .filter((field) => ['haikuModel', 'sonnetModel', 'opusModel'].includes(field.key))
        .every((field) => field.required),
    ).toBe(true);
    expect(claude.fields.find((field) => field.key === 'fableModel')?.required).toBeUndefined();

    expect(kimi.mode).toBe('additive');
    expect(kimi.modelRequired).toBe(true);
    // Kimi Code never reads credentials from the shell, so env.sh must not pretend it does.
    expect(kimi.envVars).toEqual([]);
    expect(kimi.envNote).toBeString();

    const pi = await summary(context, 'pi');
    expect(pi.label).toBe('Pi');
    expect(pi.mode).toBe('additive');
    expect(pi.modelRequired).toBe(true);
    expect(pi.targets.map((target) => target.path)).toEqual([
      sandbox.home('.pi', 'agent', 'models.json'),
      sandbox.home('.pi', 'agent', 'settings.json'),
    ]);
  });

  test('activating pi writes models.json so the official agent can see the provider', async () => {
    const context = await createTestApp();
    expect(
      (
        await createProfile(context, 'pi', {
          name: 'main',
          baseUrl: 'https://api.seavey.ai/cliproxy/v1',
          apiKey: 'sk-test',
          model: 'gpt-5.6-sol',
          extras: { api: 'openai-responses', reasoning: 'true' },
        })
      ).status,
    ).toBe(201);

    expect((await activate(context, 'pi', 'main')).status).toBe(200);

    const models = JSON.parse(
      await readFile(sandbox.home('.pi', 'agent', 'models.json'), 'utf8'),
    ) as {
      providers: Record<string, { apiKey: string; models: Array<{ reasoning?: boolean }> }>;
    };
    expect(models.providers.main.apiKey).toBe('sk-test');
    expect(models.providers.main.models[0]?.reasoning).toBe(true);

    const settings = JSON.parse(
      await readFile(sandbox.home('.pi', 'agent', 'settings.json'), 'utf8'),
    ) as { defaultProvider: string; defaultModel: string };
    expect(settings.defaultProvider).toBe('main');
    expect(settings.defaultModel).toBe('gpt-5.6-sol');
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

    const env = await readFile(sandbox.data('env.sh'), 'utf8');
    expect(env).toContain("export ANTHROPIC_AUTH_TOKEN='sk-test'");
  });

  test('copies a profile through the API without sending its credential back to the client', async () => {
    const context = await createTestApp();
    await createProfile(context, 'claude', {
      name: 'source',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-source',
      model: 'source-model',
    });

    const response = await createProfile(context, 'claude', {
      name: 'source-copy',
      copySourceName: 'source',
      model: 'adjusted-model',
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      name: 'source-copy',
      baseUrl: 'https://api.example.com/v1',
      model: 'adjusted-model',
    });
    expect(JSON.stringify(await summary(context, 'claude'))).not.toContain('sk-source');
    await activate(context, 'claude', 'source-copy');
    expect(await readFile(claudeSettings(), 'utf8')).toContain('sk-source');
  });

  test('refuses copying a DSH official profile into a second official profile', async () => {
    const context = await createTestApp();
    expect(
      (
        await createProfile(context, 'dsh', {
          name: 'official',
          baseUrl: 'https://api.deepseek.com',
          apiKey: 'sk-official',
          model: 'deepseek-v4-flash',
          extras: { providerType: 'official' },
        })
      ).status,
    ).toBe(201);

    const response = await createProfile(context, 'dsh', {
      name: 'official-copy',
      copySourceName: 'official',
    });
    expect(response.status).toBe(409);
  });

  test('returns Claude to its built-in official login', async () => {
    const context = await createTestApp();
    await createProfile(context, 'claude', {
      name: 'relay',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      model: 'relay-model',
      extras: { sonnetModel: 'relay-sonnet' },
    });
    await activate(context, 'claude', 'relay');

    const response = await context.post('/api/harnesses/claude/official/activate');
    expect(response.status).toBe(200);

    const settings = JSON.parse(await readFile(claudeSettings(), 'utf8'));
    expect(settings.env?.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(settings.env?.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(settings.env?.ANTHROPIC_MODEL).toBeUndefined();
    expect(settings.env?.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined();

    const claude = await summary(context, 'claude');
    expect(claude.active?.official).toBe(true);
    expect(claude.active?.name).toBe('官方登录');
    expect(claude.official).toMatchObject({ kind: 'account-login', available: true, active: true });
  });

  test('returns Kimi Code to its managed official login', async () => {
    const context = await createTestApp();
    await createProfile(context, 'kimi', {
      name: 'relay',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      model: 'kimi-k2',
    });
    await activate(context, 'kimi', 'relay');

    const configPath = sandbox.home('.kimi-code', 'config.toml');
    // Simulate the provider and models that `/login` had provisioned before the switch.
    await writeFile(
      configPath,
      [
        await readFile(configPath, 'utf8'),
        '[providers."managed:kimi-code"]',
        'type = "kimi"',
        'base_url = "https://api.kimi.com/coding/v1"',
        'api_key = ""',
        '',
        '[providers."managed:kimi-code".oauth]',
        'storage = "file"',
        'key = "kimi-code"',
        '',
        '[models."kimi-code/k3-256k"]',
        'provider = "managed:kimi-code"',
        'model = "k3"',
        'max_context_size = 262144',
        '',
        '[models."kimi-code/kimi-for-coding"]',
        'provider = "managed:kimi-code"',
        'model = "kimi-for-coding"',
        'max_context_size = 262144',
        '',
      ].join('\n'),
    );

    const response = await context.post('/api/harnesses/kimi/official/activate');
    expect(response.status).toBe(200);

    // Additive config keeps the third-party provider; only the pointer moves back.
    const config = await readFile(configPath, 'utf8');
    expect(config).toContain('[providers.relay]');
    expect(config).toContain('[providers."managed:kimi-code"]');
    expect(config).toContain('default_model = "kimi-code/k3-256k"');

    const kimi = await summary(context, 'kimi');
    expect(kimi.active?.official).toBe(true);
    expect(kimi.official).toMatchObject({ kind: 'account-login', available: true, active: true });

    // And a profile activation can reuse the entry that stayed on disk.
    await activate(context, 'kimi', 'relay');
    expect(await readFile(configPath, 'utf8')).toContain('default_model = "relay"');
  });

  test('switches DSH to a detected native DeepSeek official API key', async () => {
    const context = await createTestApp();
    expect((await summary(context, 'dsh')).official).toBeUndefined();
    const settingsPath = sandbox.home('.dsh', 'settings.yaml');
    const credentialsPath = sandbox.home('.dsh', '.credentials.yaml');
    await mkdir(sandbox.home('.dsh'), { recursive: true });
    await writeFile(
      settingsPath,
      [
        'llm-deepseek:',
        '  apiKeyEnv: DEEPSEEK_API_KEY',
        '  baseURL: https://api.deepseek.com',
        '  models:',
        '    - id: deepseek-v4-flash',
        'agent-default-model:',
        '  provider: relay',
        '  model: relay-model',
        '',
      ].join('\n'),
    );
    await writeFile(credentialsPath, 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: sk-native\n');

    const response = await context.post('/api/harnesses/dsh/official/activate');
    expect(response.status).toBe(200);

    const settings = await readFile(settingsPath, 'utf8');
    expect(settings).toContain('provider: deepseek-official');
    expect(settings).toContain('model: relay-model');
    expect(await readFile(credentialsPath, 'utf8')).toBe(
      'version: 1\nrefs:\n  DEEPSEEK_API_KEY: sk-native\n',
    );
    expect((await summary(context, 'dsh')).official).toMatchObject({
      kind: 'native-api',
      available: true,
      active: true,
    });
    expect((await summary(context, 'dsh')).active?.official).toBe(true);
  });

  test('refuses to switch Kimi Code to an official login it never completed', async () => {
    const context = await createTestApp();
    await createProfile(context, 'kimi', {
      name: 'relay',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      model: 'kimi-k2',
    });
    await activate(context, 'kimi', 'relay');

    const response = await context.post('/api/harnesses/kimi/official/activate');
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { code: string };
    expect(payload.code).toBe('activation.officialLoginMissing');

    const configPath = sandbox.home('.kimi-code', 'config.toml');
    expect(await readFile(configPath, 'utf8')).toContain('default_model = "relay"');
    expect((await summary(context, 'kimi')).active?.official).toBe(false);
  });

  test('re-activating Codex official login heals a drifted model_provider', async () => {
    const context = await createTestApp();
    await createProfile(context, 'codex', {
      name: 'via-env',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-or',
      extras: { authMode: 'env_key', envKeyName: 'MY_KEY' },
    });
    await activate(context, 'codex', 'via-env');

    const first = await context.post('/api/harnesses/codex/official/activate');
    expect(first.status).toBe(200);

    const configPath = sandbox.home('.codex', 'config.toml');
    // Simulate Codex UI re-selecting a leftover third-party provider after official switch.
    await writeFile(
      configPath,
      [
        'model_provider = "third-party"',
        '[model_providers.third-party]',
        'name = "third-party"',
        'base_url = "https://openrouter.ai/api/v1"',
        'wire_api = "responses"',
        'requires_openai_auth = true',
        '',
      ].join('\n'),
    );

    const second = await context.post('/api/harnesses/codex/official/activate');
    expect(second.status).toBe(200);

    const config = await readFile(configPath, 'utf8');
    expect(config).not.toContain('model_provider');
    expect(config).not.toContain('third-party');
    expect(config).not.toContain('openrouter.ai');
    expect((await summary(context, 'codex')).active?.official).toBe(true);
  });

  test('refuses to delete the active profile so no orphan config is left behind', async () => {
    const context = await createTestApp();
    await createProfile(context, 'claude', {
      name: 'main',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
    });
    await activate(context, 'claude', 'main');

    const blocked = await context.del('/api/harnesses/claude/profiles/main');
    expect(blocked.status).toBe(409);

    await createProfile(context, 'claude', {
      name: 'spare',
      baseUrl: 'https://spare.example.com/v1',
      apiKey: 'sk-spare',
    });
    await activate(context, 'claude', 'spare');

    const deleted = await context.del('/api/harnesses/claude/profiles/main');
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

    const patched = await context.patch('/api/harnesses/claude/profiles/main', {
      baseUrl: 'https://edited.example.com/v1',
    });
    expect(patched.status).toBe(200);

    const settings = JSON.parse(await readFile(claudeSettings(), 'utf8'));
    expect(settings.env.ANTHROPIC_BASE_URL).toBe('https://edited.example.com/v1');
  });

  test('renaming the active profile updates its stored key and active pointer', async () => {
    const context = await createTestApp();
    await createProfile(context, 'claude', {
      name: 'main',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
    });
    await activate(context, 'claude', 'main');

    const patched = await context.patch('/api/harnesses/claude/profiles/main', { name: 'renamed' });
    expect(patched.status).toBe(200);

    const claude = await summary(context, 'claude');
    expect(claude.active?.name).toBe('renamed');
    expect(claude.profiles.map((profile) => profile.name)).toEqual(['renamed']);
    expect(JSON.parse(await readFile(claudeSettings(), 'utf8')).env.ANTHROPIC_AUTH_TOKEN).toBe(
      'sk-test',
    );
  });

  test('an edit that fails to reach the live files rolls the profile store back', async () => {
    const context = await createTestApp();
    await createProfile(context, 'claude', {
      name: 'main',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
    });
    await activate(context, 'claude', 'main');

    // Block every read/write of the live file by replacing its directory with a
    // regular file, so the reconcile step must fail.
    const claudeDir = sandbox.home('.claude');
    await rm(claudeDir, { recursive: true, force: true });
    await writeFile(claudeDir, 'not a directory');

    const patched = await context.patch('/api/harnesses/claude/profiles/main', {
      baseUrl: 'https://edited.example.com/v1',
    });
    expect(patched.status).toBeGreaterThanOrEqual(400);

    await rm(claudeDir, { force: true });

    // The persisted profile and the active pointer must be exactly as before.
    const claude = await summary(context, 'claude');
    expect(profileOf(claude, 'main').baseUrl).toBe('https://api.example.com/v1');
    expect(claude.active?.name).toBe('main');
  });

  test('refuses to delete an additive profile when its live provider cannot be cleaned up', async () => {
    const context = await createTestApp();
    await createProfile(context, 'kimi', {
      name: 'victim',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      model: 'kimi-k2',
    });

    // Block the live config so revoking the provider must fail.
    const kimiHome = sandbox.home('.kimi-code');
    await writeFile(kimiHome, 'not a directory');

    const deleted = await context.del('/api/harnesses/kimi/profiles/victim');
    expect(deleted.status).toBeGreaterThanOrEqual(400);

    await rm(kimiHome, { force: true });

    // The profile is still there: deletion failed closed instead of leaving an
    // orphan provider entry behind with no record left to clean it up.
    const kimi = await summary(context, 'kimi');
    expect(profileOf(kimi, 'victim').name).toBe('victim');
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
      await context.get('/api/harnesses/claude/profiles/main/preview')
    ).json()) as PreviewResponse;
    expect(preview.targets[0]?.overridden).toBe(false);
    expect(preview.targets[0]?.content).toContain('sk-test');
    expect(preview.targets[0]?.currentContent).toBeNull();

    await context.patch('/api/harnesses/claude/profiles/main', {
      overrides: { settings: '{"env":{"HAND_WRITTEN":"1"}}\n' },
    });
    await activate(context, 'claude', 'main');

    const settings = JSON.parse(await readFile(claudeSettings(), 'utf8'));
    expect(settings.env.HAND_WRITTEN).toBe('1');
    expect(settings.env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(profileOf(await summary(context, 'claude'), 'main').overriddenTargets).toEqual([
      'settings',
    ]);

    await context.patch('/api/harnesses/claude/profiles/main', { overrides: {} });
    await activate(context, 'claude', 'main');

    const regenerated = JSON.parse(await readFile(claudeSettings(), 'utf8'));
    expect(regenerated.env.ANTHROPIC_BASE_URL).toBe('https://api.example.com/v1');
  });

  test('preview reports the live file content so the UI can diff before activating', async () => {
    const context = await createTestApp();
    await createProfile(context, 'claude', {
      name: 'main',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
    });

    const before = (await (
      await context.get('/api/harnesses/claude/profiles/main/preview')
    ).json()) as PreviewResponse;
    expect(before.targets[0]?.currentContent).toBeNull();

    await activate(context, 'claude', 'main');
    const live = await readFile(claudeSettings(), 'utf8');

    const after = (await (
      await context.get('/api/harnesses/claude/profiles/main/preview')
    ).json()) as PreviewResponse;
    expect(after.targets[0]?.currentContent).toBe(live);
    expect(after.targets[0]?.currentContent).toContain('sk-test');
  });

  test('rejects an override that the harness could not parse back', async () => {
    const context = await createTestApp();
    await createProfile(context, 'claude', {
      name: 'main',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
    });
    await context.patch('/api/harnesses/claude/profiles/main', {
      overrides: { settings: '{ not json' },
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

    const configPath = sandbox.home('.kimi-code', 'config.toml');
    expect(await readFile(configPath, 'utf8')).toContain('[providers.first]');

    const deleted = await context.del('/api/harnesses/kimi/profiles/first');
    expect(deleted.status).toBe(200);

    const config = await readFile(configPath, 'utf8');
    expect(config).not.toContain('[providers.first]');
    expect(config).toContain('[providers.second]');
    expect(config).toContain('default_model = "second"');
  });

  test('renaming an additive profile removes its old provider id', async () => {
    const context = await createTestApp();
    await createProfile(context, 'kimi', {
      name: 'old-name',
      baseUrl: 'https://api.moonshot.cn/v1',
      apiKey: 'sk-kimi',
      model: 'kimi-k2',
    });
    await activate(context, 'kimi', 'old-name');

    const patched = await context.patch('/api/harnesses/kimi/profiles/old-name', {
      name: 'new-name',
    });
    expect(patched.status).toBe(200);

    const config = await readFile(sandbox.home('.kimi-code', 'config.toml'), 'utf8');
    expect(config).not.toContain('[providers.old-name]');
    expect(config).toContain('[providers.new-name]');
    expect(config).toContain('default_model = "new-name"');
    expect((await summary(context, 'kimi')).active?.name).toBe('new-name');
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

    const env = await readFile(sandbox.data('env.sh'), 'utf8');
    expect(env).toContain("export MY_KEY='sk-or'");
    // Kimi Code never reads the shell, so exporting a key would be a lie.
    expect(env).not.toContain('sk-kimi');

    const config = await readFile(sandbox.home('.codex', 'config.toml'), 'utf8');
    expect(config).toContain('env_key = "MY_KEY"');
    expect(config).not.toContain('sk-or');
  });

  test('choosing the auth.json mode backs up the login cache first', async () => {
    const context = await createTestApp();
    await mkdir(sandbox.home('.codex'), { recursive: true });
    const authFile = sandbox.home('.codex', 'auth.json');
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

    const listed = (await (await context.get('/api/backups')).json()) as {
      items: Array<{ id: string; files: Array<{ path: string }> }>;
    };
    expect(listed.items[0]?.files.map((file) => file.path)).toContain(authFile);

    await context.post(`/api/backups/${encodeURIComponent(listed.items[0]?.id ?? '')}/restore`);
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
      sandbox.data('profiles.json'),
      JSON.stringify({
        zcode: { legacy: { base_url: 'https://old', api_key: {}, model: '', notes: '' } },
      }),
    );

    const response = await context.get('/api/harnesses');
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
    await mkdir(sandbox.home('.claude'), { recursive: true });
    await writeFile(claudeSettings(), '{"env":{"ORIGINAL":"1"}}\n');

    await createProfile(context, 'claude', {
      name: 'main',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
    });
    await activate(context, 'claude', 'main');

    const listed = (await (await context.get('/api/backups')).json()) as {
      items: Array<{ id: string }>;
    };
    expect(listed.items).not.toBeEmpty();

    const detail = await context.get(
      `/api/backups/${encodeURIComponent(listed.items[0]?.id ?? '')}`,
    );
    expect(detail.status).toBe(200);
    const body = (await detail.json()) as {
      files: Array<{ content: string | null; currentContent: string | null }>;
    };
    expect(body.files[0]?.content).toBe('{"env":{"ORIGINAL":"1"}}\n');
    expect(body.files[0]?.currentContent).toContain('ANTHROPIC_BASE_URL');

    const restored = await context.post(
      `/api/backups/${encodeURIComponent(listed.items[0]?.id ?? '')}/restore`,
    );
    expect(restored.status).toBe(200);
    expect(await readFile(claudeSettings(), 'utf8')).toBe('{"env":{"ORIGINAL":"1"}}\n');
  });

  test('exports and imports the Codex login cache only with separate opt-ins', async () => {
    const context = await createTestApp();
    const authPath = sandbox.home('.codex', 'auth.json');
    const exportedCache = '{"tokens":{"access_token":"portable-login-session"}}\n';
    await mkdir(sandbox.home('.codex'), { recursive: true });
    await writeFile(authPath, exportedCache, { mode: 0o600 });

    const availability = await context.get('/api/transfer/export/preview');
    expect(await availability.json()).toEqual({ codexLoginCacheAvailable: true });

    const withoutCache = await context.post('/api/transfer/export', {
      passphrase: 'portable-secret',
      includeCodexLoginCache: false,
    });
    expect(withoutCache.status).toBe(200);
    const withoutCachePreview = await context.post('/api/transfer/preview', {
      envelope: await withoutCache.json(),
      passphrase: 'portable-secret',
    });
    expect((await withoutCachePreview.json()) as TransferPreview).toMatchObject({
      codexLoginCache: { available: false, targetExists: true, migrationNeeded: false },
    });

    const defaultWithCache = await context.post('/api/transfer/export', {
      passphrase: 'portable-secret',
    });
    expect(defaultWithCache.status).toBe(200);
    const envelope = await defaultWithCache.json();
    expect(JSON.stringify(envelope)).not.toContain('portable-login-session');
    const withCachePreview = await context.post('/api/transfer/preview', {
      envelope,
      passphrase: 'portable-secret',
    });
    expect((await withCachePreview.json()) as TransferPreview).toMatchObject({
      codexLoginCache: { available: true, targetExists: true, migrationNeeded: false },
    });

    await writeFile(authPath, '{"tokens":{"access_token":"target-session"}}\n', { mode: 0o644 });
    const preserved = await context.post('/api/transfer/import', {
      envelope,
      passphrase: 'portable-secret',
      conflictPolicy: 'skip',
      restoreActive: false,
      migrateCodexLoginCache: false,
    });
    expect((await preserved.json()) as { codexLoginCacheMigrated: boolean }).toMatchObject({
      codexLoginCacheMigrated: false,
    });
    expect(await readFile(authPath, 'utf8')).toContain('target-session');

    const migrated = await context.post('/api/transfer/import', {
      envelope,
      passphrase: 'portable-secret',
      conflictPolicy: 'skip',
      restoreActive: false,
    });
    expect((await migrated.json()) as { codexLoginCacheMigrated: boolean }).toMatchObject({
      codexLoginCacheMigrated: true,
    });
    expect(await readFile(authPath, 'utf8')).toBe(exportedCache);
    expect((await stat(authPath)).mode & 0o777).toBe(0o600);

    const redundant = await context.post('/api/transfer/import', {
      envelope,
      passphrase: 'portable-secret',
      conflictPolicy: 'skip',
      restoreActive: false,
      migrateCodexLoginCache: true,
    });
    expect((await redundant.json()) as { codexLoginCacheMigrated: boolean }).toMatchObject({
      codexLoginCacheMigrated: false,
    });
  });

  test('rejects semantically invalid portable active states before preview or import', async () => {
    const context = await createTestApp();
    const profile = portableClaudeProfile('main');
    const base: PortableTestPayload = {
      format: 'harness-switch-portable-config',
      version: 1,
      exportedAt: '2026-08-20T00:00:00.000Z',
      profiles: [profile],
      active: [],
    };
    const cases: Array<{ label: string; payload: PortableTestPayload }> = [
      {
        label: 'duplicate profile',
        payload: { ...base, profiles: [profile, { ...profile }] },
      },
      {
        label: 'duplicate active harness',
        payload: {
          ...base,
          active: [
            { harness: 'claude', name: 'main', official: false },
            { harness: 'claude', name: 'main', official: false },
          ],
        },
      },
      {
        label: 'missing active profile',
        payload: { ...base, active: [{ harness: 'claude', name: 'missing', official: false }] },
      },
      {
        label: 'noncanonical official entry',
        payload: { ...base, active: [{ harness: 'claude', name: 'not-official', official: true }] },
      },
      {
        label: 'unsupported official entry',
        payload: { ...base, active: [{ harness: 'qwen', name: '官方登录', official: true }] },
      },
    ];

    for (const item of cases) {
      const envelope = encryptedPortablePayload(item.payload);
      const preview = await context.post('/api/transfer/preview', {
        envelope,
        passphrase: 'portable-secret',
        restoreActive: true,
      });
      expect(preview.status, item.label).toBe(400);

      const imported = await context.post('/api/transfer/import', {
        envelope,
        passphrase: 'portable-secret',
        conflictPolicy: 'overwrite',
        restoreActive: true,
      });
      expect(imported.status, item.label).toBe(400);
    }
    expect((await summary(context, 'claude')).profiles).toHaveLength(0);
  });

  test('a malformed export names the section that is wrong, not just "invalid"', async () => {
    const context = await createTestApp();
    const profile = portableClaudeProfile('main');
    const base = {
      format: 'harness-switch-portable-config',
      version: 1,
      exportedAt: '2026-08-20T00:00:00.000Z',
      profiles: [profile],
      active: [],
    };
    // Which section is broken decides what the user has to go fix, so each one keeps
    // its own code rather than collapsing into a single "bad file".
    const cases = [
      { code: ERROR_CODES.transferEnvelopeInvalid, payload: { ...base, version: 3 } },
      {
        code: ERROR_CODES.transferProfilesInvalid,
        payload: { ...base, profiles: [{ ...profile, harness: 'nope' }] },
      },
      {
        code: ERROR_CODES.transferActiveInvalid,
        payload: { ...base, active: [{ harness: 'claude', name: 'main', official: 'yes' }] },
      },
      {
        code: ERROR_CODES.transferProvidersInvalid,
        payload: {
          ...base,
          providers: [{ id: '__proto__', name: 'p', apiKey: 'k', endpoints: [] }],
        },
      },
      { code: ERROR_CODES.transferCodexCacheInvalid, payload: { ...base, codexLoginCache: 7 } },
    ];

    for (const item of cases) {
      const response = await context.post('/api/transfer/preview', {
        envelope: encryptedPortablePayload(item.payload as unknown as PortableTestPayload),
        passphrase: 'portable-secret',
      });
      expect(response.status, item.code).toBe(400);
      expect(await response.json(), item.code).toMatchObject({ code: item.code });
    }
  });

  test('previews and restores an active Codex openai_auth profile without copying its login cache', async () => {
    const context = await createTestApp();
    const authPath = sandbox.home('.codex', 'auth.json');
    await mkdir(sandbox.home('.codex'), { recursive: true });
    await writeFile(authPath, JSON.stringify({ tokens: { refresh_token: 'target-session' } }));
    await createProfile(context, 'codex', {
      name: 'third-party',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-portable-openai',
      extras: { authMode: 'openai_auth' },
    });
    await activate(context, 'codex', 'third-party');

    const exported = await context.post('/api/transfer/export', { passphrase: 'portable-secret' });
    const envelope = await exported.json();
    expect(exported.status).toBe(200);

    await context.post('/api/harnesses/codex/official/activate');
    await context.del('/api/harnesses/codex/profiles/third-party');
    await writeFile(authPath, JSON.stringify({ tokens: { refresh_token: 'target-session' } }));
    const backupsBeforeImport = (
      (await (await context.get('/api/backups')).json()) as { items: Array<{ id: string }> }
    ).items.length;

    const preview = await context.post('/api/transfer/preview', {
      envelope,
      passphrase: 'portable-secret',
      conflictPolicy: 'skip',
      restoreActive: true,
    });
    expect((await preview.json()) as TransferPreview).toMatchObject({
      codexActivationAuthEffect: 'openai-api-key',
      codexLoginCache: { available: true },
    });

    const imported = await context.post('/api/transfer/import', {
      envelope,
      passphrase: 'portable-secret',
      conflictPolicy: 'skip',
      restoreActive: true,
      migrateCodexLoginCache: false,
    });
    expect(
      (await imported.json()) as { activeRestored: number; codexLoginCacheMigrated: boolean },
    ).toMatchObject({
      activeRestored: 1,
      codexLoginCacheMigrated: false,
    });
    expect(JSON.parse(await readFile(authPath, 'utf8'))).toMatchObject({
      tokens: { refresh_token: 'target-session' },
      OPENAI_API_KEY: 'sk-portable-openai',
    });

    const backups = (await (await context.get('/api/backups')).json()) as {
      items: Array<{ files: Array<{ path: string }> }>;
    };
    expect(backups.items).toHaveLength(backupsBeforeImport + 1);
    expect(
      backups.items.some((backup) => backup.files.some((file) => file.path === authPath)),
    ).toBe(true);
  });

  test('plans Codex activation effects from the profile selected by the conflict policy', async () => {
    const context = await createTestApp();
    const authPath = sandbox.home('.codex', 'auth.json');
    await mkdir(sandbox.home('.codex'), { recursive: true });
    await writeFile(authPath, JSON.stringify({ tokens: { refresh_token: 'target-session' } }));
    await createProfile(context, 'codex', {
      name: 'same-name',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-source-openai',
      extras: { authMode: 'openai_auth' },
    });
    await activate(context, 'codex', 'same-name');
    const exported = await context.post('/api/transfer/export', { passphrase: 'portable-secret' });
    const envelope = await exported.json();

    const changed = await context.patch('/api/harnesses/codex/profiles/same-name', {
      extras: { authMode: 'bearer_token' },
    });
    expect(changed.status).toBe(200);
    await writeFile(authPath, JSON.stringify({ tokens: { refresh_token: 'target-session' } }));

    const preview = async (conflictPolicy: 'skip' | 'overwrite') => {
      const response = await context.post('/api/transfer/preview', {
        envelope,
        passphrase: 'portable-secret',
        conflictPolicy,
        restoreActive: true,
      });
      return (await response.json()) as TransferPreview;
    };
    expect((await preview('skip')).codexActivationAuthEffect).toBe('none');
    expect((await preview('overwrite')).codexActivationAuthEffect).toBe('openai-api-key');

    const skipped = await context.post('/api/transfer/import', {
      envelope,
      passphrase: 'portable-secret',
      conflictPolicy: 'skip',
      restoreActive: true,
      migrateCodexLoginCache: false,
    });
    expect(skipped.status).toBe(200);
    expect(JSON.parse(await readFile(authPath, 'utf8'))).toEqual({
      tokens: { refresh_token: 'target-session' },
    });

    const overwritten = await context.post('/api/transfer/import', {
      envelope,
      passphrase: 'portable-secret',
      conflictPolicy: 'overwrite',
      restoreActive: true,
    });
    expect(overwritten.status).toBe(200);
    expect(JSON.parse(await readFile(authPath, 'utf8'))).toMatchObject({
      tokens: { refresh_token: 'target-session' },
      OPENAI_API_KEY: 'sk-source-openai',
    });
  });

  test('exports secrets in a portable encrypted bundle and imports them again', async () => {
    const context = await createTestApp();
    await createProfile(context, 'claude', {
      name: 'portable',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-portable-secret',
      model: 'claude-sonnet-4-5',
      extras: { authVar: 'ANTHROPIC_AUTH_TOKEN' },
      overrides: { settings: '{"env":{"FROM_EXPORT":"1"}}\n' },
    });

    const exported = await context.post('/api/transfer/export', { passphrase: 'portable-secret' });
    expect(exported.status).toBe(200);
    const envelope = await exported.json();
    expect(JSON.stringify(envelope)).not.toContain('sk-portable-secret');

    const conflictPreview = await context.post('/api/transfer/preview', {
      envelope,
      passphrase: 'portable-secret',
    });
    expect(conflictPreview.status).toBe(200);
    expect(((await conflictPreview.json()) as TransferPreview).conflicts).toEqual([
      { harness: 'claude', name: 'portable' },
    ]);

    const wrongPassword = await context.post('/api/transfer/preview', {
      envelope,
      passphrase: 'wrong-password',
    });
    expect(wrongPassword.status).toBe(400);

    await context.del('/api/harnesses/claude/profiles/portable');
    const imported = await context.post('/api/transfer/import', {
      envelope,
      passphrase: 'portable-secret',
      conflictPolicy: 'skip',
      restoreActive: false,
    });
    expect(imported.status).toBe(200);
    expect(await imported.json()).toMatchObject({ imported: 1, overwritten: 0, skipped: 0 });

    expect((await activate(context, 'claude', 'portable')).status).toBe(200);
    expect(await readFile(claudeSettings(), 'utf8')).toContain('FROM_EXPORT');
    expect(await readFile(sandbox.data('env.sh'), 'utf8')).toContain(
      "ANTHROPIC_AUTH_TOKEN='sk-portable-secret'",
    );
  });
});
