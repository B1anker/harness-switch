import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type {
  GitHubDevicePollResponse,
  GitHubPushResponse,
  GitHubSyncStatus,
  TransferImportResponse,
} from '@seaveyon/harness-switch-shared';
import { createSandbox, createTestApp, type Sandbox } from './support';

let sandbox: Sandbox;

type HarnessList = { items: Array<{ id: string; profiles: Array<{ name: string }> }> };

function claudeProfileNames(list: HarnessList): string[] {
  return (list.items.find((item) => item.id === 'claude')?.profiles ?? []).map(
    (profile) => profile.name,
  );
}

beforeEach(() => {
  sandbox = createSandbox('hsw-github-test');
});

afterEach(() => {
  sandbox.dispose();
});

describe('GitHub Sync Service and Routes', () => {
  test('status reports not connected initially', async () => {
    const context = await createTestApp();
    const body = await context.json<GitHubSyncStatus>('/api/github/status');
    expect(body.connected).toBe(false);
  });

  test('device poll treats TLS/network failures as pending', async () => {
    const context = await createTestApp();
    sandbox.stubFetch(() => {
      const error = new TypeError('unknown certificate verification error') as TypeError & {
        code?: string;
      };
      error.code = 'UNKNOWN_CERTIFICATE_VERIFICATION_ERROR';
      throw error;
    });

    const res = await context.post('/api/github/device/poll', { deviceCode: 'device_code_fake' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as GitHubDevicePollResponse;
    expect(body.status).toBe('pending');
  });

  test('device code request surfaces network failures as 502', async () => {
    const context = await createTestApp();
    sandbox.stubFetch(() => {
      throw new TypeError('unknown certificate verification error');
    });

    const res = await context.post('/api/github/device/code', {});
    expect(res.status).toBe(502);
    const body = (await res.json()) as { msg: string; code?: string };
    expect(body.msg).toContain('请求失败');
    expect(body.code).toBe('http.requestFailed');
  });

  test('authenticateWithToken connects and stores user info', async () => {
    const context = await createTestApp();
    sandbox.stubFetch((url) => {
      if (url.includes('/user')) {
        return Response.json({
          login: 'octocat',
          avatar_url: 'https://github.com/images/octocat.png',
        });
      }
      if (url.includes('/gists')) {
        return Response.json([]);
      }
      return new Response('Not found', { status: 404 });
    });

    const authRes = await context.post('/api/github/token', { token: 'ghp_fake_token_12345' });
    expect(authRes.status).toBe(200);
    const status = (await authRes.json()) as GitHubSyncStatus;
    expect(status.connected).toBe(true);
    expect(status.username).toBe('octocat');
    expect(status.avatarUrl).toBe('https://github.com/images/octocat.png');

    const checkStatus = await context.json<GitHubSyncStatus>('/api/github/status');
    expect(checkStatus.connected).toBe(true);
    expect(checkStatus.username).toBe('octocat');
  });

  test('push and pull roundtrip with encryption', async () => {
    const context = await createTestApp();

    /** The gist as GitHub would hold it, so a pull reads back what the push wrote. */
    let storedGist: {
      id: string;
      description?: string;
      updated_at: string;
      files: Record<string, { content: string }>;
    } | null = null;

    sandbox.stubFetch((url, init) => {
      const method = init?.method || 'GET';
      if (url.includes('/user')) {
        return Response.json({
          login: 'octocat',
          avatar_url: 'https://github.com/images/octocat.png',
        });
      }
      if (url.endsWith('/gists') && method === 'POST') {
        const body = JSON.parse(String(init?.body));
        storedGist = {
          id: 'gist_123',
          description: body.description,
          updated_at: '2026-08-28T12:00:00Z',
          files: body.files,
        };
        return Response.json(storedGist, { status: 201 });
      }
      if (url.includes('/gists/gist_123') && method === 'PATCH') {
        const body = JSON.parse(String(init?.body));
        storedGist = {
          ...storedGist!,
          updated_at: '2026-08-28T12:01:00Z',
          files: { ...storedGist!.files, ...body.files },
        };
        return Response.json(storedGist);
      }
      if (url.includes('/gists/gist_123') && method === 'GET') {
        return Response.json(storedGist);
      }
      if (url.includes('/gists')) {
        return Response.json(storedGist ? [storedGist] : []);
      }
      return new Response('Not found', { status: 404 });
    });

    await context.post('/api/github/token', { token: 'ghp_fake_token_12345' });
    await context.post('/api/harnesses/claude/profiles', {
      name: 'my-custom-profile',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test-12345',
      model: 'claude-3-opus',
      notes: 'test note',
    });

    const pushRes = await context.post('/api/github/push', { passphrase: 'my-secret-passphrase' });
    expect(pushRes.status).toBe(200);
    const pushBody = (await pushRes.json()) as GitHubPushResponse;
    expect(pushBody.ok).toBe(true);
    expect(pushBody.gistId).toBe('gist_123');
    expect(storedGist).not.toBeNull();
    const uploaded = storedGist!.files['harness-switch-backup.json'];
    expect(uploaded).toBeDefined();

    // The gist is public infrastructure: the plaintext key must never reach it.
    expect(uploaded?.content).not.toContain('sk-test-12345');
    expect(uploaded?.content).toContain('harness-switch-encrypted-export');

    // Deleting locally stands in for pulling onto a fresh machine.
    await context.del('/api/harnesses/claude/profiles/my-custom-profile');
    expect(claudeProfileNames(await context.json<HarnessList>('/api/harnesses'))).not.toContain(
      'my-custom-profile',
    );

    const previewRes = await context.post('/api/github/pull/preview', {
      passphrase: 'my-secret-passphrase',
    });
    expect(previewRes.status).toBe(200);
    const previewBody = (await previewRes.json()) as { preview: { profileCount: number } };
    expect(previewBody.preview.profileCount).toBeGreaterThanOrEqual(1);

    const pullRes = await context.post('/api/github/pull', {
      passphrase: 'my-secret-passphrase',
      conflictPolicy: 'overwrite',
    });
    expect(pullRes.status).toBe(200);
    const pullBody = (await pullRes.json()) as TransferImportResponse;
    expect(pullBody.ok).toBe(true);
    expect(pullBody.imported).toBeGreaterThanOrEqual(1);
    expect(claudeProfileNames(await context.json<HarnessList>('/api/harnesses'))).toContain(
      'my-custom-profile',
    );

    expect((await context.post('/api/github/disconnect')).status).toBe(200);
    expect((await context.json<GitHubSyncStatus>('/api/github/status')).connected).toBe(false);
  });
});
