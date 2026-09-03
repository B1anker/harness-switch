import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProbeResult } from '@seaveyon/harness-switch-shared';
import { PROBE_CODES } from '@seaveyon/harness-switch-shared';
import { createApp } from '../src/app';
import { createServices } from '../src/bootstrap';
import { IAuthService } from '../src/services/auth';
import { IEnvironmentService } from '../src/services/environment';
import { extractModels, ProbeService } from '../src/services/probe';

/**
 * A local relay that speaks enough of the model-catalog contract to exercise every
 * probe path. Each route emulates one real-world shape or failure mode; the auth
 * header is checked so a credential sent on the wrong convention still passes.
 */
function startRelay(): { stop(): void; port: number; calls: URL[] } {
  const calls: URL[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      calls.push(url);
      if (request.headers.get('authorization') !== 'Bearer sk-test') {
        return Response.json({ error: 'bad credential' }, { status: 401 });
      }
      if (url.pathname === '/v1/models') {
        return Response.json({
          data: [{ id: 'gpt-test-a' }, { id: 'gpt-test-b' }, { id: 'gpt-test-a' }],
        });
      }
      return Response.json({ error: 'no catalog here' }, { status: 404 });
    },
  });
  return { stop: () => server.stop(true), port: server.port!, calls };
}

/** A relay whose catalog path answers 200 with HTML instead of JSON. */
function startHtmlRelay(): { stop(): void; port: number } {
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === '/v1/models') {
        return new Response('<html>not json</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      return new Response(null, { status: 404 });
    },
  });
  return { stop: () => server.stop(true), port: server.port! };
}

/** A second relay that only serves the Anthropic-style bare path. */
function startAnthropicOnly(): { stop(): void; port: number } {
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (request.headers.get('authorization') !== 'Bearer sk-test') {
        return Response.json({ error: 'nope' }, { status: 401 });
      }
      if (url.pathname === '/models') {
        return Response.json({ data: [{ id: 'claude-test-x' }] });
      }
      return new Response(null, { status: 404 });
    },
  });
  return { stop: () => server.stop(true), port: server.port! };
}

describe('probe service', () => {
  // Dependency-free by design, so tests build it directly.
  const probe = new ProbeService();

  test('rejects a missing base URL and key before any request', async () => {
    const noUrl = await probe.probe({ baseUrl: '', apiKey: 'sk' });
    expect(noUrl.ok).toBe(false);
    expect(noUrl.code).toBe(PROBE_CODES.missingBaseUrl);

    const noKey = await probe.probe({ baseUrl: 'https://api.example.com', apiKey: '' });
    expect(noKey.ok).toBe(false);
    expect(noKey.code).toBe(PROBE_CODES.missingApiKey);
  });

  test('rejects unparseable URLs and non-http schemes', async () => {
    const garbage = await probe.probe({ baseUrl: '::not a url', apiKey: 'sk' });
    expect(garbage.code).toBe(PROBE_CODES.badUrl);

    const ftp = await probe.probe({ baseUrl: 'ftp://files.example.com', apiKey: 'sk' });
    expect(ftp.code).toBe(PROBE_CODES.badUrl);
  });

  test('reads an OpenAI-shaped catalog at /v1/models and dedupes ids', async () => {
    const relay = startRelay();
    try {
      const result = await probe.probe({
        baseUrl: `http://127.0.0.1:${relay.port}`,
        apiKey: 'sk-test',
      });
      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      expect(result.models).toEqual(['gpt-test-a', 'gpt-test-b']);
      expect(result.requestUrl).toBe(`http://127.0.0.1:${relay.port}/v1/models`);
      expect(typeof result.latencyMs).toBe('number');
    } finally {
      relay.stop();
    }
  });

  test('a base URL already ending in /v1 skips the doubled prefix', async () => {
    const relay = startRelay();
    try {
      const result = await probe.probe({
        baseUrl: `http://127.0.0.1:${relay.port}/v1`,
        apiKey: 'sk-test',
      });
      expect(result.ok).toBe(true);
      expect(result.requestUrl).toBe(`http://127.0.0.1:${relay.port}/v1/models`);
      expect(relay.calls.every((call) => !call.pathname.endsWith('/v1/v1/models'))).toBe(true);
    } finally {
      relay.stop();
    }
  });

  test('falls back to the bare /models path when /v1/models is 404', async () => {
    const anthropicStyle = startAnthropicOnly();
    try {
      const result = await probe.probe({
        baseUrl: `http://127.0.0.1:${anthropicStyle.port}`,
        apiKey: 'sk-test',
      });
      expect(result.ok).toBe(true);
      expect(result.models).toEqual(['claude-test-x']);
      expect(result.requestUrl).toBe(`http://127.0.0.1:${anthropicStyle.port}/models`);
    } finally {
      anthropicStyle.stop();
    }
  });

  test('a rejected credential reports unauthorized without trying other shapes', async () => {
    const relay = startRelay();
    try {
      const result = await probe.probe({
        baseUrl: `http://127.0.0.1:${relay.port}`,
        apiKey: 'sk-wrong',
      });
      expect(result.ok).toBe(false);
      expect(result.code).toBe(PROBE_CODES.unauthorized);
      expect(result.params?.status).toBe(401);
    } finally {
      relay.stop();
    }
  });

  test('an HTML 200 response is an invalidResponse, not a success', async () => {
    const htmlRelay = startHtmlRelay();
    try {
      const result = await probe.probe({
        baseUrl: `http://127.0.0.1:${htmlRelay.port}`,
        apiKey: 'sk-test',
      });
      expect(result.ok).toBe(false);
      expect(result.code).toBe(PROBE_CODES.invalidResponse);
    } finally {
      htmlRelay.stop();
    }
  });

  test('rejects an oversized catalog from Content-Length before reading it', async () => {
    const oversized = new Response(JSON.stringify({ data: [{ id: 'too-large' }] }), {
      headers: { 'content-length': String(4 * 1024 * 1024 + 1) },
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => oversized) as unknown as typeof fetch;
    try {
      const result = await probe.probe({ baseUrl: 'https://api.example.com/v1', apiKey: 'sk' });
      expect(result.ok).toBe(false);
      expect(result.code).toBe(PROBE_CODES.invalidResponse);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('a refused connection reports networkError with latency recorded', async () => {
    // Stop the relay before probing it: nothing listens on the freed port anymore.
    const relay = startRelay();
    const port = relay.port;
    relay.stop();
    const result = await probe.probe({
      baseUrl: `http://127.0.0.1:${port}`,
      apiKey: 'sk-test',
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(PROBE_CODES.networkError);
    expect(typeof result.latencyMs).toBe('number');
  });

  test('extractModels handles every known catalog shape', () => {
    expect(extractModels(JSON.stringify(['m-1', 'm-2']))).toEqual(['m-1', 'm-2']);
    expect(extractModels(JSON.stringify({ models: [{ name: 'n-1' }] }))).toEqual(['n-1']);
    expect(extractModels(JSON.stringify({ data: [{ model: 'x-1' }] }))).toEqual(['x-1']);
    expect(extractModels(JSON.stringify({ data: [] }))).toEqual([]);
    expect(extractModels('not json')).toBeNull();
    expect(extractModels(JSON.stringify({ unrelated: true }))).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* HTTP surface                                                        */
/* ------------------------------------------------------------------ */

describe('probe api', () => {
  let homeDir = '';
  let relay: ReturnType<typeof startRelay> | undefined;

  type TestApp = {
    app: ReturnType<typeof createApp>;
    cookie: string;
  };

  async function createTestApp(): Promise<TestApp> {
    homeDir = await mkdtemp(join(tmpdir(), 'hsw-probe-'));
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
    return { app, cookie: login.headers.get('set-cookie') ?? '' };
  }

  afterEach(async () => {
    delete process.env.HSW_HOME_DIR;
    delete process.env.HSW_DATA_DIR;
    delete process.env.CODEX_HOME;
    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
    }
    relay?.stop();
    relay = undefined;
  });

  test('requires authentication', async () => {
    const { app } = await createTestApp();
    expect((await app.request('/api/probe', { method: 'POST' })).status).toBe(401);
    expect((await app.request('/api/providers/p/probe', { method: 'POST' })).status).toBe(401);
    expect(
      (await app.request('/api/harnesses/claude/profiles/x/probe', { method: 'POST' })).status,
    ).toBe(401);
  });

  test('draft probe resolves inline keys and never echoes them', async () => {
    const { app, cookie } = await createTestApp();
    relay = startRelay();
    const response = await app.request('/api/probe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'Accept-Language': 'en-US',
      },
      body: JSON.stringify({
        baseUrl: `http://127.0.0.1:${relay.port}`,
        apiKey: 'sk-test',
      }),
    });
    expect(response.status).toBe(200);
    const raw = await response.text();
    const body = JSON.parse(raw) as { result: ProbeResult };
    expect(body.result.ok).toBe(true);
    // The credential stays server-side: neither echoed nor reflected in any field.
    expect(raw).not.toContain('sk-test');
  });

  test('draft probe reports a missing credential as a structured failure', async () => {
    const { app, cookie } = await createTestApp();
    relay = startRelay();
    const response = await app.request('/api/probe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'Accept-Language': 'en-US',
      },
      body: JSON.stringify({ baseUrl: `http://127.0.0.1:${relay.port}` }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: ProbeResult };
    expect(body.result.ok).toBe(false);
    expect(body.result.code).toBe(PROBE_CODES.missingApiKey);
    expect(body.result.msg).toBe('No API key supplied; nothing to test');
    expect(body.result.data).toBeUndefined();
  });

  test('vault probe tests the stored credential against its endpoint', async () => {
    const { app, cookie } = await createTestApp();
    relay = startRelay();
    const created = await app.request('/api/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        name: 'acme',
        apiKey: 'sk-test',
        endpoints: [{ key: 'default', baseUrl: `http://127.0.0.1:${relay.port}` }],
      }),
    });
    expect(created.status).toBe(201);
    const { provider } = (await created.json()) as { provider: { id: string } };

    const response = await app.request(`/api/providers/${provider.id}/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: ProbeResult };
    expect(body.result.ok).toBe(true);
    expect(body.result.models?.length).toBeGreaterThan(0);
  });

  test('saved-profile probe uses stored credentials end to end', async () => {
    const { app, cookie } = await createTestApp();
    relay = startRelay();
    const created = await app.request('/api/harnesses/claude/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        name: 'local-relay',
        baseUrl: `http://127.0.0.1:${relay.port}`,
        apiKey: 'sk-test',
      }),
    });
    expect(created.status).toBe(201);

    const response = await app.request('/api/harnesses/claude/profiles/local-relay/probe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: ProbeResult };
    expect(body.result.ok).toBe(true);
    expect(body.result.models).toContain('gpt-test-a');

    // Unknown profiles stay a plain 404.
    const missing = await app.request('/api/harnesses/claude/profiles/none/probe', {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(missing.status).toBe(404);
  });
});
