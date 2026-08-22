import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app';
import { createServices } from '../src/bootstrap';
import { IAuthService } from '../src/services/auth';
import { IEnvironmentService } from '../src/services/environment';

let homeDir = '';

type TestApp = {
  app: ReturnType<typeof createApp>;
  cookie: string;
  dataDir: string;
};

async function createTestApp(): Promise<TestApp> {
  homeDir = await mkdtemp(join(tmpdir(), 'hsw-valid-'));
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
    dataDir: process.env.HSW_DATA_DIR,
  };
}

async function post({ app, cookie }: TestApp, path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });
}

async function patch({ app, cookie }: TestApp, path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });
}

/** Reads the raw store so a test can prove a rejected body never reached disk. */
async function profileStore(context: TestApp): Promise<string> {
  return readFile(join(context.dataDir, 'profiles.json'), 'utf8').catch(() => '');
}

async function errorOf(response: Response): Promise<string> {
  const payload = (await response.json()) as { error?: string };
  return payload.error ?? '';
}

describe('request validation', () => {
  afterEach(async () => {
    delete process.env.HSW_HOME_DIR;
    delete process.env.HSW_DATA_DIR;
    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  test('a non-string extras value is refused instead of reaching the store', async () => {
    const context = await createTestApp();
    const response = await post(context, '/api/harnesses/claude/profiles', {
      name: 'broken',
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      extras: { authVar: 123 },
    });

    // Previously this was persisted and only blew up as a 500 on the next activation.
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toContain('extras.authVar');
    expect(await profileStore(context)).toBe('');
  });

  test('an override that is not file content is refused', async () => {
    const context = await createTestApp();
    const response = await post(context, '/api/harnesses/claude/profiles', {
      name: 'broken',
      apiKey: 'sk-test',
      overrides: { settings: { env: {} } },
    });

    expect(response.status).toBe(400);
    expect(await errorOf(response)).toContain('overrides.settings');
    expect(await profileStore(context)).toBe('');
  });

  test('a profile name with a slash is refused before it becomes a store key', async () => {
    const context = await createTestApp();
    const response = await post(context, '/api/harnesses/claude/profiles', {
      name: '../escape',
      apiKey: 'sk-test',
    });

    expect(response.status).toBe(400);
    expect(await errorOf(response)).toContain('name');
    expect(await profileStore(context)).toBe('');
  });

  test('a missing name is refused', async () => {
    const context = await createTestApp();
    expect((await post(context, '/api/harnesses/claude/profiles', { apiKey: 'sk' })).status).toBe(
      400,
    );
  });

  test('an unknown field is dropped rather than rejected or stored', async () => {
    const context = await createTestApp();
    const response = await post(context, '/api/harnesses/claude/profiles', {
      name: 'ok',
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      somethingThisVersionDoesNotKnow: true,
    });

    // An older client sending a dropped field still works, but nothing unknown lands.
    expect(response.status).toBe(201);
    expect(await profileStore(context)).not.toContain('somethingThisVersionDoesNotKnow');
  });

  test('a patch keeps validating the fields it does mention', async () => {
    const context = await createTestApp();
    expect(
      (
        await post(context, '/api/harnesses/claude/profiles', {
          name: 'main',
          baseUrl: 'https://api.example.com',
          apiKey: 'sk-test',
        })
      ).status,
    ).toBe(201);

    const before = await profileStore(context);
    const response = await patch(context, '/api/harnesses/claude/profiles/main', {
      extras: { authVar: ['not', 'a', 'string'] },
    });

    expect(response.status).toBe(400);
    expect(await profileStore(context)).toBe(before);
  });

  test('duplicate provider endpoint keys are refused', async () => {
    const context = await createTestApp();
    const response = await post(context, '/api/providers', {
      name: 'dup',
      apiKey: 'sk-test',
      endpoints: [
        { key: 'cn', label: '中国', baseUrl: 'https://cn.example.com' },
        { key: 'cn', label: '再来一次', baseUrl: 'https://cn2.example.com' },
      ],
    });

    expect(response.status).toBe(400);
    expect(await errorOf(response)).toContain('endpoint key');
  });

  test('a provider endpoint without a baseUrl is refused', async () => {
    const context = await createTestApp();
    const response = await post(context, '/api/providers', {
      name: 'incomplete',
      apiKey: 'sk-test',
      endpoints: [{ key: 'cn', label: '中国' }],
    });

    expect(response.status).toBe(400);
    expect(await errorOf(response)).toContain('endpoints.0.baseUrl');
  });

  test('an unknown harness in a sync request is refused', async () => {
    const context = await createTestApp();
    const response = await post(context, '/api/users/sync', {
      sourceUser: 'someone',
      overwriteHarnesses: ['claude', 'not-a-harness'],
    });

    expect(response.status).toBe(400);
    expect(await errorOf(response)).toContain('overwriteHarnesses.1');
  });

  test('a transfer import with a malformed envelope is refused', async () => {
    const context = await createTestApp();
    const response = await post(context, '/api/transfer/import', {
      envelope: { format: 'harness-switch-encrypted-export', version: 1 },
      passphrase: 'secret',
    });

    expect(response.status).toBe(400);
    expect(await errorOf(response)).toContain('envelope.kdf');
  });

  test('a body that is not an object at all is refused', async () => {
    const context = await createTestApp();
    expect((await post(context, '/api/harnesses/claude/profiles', 'just a string')).status).toBe(
      400,
    );
    expect((await post(context, '/api/providers', [1, 2, 3])).status).toBe(400);
  });
});
