import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderMutationResponse } from '@seaveyon/harness-switch-shared';
import { WARNING_CODES } from '@seaveyon/harness-switch-shared';
import { createApp } from '../src/app';
import { createServices } from '../src/bootstrap';
import { IAuthService } from '../src/services/auth';
import { IEnvironmentService } from '../src/services/environment';

let homeDir = '';
const originalCodexHome = process.env.CODEX_HOME;

type TestApp = {
  app: ReturnType<typeof createApp>;
  cookie: string;
  password: string;
  dataDir: string;
};

async function createTestApp(): Promise<TestApp> {
  homeDir = await mkdtemp(join(tmpdir(), 'hsw-vault-api-'));
  process.env.HSW_HOME_DIR = homeDir;
  process.env.HSW_DATA_DIR = join(homeDir, '.harness-switch');
  process.env.CODEX_HOME = join(homeDir, '.codex');
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

describe('providers api', () => {
  afterEach(async () => {
    delete process.env.HSW_HOME_DIR;
    delete process.env.HSW_DATA_DIR;
    if (originalCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodexHome;
    }
    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  test('requires authentication', async () => {
    const { app } = await createTestApp();
    expect((await app.request('/api/providers')).status).toBe(401);
    expect((await app.request('/api/doctor')).status).toBe(401);
    expect((await app.request('/api/drift')).status).toBe(401);
  });

  test('creates, lists and updates a provider without leaking the key', async () => {
    const { app, cookie } = await createTestApp();
    const created = await app.request('/api/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        name: 'acme',
        apiKey: 'sk-acme',
        endpoints: [
          { key: 'default', label: 'Default', baseUrl: 'https://api.acme.example/v1' },
          { key: 'eu', label: 'EU', baseUrl: 'https://eu.acme.example/v1' },
        ],
      }),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { provider: { id: string } };
    expect(JSON.stringify(body)).not.toContain('sk-acme');
    expect(body.provider.id).toBe('acme');

    const listed = (await (
      await app.request('/api/providers', { headers: { Cookie: cookie } })
    ).json()) as { items: Array<{ id: string }> };
    expect(listed.items.map((item) => item.id)).toContain('acme');
  });

  test('a profile referencing a provider is re-applied when the provider is updated', async () => {
    const { app, cookie } = await createTestApp();
    await app.request('/api/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        name: 'acme',
        apiKey: 'sk-acme',
        endpoints: [{ key: 'default', label: 'Default', baseUrl: 'https://api.acme.example/v1' }],
      }),
    });

    const created = await app.request('/api/harnesses/claude/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        name: 'main',
        baseUrl: 'https://api.acme.example/v1',
        model: 'claude-sonnet-4-5',
        providerId: 'acme',
        providerEndpoint: 'default',
      }),
    });
    expect(created.status).toBe(201);

    const activated = await app.request('/api/harnesses/claude/profiles/main/activate', {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(activated.status).toBe(200);
    expect(JSON.parse(await readFile(claudeSettings(), 'utf8')).env.ANTHROPIC_AUTH_TOKEN).toBe(
      'sk-acme',
    );

    // Rotate the credential; the active referencing profile must be re-written.
    const patched = await app.request('/api/providers/acme', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ apiKey: 'sk-rotated' }),
    });
    expect(patched.status).toBe(200);
    const result = (await patched.json()) as ProviderMutationResponse;
    expect(result.warnings).toEqual([]);

    const settings = JSON.parse(await readFile(claudeSettings(), 'utf8'));
    expect(settings.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-rotated');
    expect(settings.env.ANTHROPIC_BASE_URL).toBe('https://api.acme.example/v1');
  });

  test('an endpoint base url change is re-applied to the live file', async () => {
    const { app, cookie } = await createTestApp();
    await app.request('/api/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        name: 'acme',
        apiKey: 'sk-acme',
        endpoints: [{ key: 'eu', label: 'EU', baseUrl: 'https://eu.acme.example/v1' }],
      }),
    });
    await app.request('/api/harnesses/claude/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        name: 'main',
        baseUrl: 'https://eu.acme.example/v1',
        model: 'claude-sonnet-4-5',
        providerId: 'acme',
        providerEndpoint: 'eu',
      }),
    });
    await app.request('/api/harnesses/claude/profiles/main/activate', {
      method: 'POST',
      headers: { Cookie: cookie },
    });

    const patched = await app.request('/api/providers/acme', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        endpoints: [{ key: 'eu', label: 'EU', baseUrl: 'https://eu2.acme.example/v1' }],
      }),
    });
    expect(patched.status).toBe(200);
    const listed = (await (
      await app.request('/api/providers', { headers: { Cookie: cookie } })
    ).json()) as {
      items: Array<{
        id: string;
        endpoints: Array<{ key: string; label: string; baseUrl: string }>;
      }>;
    };
    expect(listed.items.find((entry) => entry.id === 'acme')?.endpoints).toEqual([
      { key: 'eu', label: 'EU', baseUrl: 'https://eu2.acme.example/v1' },
    ]);
    const settings = JSON.parse(await readFile(claudeSettings(), 'utf8'));
    expect(settings.env.ANTHROPIC_BASE_URL).toBe('https://eu2.acme.example/v1');
  });

  test('a failed re-apply is reported as a warning, not a failure', async () => {
    const { app, cookie } = await createTestApp();
    await app.request('/api/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: 'acme', apiKey: 'sk-acme' }),
    });
    await app.request('/api/harnesses/claude/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        name: 'main',
        baseUrl: 'https://api.example.com/v1',
        model: 'claude-sonnet-4-5',
        providerId: 'acme',
      }),
    });
    await app.request('/api/harnesses/claude/profiles/main/activate', {
      method: 'POST',
      headers: { Cookie: cookie },
    });

    // Block the live file directory so the re-apply must fail.
    const claudeDir = join(homeDir, '.claude');
    await rm(claudeDir, { recursive: true, force: true });
    await writeFile(claudeDir, 'not a directory');

    const patched = await app.request('/api/providers/acme', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ apiKey: 'sk-rotated' }),
    });
    expect(patched.status).toBe(200);
    const result = (await patched.json()) as ProviderMutationResponse;
    expect(result.warnings.some((warning) => warning.code === WARNING_CODES.reapplyFailed)).toBe(
      true,
    );
  });

  test('deleting a referenced provider is refused with 409', async () => {
    const { app, cookie } = await createTestApp();
    await app.request('/api/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: 'acme', apiKey: 'sk-acme' }),
    });
    await app.request('/api/harnesses/claude/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        name: 'main',
        baseUrl: 'https://api.example.com/v1',
        providerId: 'acme',
      }),
    });

    const deleted = await app.request('/api/providers/acme', {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(deleted.status).toBe(409);

    await app.request('/api/harnesses/claude/profiles/main', {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(
      (
        await app.request('/api/providers/acme', {
          method: 'DELETE',
          headers: { Cookie: cookie },
        })
      ).status,
    ).toBe(200);
  });

  test('export and import restore vault entries and profile references', async () => {
    const { app, cookie } = await createTestApp();
    await app.request('/api/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: 'acme', apiKey: 'sk-acme-secret' }),
    });
    await app.request('/api/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: 'unused', apiKey: 'sk-unused-secret' }),
    });
    await app.request('/api/harnesses/claude/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        name: 'main',
        baseUrl: 'https://api.example.com/v1',
        providerId: 'acme',
      }),
    });

    const exported = await app.request('/api/transfer/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ passphrase: 'portable-secret' }),
    });
    expect(exported.status).toBe(200);
    const envelope = await exported.json();
    expect(JSON.stringify(envelope)).not.toContain('sk-acme-secret');

    const imported = await app.request('/api/transfer/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        envelope,
        passphrase: 'portable-secret',
        conflictPolicy: 'overwrite',
        restoreActive: false,
      }),
    });
    expect(imported.status).toBe(200);
    expect((await imported.json()) as { providersCopied: number }).toMatchObject({
      providersCopied: 2,
    });

    const profiles = (await (
      await app.request('/api/harnesses', { headers: { Cookie: cookie } })
    ).json()) as { items: Array<{ id: string; profiles: Array<{ providerId?: string }> }> };
    const restored = profiles.items
      .find((item) => item.id === 'claude')
      ?.profiles.find((profile) => profile.providerId === 'acme-imported');
    expect(restored).toBeDefined();

    const providers = (await (
      await app.request('/api/providers', { headers: { Cookie: cookie } })
    ).json()) as { items: Array<{ id: string; endpoints: unknown[] }> };
    expect(providers.items).toContainEqual(
      expect.objectContaining({ id: 'acme-imported', endpoints: [] }),
    );
    expect(providers.items).toContainEqual(expect.objectContaining({ id: 'unused-imported' }));

    const activated = await app.request('/api/harnesses/claude/profiles/main/activate', {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(activated.status).toBe(200);
    expect(JSON.parse(await readFile(claudeSettings(), 'utf8')).env.ANTHROPIC_AUTH_TOKEN).toBe(
      'sk-acme-secret',
    );
  });

  test('an unparsable body and unknown ids fail cleanly', async () => {
    const { app, cookie } = await createTestApp();
    expect(
      (
        await app.request('/api/providers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: 'not json',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await app.request('/api/providers/ghost', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({ name: 'x' }),
        })
      ).status,
    ).toBe(404);
  });
});
