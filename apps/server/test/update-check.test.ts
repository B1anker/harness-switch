import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { checkForUpdate } from '../src/update';
import { serverVersion } from '../src/version';

const realFetch = globalThis.fetch;
const originalCodexHome = process.env.CODEX_HOME;
let homeDir = '';

afterEach(async () => {
  globalThis.fetch = realFetch;
  delete process.env.HSW_HOME_DIR;
  delete process.env.HSW_DATA_DIR;
  delete process.env.HSW_UPDATE_SPAWN;
  if (originalCodexHome === undefined) {
    delete process.env.CODEX_HOME;
  } else {
    process.env.CODEX_HOME = originalCodexHome;
  }
  if (homeDir) {
    await rm(homeDir, { recursive: true, force: true });
  }
});

function registryResponding(version: string) {
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({ version }),
  })) as unknown as typeof globalThis.fetch;
}

async function buildAuthedApp(): Promise<{ app: Hono; cookie: string }> {
  const { createApp } = await import('../src/app');
  const { createServices } = await import('../src/bootstrap');
  const { IEnvironmentService } = await import('../src/services/environment');
  const { IAuthService } = await import('../src/services/auth');

  homeDir = await mkdtemp(join(tmpdir(), 'hsw-update-'));
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
  return { app, cookie: login.headers.get('set-cookie') ?? '' };
}

describe('checkForUpdate', () => {
  test('reports an update when the registry has a newer version', async () => {
    registryResponding('99.0.1');
    const result = await checkForUpdate(true);
    expect(result.latest).toBe('99.0.1');
    expect(result.updateAvailable).toBe(true);
  });

  test('reports no update when running the latest version', async () => {
    registryResponding(await serverVersion());
    const result = await checkForUpdate(true);
    expect(result.updateAvailable).toBe(false);
  });

  test('degrades to no update when the registry is unreachable', async () => {
    globalThis.fetch = (async () => {
      throw new Error('offline');
    }) as unknown as typeof globalThis.fetch;
    const result = await checkForUpdate(true);
    expect(result.latest).toBeNull();
    expect(result.updateAvailable).toBe(false);
  });
});

describe('update api', () => {
  test('requires authentication', async () => {
    const { app } = await buildAuthedApp();
    const check = await app.request('/api/update/check');
    expect(check.status).toBe(401);
    const update = await app.request('/api/update', { method: 'POST' });
    expect(update.status).toBe(401);
  });

  test('reports current and latest for an authenticated session', async () => {
    const { app, cookie } = await buildAuthedApp();
    registryResponding('99.0.1');
    const response = await app.request('/api/update/check?force=1', {
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      current: await serverVersion(),
      latest: '99.0.1',
      updateAvailable: true,
    });
  });

  test('starts the update for an authenticated session', async () => {
    // The test hook keeps triggerUpdate from spawning a real `bun x` download.
    process.env.HSW_UPDATE_SPAWN = '0';
    const { app, cookie } = await buildAuthedApp();
    const response = await app.request('/api/update', {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: 'updating' });
  });
});
