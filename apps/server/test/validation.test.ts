import { afterEach, describe, expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { createServices } from '../src/bootstrap';
import { IAuthService } from '../src/services/auth';
import { IEnvironmentService } from '../src/services/environment';
import { createSandbox, createTestApp, type Sandbox, type TestApp } from './support';

let sandbox: Sandbox;

async function boot(): Promise<TestApp> {
  sandbox = createSandbox('hsw-valid');
  return createTestApp();
}

/** Reads the raw store so a test can prove a rejected body never reached disk. */
async function profileStore(): Promise<string> {
  return readFile(sandbox.data('profiles.json'), 'utf8').catch(() => '');
}

async function errorOf(response: Response): Promise<string> {
  const payload = (await response.json()) as { data?: { fields?: string } };
  return payload.data?.fields ?? '';
}

describe('request validation', () => {
  afterEach(() => {
    sandbox?.dispose();
  });

  test('a non-string extras value is refused instead of reaching the store', async () => {
    const context = await boot();
    const response = await context.post('/api/harnesses/claude/profiles', {
      name: 'broken',
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      extras: { authVar: 123 },
    });

    // Previously this was persisted and only blew up as a 500 on the next activation.
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toContain('extras.authVar');
    expect(await profileStore()).toBe('');
  });

  test('rejects an empty login password before authentication', async () => {
    const { app } = await boot();
    const response = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: '   ' }),
    });
    expect(response.status).toBe(400);
  });

  test('refuses to use an empty password file', async () => {
    sandbox = createSandbox('hsw-empty-password');
    const services = createServices();
    services.get(IEnvironmentService).ensureDataDir();
    await writeFile(sandbox.data('web_password'), '  \n');
    expect(() => services.get(IAuthService).ensurePassword()).toThrow(/password file is empty/);
  });

  test('an override that is not file content is refused', async () => {
    const context = await boot();
    const response = await context.post('/api/harnesses/claude/profiles', {
      name: 'broken',
      apiKey: 'sk-test',
      overrides: { settings: { env: {} } },
    });

    expect(response.status).toBe(400);
    expect(await errorOf(response)).toContain('overrides.settings');
    expect(await profileStore()).toBe('');
  });

  test('a profile name with a slash is refused before it becomes a store key', async () => {
    const context = await boot();
    const response = await context.post('/api/harnesses/claude/profiles', {
      name: '../escape',
      apiKey: 'sk-test',
    });

    expect(response.status).toBe(400);
    expect(await errorOf(response)).toContain('name');
    expect(await profileStore()).toBe('');
  });

  test('a missing name is refused', async () => {
    const context = await boot();
    expect((await context.post('/api/harnesses/claude/profiles', { apiKey: 'sk' })).status).toBe(
      400,
    );
  });

  test('an unknown field is dropped rather than rejected or stored', async () => {
    const context = await boot();
    const response = await context.post('/api/harnesses/claude/profiles', {
      name: 'ok',
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      somethingThisVersionDoesNotKnow: true,
    });

    // An older client sending a dropped field still works, but nothing unknown lands.
    expect(response.status).toBe(201);
    expect(await profileStore()).not.toContain('somethingThisVersionDoesNotKnow');
  });

  test('a patch keeps validating the fields it does mention', async () => {
    const context = await boot();
    expect(
      (
        await context.post('/api/harnesses/claude/profiles', {
          name: 'main',
          baseUrl: 'https://api.example.com',
          apiKey: 'sk-test',
        })
      ).status,
    ).toBe(201);

    const before = await profileStore();
    const response = await context.patch('/api/harnesses/claude/profiles/main', {
      extras: { authVar: ['not', 'a', 'string'] },
    });

    expect(response.status).toBe(400);
    expect(await profileStore()).toBe(before);
  });

  test('duplicate provider endpoint keys are refused', async () => {
    const context = await boot();
    const response = await context.post('/api/providers', {
      name: 'dup',
      apiKey: 'sk-test',
      endpoints: [
        { key: 'cn', label: '中国', baseUrl: 'https://cn.example.com' },
        { key: 'cn', label: '再来一次', baseUrl: 'https://cn2.example.com' },
      ],
    });

    expect(response.status).toBe(400);
    expect(await errorOf(response)).toContain('endpoints');
  });

  test('a provider endpoint without a baseUrl is refused', async () => {
    const context = await boot();
    const response = await context.post('/api/providers', {
      name: 'incomplete',
      apiKey: 'sk-test',
      endpoints: [{ key: 'cn', label: '中国' }],
    });

    expect(response.status).toBe(400);
    expect(await errorOf(response)).toContain('endpoints.0.baseUrl');
  });

  test('an unknown harness in a sync request is refused', async () => {
    const context = await boot();
    const response = await context.post('/api/users/sync', {
      sourceUser: 'someone',
      overwriteHarnesses: ['claude', 'not-a-harness'],
    });

    expect(response.status).toBe(400);
    expect(await errorOf(response)).toContain('overwriteHarnesses.1');
  });

  test('a transfer import with a malformed envelope is refused', async () => {
    const context = await boot();
    const response = await context.post('/api/transfer/import', {
      envelope: { format: 'harness-switch-encrypted-export', version: 1 },
      passphrase: 'secret',
    });

    expect(response.status).toBe(400);
    expect(await errorOf(response)).toContain('envelope.kdf');
  });

  test('a body that is not an object at all is refused', async () => {
    const context = await boot();
    expect((await context.post('/api/harnesses/claude/profiles', 'just a string')).status).toBe(
      400,
    );
    expect((await context.post('/api/providers', [1, 2, 3])).status).toBe(400);
  });
});
