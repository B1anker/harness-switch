import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFile, rm, writeFile } from 'node:fs/promises';
import type { ProviderMutationResponse } from '@seaveyon/harness-switch-shared';
import { WARNING_CODES } from '@seaveyon/harness-switch-shared';
import { createSandbox, createTestApp, type Sandbox } from './support';

let sandbox: Sandbox;

beforeEach(() => {
  sandbox = createSandbox('hsw-vault-api', { env: (home) => ({ CODEX_HOME: home('.codex') }) });
});

afterEach(() => {
  sandbox.dispose();
});

async function liveSettings(): Promise<{ env: Record<string, string> }> {
  return JSON.parse(await readFile(sandbox.home('.claude', 'settings.json'), 'utf8'));
}

describe('providers api', () => {
  test('requires authentication', async () => {
    const { app } = await createTestApp();
    expect((await app.request('/api/providers')).status).toBe(401);
    expect((await app.request('/api/providers/acme/reveal')).status).toBe(401);
    expect((await app.request('/api/doctor')).status).toBe(401);
    expect((await app.request('/api/drift')).status).toBe(401);
  });

  test('reveal returns the plaintext key the list withholds', async () => {
    const context = await createTestApp();
    const created = await context.post('/api/providers', {
      name: 'acme',
      apiKey: 'sk-reveal-me',
      endpoints: [{ key: 'default', baseUrl: 'https://api.acme.example/v1' }],
    });
    expect(created.status).toBe(201);

    const revealed = await context.get('/api/providers/acme/reveal');
    expect(revealed.status).toBe(200);
    expect(revealed.headers.get('cache-control')).toBe('no-store');
    expect(await revealed.json()).toEqual({ apiKey: 'sk-reveal-me' });

    // An unknown id is a 404 rather than an empty key, so the UI can tell the
    // difference between "no such entry" and "entry with no credential".
    expect((await context.get('/api/providers/ghost/reveal')).status).toBe(404);
  });

  test('creates, lists and updates a provider without leaking the key', async () => {
    const context = await createTestApp();
    const created = await context.post('/api/providers', {
      name: 'acme',
      apiKey: 'sk-acme',
      endpoints: [
        { key: 'default', label: 'Default', baseUrl: 'https://api.acme.example/v1' },
        { key: 'eu', label: 'EU', baseUrl: 'https://eu.acme.example/v1' },
      ],
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { provider: { id: string } };
    expect(JSON.stringify(body)).not.toContain('sk-acme');
    expect(body.provider.id).toBe('acme');

    const listed = await context.json<{ items: Array<{ id: string }> }>('/api/providers');
    expect(listed.items.map((item) => item.id)).toContain('acme');
  });

  test('a profile referencing a provider is re-applied when the provider is updated', async () => {
    const context = await createTestApp();
    await context.post('/api/providers', {
      name: 'acme',
      apiKey: 'sk-acme',
      endpoints: [{ key: 'default', label: 'Default', baseUrl: 'https://api.acme.example/v1' }],
    });

    const created = await context.post('/api/harnesses/claude/profiles', {
      name: 'main',
      baseUrl: 'https://api.acme.example/v1',
      model: 'claude-sonnet-4-5',
      providerId: 'acme',
      providerEndpoint: 'default',
    });
    expect(created.status).toBe(201);
    expect((await context.post('/api/harnesses/claude/profiles/main/activate')).status).toBe(200);
    expect((await liveSettings()).env.ANTHROPIC_AUTH_TOKEN).toBe('sk-acme');

    // Rotate the credential; the active referencing profile must be re-written.
    const patched = await context.patch('/api/providers/acme', { apiKey: 'sk-rotated' });
    expect(patched.status).toBe(200);
    const result = (await patched.json()) as ProviderMutationResponse;
    expect(result.warnings).toEqual([]);

    const settings = await liveSettings();
    expect(settings.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-rotated');
    expect(settings.env.ANTHROPIC_BASE_URL).toBe('https://api.acme.example/v1');
  });

  test('an endpoint base url change is re-applied to the live file', async () => {
    const context = await createTestApp();
    await context.post('/api/providers', {
      name: 'acme',
      apiKey: 'sk-acme',
      endpoints: [{ key: 'eu', label: 'EU', baseUrl: 'https://eu.acme.example/v1' }],
    });
    await context.post('/api/harnesses/claude/profiles', {
      name: 'main',
      baseUrl: 'https://eu.acme.example/v1',
      model: 'claude-sonnet-4-5',
      providerId: 'acme',
      providerEndpoint: 'eu',
    });
    await context.post('/api/harnesses/claude/profiles/main/activate');

    const patched = await context.patch('/api/providers/acme', {
      endpoints: [{ key: 'eu', label: 'EU', baseUrl: 'https://eu2.acme.example/v1' }],
    });
    expect(patched.status).toBe(200);

    const listed = await context.json<{
      items: Array<{
        id: string;
        endpoints: Array<{ key: string; label: string; baseUrl: string }>;
      }>;
    }>('/api/providers');
    expect(listed.items.find((entry) => entry.id === 'acme')?.endpoints).toEqual([
      { key: 'eu', label: 'EU', baseUrl: 'https://eu2.acme.example/v1' },
    ]);
    expect((await liveSettings()).env.ANTHROPIC_BASE_URL).toBe('https://eu2.acme.example/v1');
  });

  test('a failed re-apply is reported as a warning, not a failure', async () => {
    const context = await createTestApp();
    await context.post('/api/providers', { name: 'acme', apiKey: 'sk-acme' });
    await context.post('/api/harnesses/claude/profiles', {
      name: 'main',
      baseUrl: 'https://api.example.com/v1',
      model: 'claude-sonnet-4-5',
      providerId: 'acme',
    });
    await context.post('/api/harnesses/claude/profiles/main/activate');

    // Block the live file directory so the re-apply must fail.
    const claudeDir = sandbox.home('.claude');
    await rm(claudeDir, { recursive: true, force: true });
    await writeFile(claudeDir, 'not a directory');

    const patched = await context.patch('/api/providers/acme', { apiKey: 'sk-rotated' });
    expect(patched.status).toBe(200);
    const result = (await patched.json()) as ProviderMutationResponse;
    expect(result.warnings.some((warning) => warning.code === WARNING_CODES.reapplyFailed)).toBe(
      true,
    );
  });

  test('deleting a referenced provider is refused with 409', async () => {
    const context = await createTestApp();
    await context.post('/api/providers', { name: 'acme', apiKey: 'sk-acme' });
    await context.post('/api/harnesses/claude/profiles', {
      name: 'main',
      baseUrl: 'https://api.example.com/v1',
      providerId: 'acme',
    });

    expect((await context.del('/api/providers/acme')).status).toBe(409);

    await context.del('/api/harnesses/claude/profiles/main');
    expect((await context.del('/api/providers/acme')).status).toBe(200);
  });

  test('export and import restore vault entries and profile references', async () => {
    const context = await createTestApp();
    await context.post('/api/providers', { name: 'acme', apiKey: 'sk-acme-secret' });
    await context.post('/api/providers', { name: 'unused', apiKey: 'sk-unused-secret' });
    await context.post('/api/harnesses/claude/profiles', {
      name: 'main',
      baseUrl: 'https://api.example.com/v1',
      providerId: 'acme',
    });

    const exported = await context.post('/api/transfer/export', { passphrase: 'portable-secret' });
    expect(exported.status).toBe(200);
    const envelope = await exported.json();
    expect(JSON.stringify(envelope)).not.toContain('sk-acme-secret');

    const imported = await context.post('/api/transfer/import', {
      envelope,
      passphrase: 'portable-secret',
      conflictPolicy: 'overwrite',
      restoreActive: false,
    });
    expect(imported.status).toBe(200);
    expect((await imported.json()) as { providersCopied: number }).toMatchObject({
      providersCopied: 2,
    });

    const profiles = await context.json<{
      items: Array<{ id: string; profiles: Array<{ providerId?: string }> }>;
    }>('/api/harnesses');
    const restored = profiles.items
      .find((item) => item.id === 'claude')
      ?.profiles.find((profile) => profile.providerId === 'acme-imported');
    expect(restored).toBeDefined();

    const providers = await context.json<{ items: Array<{ id: string; endpoints: unknown[] }> }>(
      '/api/providers',
    );
    expect(providers.items).toContainEqual(
      expect.objectContaining({ id: 'acme-imported', endpoints: [] }),
    );
    expect(providers.items).toContainEqual(expect.objectContaining({ id: 'unused-imported' }));

    expect((await context.post('/api/harnesses/claude/profiles/main/activate')).status).toBe(200);
    expect((await liveSettings()).env.ANTHROPIC_AUTH_TOKEN).toBe('sk-acme-secret');
  });

  test('an unparsable body and unknown ids fail cleanly', async () => {
    const context = await createTestApp();
    const malformed = await context.request('/api/providers', {
      method: 'POST',
      body: 'not json',
    });
    expect(malformed.status).toBe(400);
    expect((await context.patch('/api/providers/ghost', { name: 'x' })).status).toBe(404);
  });
});
