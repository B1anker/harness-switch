import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  GitHubDevicePollResponse,
  GitHubPushResponse,
  GitHubSyncStatus,
  TransferImportResponse,
} from '@seaveyon/harness-switch-shared';
import { createApp } from '../src/app';
import { createServices } from '../src/bootstrap';
import { IAuthService } from '../src/services/auth';
import { IEnvironmentService } from '../src/services/environment';

let homeDir = '';
const originalFetch = globalThis.fetch;

type TestApp = {
  app: ReturnType<typeof createApp>;
  cookie: string;
};

async function createTestApp(): Promise<TestApp> {
  homeDir = await mkdtemp(join(tmpdir(), 'hsw-github-test-'));
  process.env.HSW_HOME_DIR = homeDir;
  process.env.HSW_DATA_DIR = join(homeDir, '.harness-switch');

  const services = createServices();
  services.get(IEnvironmentService).ensureDataDir();
  const password = services.get(IAuthService).ensurePassword();
  const app = createApp(services);

  const res = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const cookie = res.headers.get('set-cookie') || '';

  return { app, cookie };
}

describe('GitHub Sync Service and Routes', () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  test('status reports not connected initially', async () => {
    const { app, cookie } = await createTestApp();
    const res = await app.request('/api/github/status', {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as GitHubSyncStatus;
    expect(body.connected).toBe(false);
  });

  test('device poll treats TLS/network failures as pending', async () => {
    const { app, cookie } = await createTestApp();

    globalThis.fetch = (async () => {
      const error = new TypeError('unknown certificate verification error') as TypeError & {
        code?: string;
      };
      error.code = 'UNKNOWN_CERTIFICATE_VERIFICATION_ERROR';
      throw error;
    }) as typeof fetch;

    const res = await app.request('/api/github/device/poll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ deviceCode: 'device_code_fake' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as GitHubDevicePollResponse;
    expect(body.status).toBe('pending');
  });

  test('device code request surfaces network failures as 502', async () => {
    const { app, cookie } = await createTestApp();

    globalThis.fetch = (async () => {
      throw new TypeError('unknown certificate verification error');
    }) as typeof fetch;

    const res = await app.request('/api/github/device/code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; code?: string };
    expect(body.error).toContain('无法连接 GitHub');
    expect(body.code).toBe('http.requestFailed');
  });

  test('authenticateWithToken connects and stores user info', async () => {
    const { app, cookie } = await createTestApp();

    globalThis.fetch = (async (input: string | URL | Request, _init?: RequestInit) => {
      const url = typeof input === 'string' ? input : 'url' in input ? input.url : String(input);
      if (url.includes('/user')) {
        return new Response(
          JSON.stringify({
            login: 'octocat',
            avatar_url: 'https://github.com/images/octocat.png',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/gists')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const authRes = await app.request('/api/github/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ token: 'ghp_fake_token_12345' }),
    });

    expect(authRes.status).toBe(200);
    const status = (await authRes.json()) as GitHubSyncStatus;
    expect(status.connected).toBe(true);
    expect(status.username).toBe('octocat');
    expect(status.avatarUrl).toBe('https://github.com/images/octocat.png');

    // Check status endpoint returns connected
    const statusRes = await app.request('/api/github/status', {
      headers: { cookie },
    });
    const checkStatus = (await statusRes.json()) as GitHubSyncStatus;
    expect(checkStatus.connected).toBe(true);
    expect(checkStatus.username).toBe('octocat');
  });

  test('push and pull roundtrip with encryption', async () => {
    const { app, cookie } = await createTestApp();

    let storedGist: any = null;

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : 'url' in input ? input.url : String(input);
      const method = init?.method || 'GET';

      if (url.includes('/user')) {
        return new Response(
          JSON.stringify({
            login: 'octocat',
            avatar_url: 'https://github.com/images/octocat.png',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/gists') && method === 'POST') {
        const body = JSON.parse(String(init?.body));
        storedGist = {
          id: 'gist_123',
          description: body.description,
          updated_at: '2026-08-28T12:00:00Z',
          files: body.files,
        };
        return new Response(JSON.stringify(storedGist), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/gists/gist_123') && method === 'PATCH') {
        const body = JSON.parse(String(init?.body));
        storedGist = {
          ...storedGist,
          updated_at: '2026-08-28T12:01:00Z',
          files: { ...storedGist.files, ...body.files },
        };
        return new Response(JSON.stringify(storedGist), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/gists/gist_123') && method === 'GET') {
        return new Response(JSON.stringify(storedGist), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/gists')) {
        return new Response(JSON.stringify(storedGist ? [storedGist] : []), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    // 1. Connect token
    await app.request('/api/github/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ token: 'ghp_fake_token_12345' }),
    });

    // 2. Create a profile locally
    await app.request('/api/harnesses/claude/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'my-custom-profile',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test-12345',
        model: 'claude-3-opus',
        notes: 'test note',
      }),
    });

    // 3. Push to GitHub Gist
    const pushRes = await app.request('/api/github/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ passphrase: 'my-secret-passphrase' }),
    });

    expect(pushRes.status).toBe(200);
    const pushBody = (await pushRes.json()) as GitHubPushResponse;
    expect(pushBody.ok).toBe(true);
    expect(pushBody.gistId).toBe('gist_123');
    expect(storedGist).not.toBeNull();
    expect(storedGist.files['harness-switch-backup.json']).toBeDefined();

    // Verify raw gist content is encrypted and contains no plaintext secret
    const rawContent = storedGist.files['harness-switch-backup.json'].content;
    expect(rawContent).not.toContain('sk-test-12345');
    expect(rawContent).toContain('harness-switch-encrypted-export');

    // 4. Delete the profile locally to simulate a fresh/different machine
    await app.request('/api/harnesses/claude/profiles/my-custom-profile', {
      method: 'DELETE',
      headers: { cookie },
    });

    // Verify it is gone
    const listRes = await app.request('/api/harnesses', { headers: { cookie } });
    const harnessesData = (await listRes.json()) as {
      items: Array<{ id: string; profiles: Array<{ name: string }> }>;
    };
    const claudeProfiles = harnessesData.items.find((h) => h.id === 'claude')?.profiles ?? [];
    expect(claudeProfiles.some((p) => p.name === 'my-custom-profile')).toBe(false);

    // 5. Pull preview from GitHub
    const previewRes = await app.request('/api/github/pull/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ passphrase: 'my-secret-passphrase' }),
    });

    expect(previewRes.status).toBe(200);
    const previewBody = (await previewRes.json()) as { preview: { profileCount: number } };
    expect(previewBody.preview.profileCount).toBeGreaterThanOrEqual(1);

    // 6. Pull and import
    const pullRes = await app.request('/api/github/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ passphrase: 'my-secret-passphrase', conflictPolicy: 'overwrite' }),
    });

    expect(pullRes.status).toBe(200);
    const pullBody = (await pullRes.json()) as TransferImportResponse;
    expect(pullBody.ok).toBe(true);
    expect(pullBody.imported).toBeGreaterThanOrEqual(1);

    // 7. Verify profile is restored
    const afterListRes = await app.request('/api/harnesses', { headers: { cookie } });
    const afterData = (await afterListRes.json()) as {
      items: Array<{ id: string; profiles: Array<{ name: string }> }>;
    };
    const afterClaudeProfiles = afterData.items.find((h) => h.id === 'claude')?.profiles ?? [];
    expect(afterClaudeProfiles.some((p) => p.name === 'my-custom-profile')).toBe(true);

    // 8. Test disconnect
    const discRes = await app.request('/api/github/disconnect', {
      method: 'POST',
      headers: { cookie },
    });
    expect(discRes.status).toBe(200);

    const afterDiscRes = await app.request('/api/github/status', { headers: { cookie } });
    const afterDiscBody = (await afterDiscRes.json()) as GitHubSyncStatus;
    expect(afterDiscBody.connected).toBe(false);
  });
});
