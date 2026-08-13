import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app';
import { createServices } from '../src/bootstrap';
import { IAuthService } from '../src/services/auth';
import { IEnvironmentService } from '../src/services/environment';

let homeDir = '';

async function createTestApp() {
  homeDir = await mkdtemp(join(tmpdir(), 'hsw-home-'));
  process.env.HSW_HOME_DIR = homeDir;
  process.env.HSW_DATA_DIR = join(homeDir, '.harness-switch');
  const services = createServices();
  services.get(IEnvironmentService).ensureDataDir();
  const password = services.get(IAuthService).ensurePassword();
  return { app: createApp(services), password, dataDir: process.env.HSW_DATA_DIR };
}

async function login(app: ReturnType<typeof createApp>, password: string) {
  const response = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  expect(response.status).toBe(200);
  return response.headers.get('set-cookie') ?? '';
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
  });

  test('creates, lists, activates and deletes a profile', async () => {
    const { app, password, dataDir } = await createTestApp();
    const cookie = await login(app, password);

    const created = await app.request('/api/harnesses/claude/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        name: 'openrouter-main',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-test',
        model: 'claude-sonnet-4-5',
        notes: 'demo',
      }),
    });
    expect(created.status).toBe(201);

    const list = await app.request('/api/harnesses', {
      headers: { Cookie: cookie },
    });
    const body = (await list.json()) as {
      items: Array<{ id: string; profiles: Array<{ name: string; baseUrl: string }> }>;
    };
    const claude = body.items.find((item) => item.id === 'claude');
    expect(claude?.profiles[0]?.name).toBe('openrouter-main');
    expect(claude?.profiles[0]?.baseUrl).toBe('https://api.example.com/v1');

    const activated = await app.request('/api/harnesses/claude/profiles/openrouter-main/activate', {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(activated.status).toBe(200);
    const env = await readFile(join(dataDir, 'env.sh'), 'utf8');
    expect(env).toContain("export ANTHROPIC_API_KEY='sk-test'");
    const settings = await readFile(join(homeDir, '.claude', 'settings.json'), 'utf8');
    expect(settings).toContain('sk-test');

    const deleted = await app.request('/api/harnesses/claude/profiles/openrouter-main', {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(deleted.status).toBe(200);
  });
});
