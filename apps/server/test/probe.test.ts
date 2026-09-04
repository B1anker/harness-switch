import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProbeResult } from '@seaveyon/harness-switch-shared';
import { PROBE_CODES } from '@seaveyon/harness-switch-shared';
import { HttpClient } from '../src/services/http-client';
import { extractCompletionText, extractModels, ProbeService } from '../src/services/probe';
import { createSandbox, createTestApp, type Sandbox, stubFetch, type TestApp } from './support';

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

type CompletionRelay = {
  stop(): void;
  port: number;
  /** Every completion request received, so a test can assert on protocol and body. */
  completions: { path: string; body: Record<string, unknown> }[];
};

/**
 * The failure this whole feature exists to catch: a relay whose catalog is perfect and
 * whose models do not answer. `answer` decides what the completion endpoints reply with,
 * so one helper covers both the healthy and the 5xx case.
 */
function startCompletionRelay(answer: (path: string) => Response): CompletionRelay {
  const completions: { path: string; body: Record<string, unknown> }[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (request.headers.get('authorization') !== 'Bearer sk-test') {
        return Response.json({ error: 'bad credential' }, { status: 401 });
      }
      if (url.pathname === '/v1/models') {
        return Response.json({ data: [{ id: 'relay-model' }, { id: 'relay-other' }] });
      }
      if (request.method === 'POST') {
        completions.push({
          path: url.pathname,
          body: (await request.json()) as Record<string, unknown>,
        });
        return answer(url.pathname);
      }
      return Response.json({ error: 'no catalog here' }, { status: 404 });
    },
  });
  return { stop: () => server.stop(true), port: server.port!, completions };
}

/** A draft probe in English, so the asserted prose is the untranslated message. */
function draftProbe(context: TestApp, body: unknown): Promise<Response> {
  return context.request('/api/probe', {
    method: 'POST',
    headers: { 'Accept-Language': 'en-US' },
    body: JSON.stringify(body),
  });
}

/** An OpenAI chat envelope carrying one token of assistant text. */
function chatReply(): Response {
  return Response.json({
    choices: [{ message: { role: 'assistant', content: 'hi' } }],
  });
}

describe('probe service', () => {
  // Dependency-free by design, so tests build it directly.
  const probe = new ProbeService(new HttpClient());

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
      expect(result.data?.status).toBe(401);
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
    const restore = stubFetch(() => oversized);
    try {
      const result = await probe.probe({ baseUrl: 'https://api.example.com/v1', apiKey: 'sk' });
      expect(result.ok).toBe(false);
      expect(result.code).toBe(PROBE_CODES.invalidResponse);
    } finally {
      restore();
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
/* Completion probe                                                    */
/* ------------------------------------------------------------------ */

describe('completion probe', () => {
  const probe = new ProbeService(new HttpClient());

  test('no completion is sent unless it was asked for', async () => {
    const relay = startCompletionRelay(chatReply);
    try {
      const result = await probe.probe({
        baseUrl: `http://127.0.0.1:${relay.port}`,
        apiKey: 'sk-test',
      });
      expect(result.ok).toBe(true);
      expect(result.completion).toBeUndefined();
      // The point of the flag: an unasked-for probe never bills a token.
      expect(relay.completions).toEqual([]);
    } finally {
      relay.stop();
    }
  });

  test('a catalog that lists a model the model cannot serve reports both verdicts', async () => {
    // The exact shape of the bug this test exists for: /v1/models is perfect, the model 500s.
    const relay = startCompletionRelay(() =>
      Response.json({ error: 'upstream exploded' }, { status: 500 }),
    );
    try {
      const result = await probe.probe({
        baseUrl: `http://127.0.0.1:${relay.port}`,
        apiKey: 'sk-test',
        completion: true,
        model: 'relay-model',
        protocol: 'openai-chat',
      });
      // The catalog read still succeeded, and says so: the two verdicts stay separate.
      expect(result.ok).toBe(true);
      expect(result.models).toEqual(['relay-model', 'relay-other']);
      expect(result.completion?.ok).toBe(false);
      expect(result.completion?.code).toBe(PROBE_CODES.completionHttpError);
      expect(result.completion?.status).toBe(500);
      // The model name is the detail that makes the failure actionable.
      expect(result.completion?.data?.model).toBe('relay-model');
      expect(result.completion?.model).toBe('relay-model');
      expect(result.completion?.protocol).toBe('openai-chat');
    } finally {
      relay.stop();
    }
  });

  test('a working model reports the completion as its own success', async () => {
    const relay = startCompletionRelay(chatReply);
    try {
      const result = await probe.probe({
        baseUrl: `http://127.0.0.1:${relay.port}`,
        apiKey: 'sk-test',
        completion: true,
        model: 'relay-model',
        protocol: 'openai-chat',
      });
      expect(result.ok).toBe(true);
      expect(result.completion?.ok).toBe(true);
      expect(result.completion?.produced).toBe(true);
      expect(typeof result.completion?.latencyMs).toBe('number');
      expect(relay.completions).toHaveLength(1);
      expect(relay.completions[0]?.path).toBe('/v1/chat/completions');
      // Minimal by construction: one token of budget, no streaming to drain.
      expect(relay.completions[0]?.body).toMatchObject({ model: 'relay-model', max_tokens: 1 });
    } finally {
      relay.stop();
    }
  });

  test('falls back to the profile-less model when the caller names none', async () => {
    const relay = startCompletionRelay(chatReply);
    try {
      const result = await probe.probe({
        baseUrl: `http://127.0.0.1:${relay.port}`,
        apiKey: 'sk-test',
        completion: true,
        protocol: 'openai-chat',
      });
      // With no model named, the catalog's first id is the only sensible subject.
      expect(result.completion?.model).toBe('relay-model');
    } finally {
      relay.stop();
    }
  });

  test('only a 404 advances to the next protocol', async () => {
    // Anthropic-style: the two OpenAI paths do not exist, /v1/messages does.
    const relay = startCompletionRelay((path) =>
      path === '/v1/messages'
        ? Response.json({ content: [{ type: 'text', text: 'hi' }] })
        : Response.json({ error: 'not found' }, { status: 404 }),
    );
    try {
      const result = await probe.probe({
        baseUrl: `http://127.0.0.1:${relay.port}`,
        apiKey: 'sk-test',
        completion: true,
        model: 'relay-model',
      });
      expect(result.completion?.ok).toBe(true);
      expect(result.completion?.protocol).toBe('anthropic-messages');
      expect(relay.completions.map((call) => call.path)).toEqual([
        '/v1/chat/completions',
        '/v1/responses',
        '/v1/messages',
      ]);
    } finally {
      relay.stop();
    }
  });

  test('a 500 ends the attempt instead of blaming the next protocol', async () => {
    const relay = startCompletionRelay(() => new Response(null, { status: 502 }));
    try {
      const result = await probe.probe({
        baseUrl: `http://127.0.0.1:${relay.port}`,
        apiKey: 'sk-test',
        completion: true,
        model: 'relay-model',
      });
      expect(result.completion?.status).toBe(502);
      // One attempt only: a real endpoint verdict is not a reason to keep guessing.
      expect(relay.completions).toHaveLength(1);
    } finally {
      relay.stop();
    }
  });

  test('the caller-named protocol goes first without dropping the fallbacks', async () => {
    const relay = startCompletionRelay((path) =>
      path === '/v1/messages'
        ? Response.json({ content: [{ type: 'text', text: 'hi' }] })
        : Response.json({ error: 'not found' }, { status: 404 }),
    );
    try {
      await probe.probe({
        baseUrl: `http://127.0.0.1:${relay.port}`,
        apiKey: 'sk-test',
        completion: true,
        model: 'relay-model',
        protocol: 'anthropic-messages',
      });
      // The harness's own protocol answered first, so nothing else was tried.
      expect(relay.completions.map((call) => call.path)).toEqual(['/v1/messages']);
    } finally {
      relay.stop();
    }
  });

  test('a 200 carrying a relay error object is not a working model', async () => {
    const relay = startCompletionRelay(() =>
      Response.json({ error: { message: 'no such model' } }, { status: 200 }),
    );
    try {
      const result = await probe.probe({
        baseUrl: `http://127.0.0.1:${relay.port}`,
        apiKey: 'sk-test',
        completion: true,
        model: 'relay-model',
        protocol: 'openai-chat',
      });
      expect(result.completion?.ok).toBe(false);
      expect(result.completion?.code).toBe(PROBE_CODES.completionInvalid);
    } finally {
      relay.stop();
    }
  });

  test('the completion still runs when the catalog fails, given a named model', async () => {
    // Relays that serve no catalog at all yet complete fine are common; reporting only
    // "no model catalog" would hide that the endpoint works.
    const relay = startCompletionRelay(chatReply);
    const port = relay.port;
    try {
      const result = await probe.probe({
        // A path with no catalog under it: /nope/v1/models and /nope/models both 404.
        baseUrl: `http://127.0.0.1:${port}/nope`,
        apiKey: 'sk-test',
        completion: true,
        model: 'relay-model',
        protocol: 'openai-chat',
      });
      expect(result.ok).toBe(false);
      expect(result.completion?.ok).toBe(true);
    } finally {
      relay.stop();
    }
  });

  test('a catalog failure with no model to fall back on says so', async () => {
    const relay = startCompletionRelay(chatReply);
    const port = relay.port;
    try {
      const result = await probe.probe({
        baseUrl: `http://127.0.0.1:${port}/nope`,
        apiKey: 'sk-test',
        completion: true,
      });
      expect(result.ok).toBe(false);
      expect(result.completion?.ok).toBe(false);
      expect(result.completion?.code).toBe(PROBE_CODES.missingModel);
    } finally {
      relay.stop();
    }
  });

  test('the Responses protocol asks for the smallest budget that API accepts', async () => {
    const relay = startCompletionRelay((path) =>
      path === '/v1/responses'
        ? Response.json({ output_text: 'hi' })
        : Response.json({ error: 'not found' }, { status: 404 }),
    );
    try {
      const result = await probe.probe({
        baseUrl: `http://127.0.0.1:${relay.port}`,
        apiKey: 'sk-test',
        completion: true,
        model: 'relay-model',
        protocol: 'openai-responses',
      });
      expect(result.completion?.ok).toBe(true);
      // 16 rather than 1: the Responses API rejects anything lower.
      expect(relay.completions[0]?.body).toMatchObject({ max_output_tokens: 16 });
    } finally {
      relay.stop();
    }
  });

  test('an empty answer still proves the model ran', () => {
    // With max_tokens: 1 the whole budget can go to a stop token. A well-formed envelope
    // carrying no text is a success; only an unrecognised shape is a failure.
    expect(extractCompletionText(JSON.stringify({ choices: [{ message: { content: '' } }] }))).toBe(
      '',
    );
    expect(extractCompletionText(JSON.stringify({ content: [] }))).toBe('');
  });

  test('extractCompletionText handles every known completion envelope', () => {
    expect(
      extractCompletionText(JSON.stringify({ choices: [{ message: { content: 'hello' } }] })),
    ).toBe('hello');
    expect(extractCompletionText(JSON.stringify({ choices: [{ text: 'legacy' }] }))).toBe('legacy');
    expect(
      extractCompletionText(JSON.stringify({ choices: [{ delta: { content: 'chunk' } }] })),
    ).toBe('chunk');
    expect(
      extractCompletionText(JSON.stringify({ content: [{ type: 'text', text: 'anthropic' }] })),
    ).toBe('anthropic');
    expect(
      extractCompletionText(
        JSON.stringify({ output: [{ content: [{ type: 'output_text', text: 'responses' }] }] }),
      ),
    ).toBe('responses');
    expect(extractCompletionText(JSON.stringify({ output_text: 'convenience' }))).toBe(
      'convenience',
    );

    // Not completions at all: an HTML error page, a bare value, an unknown envelope.
    expect(extractCompletionText('<html>error</html>')).toBeNull();
    expect(extractCompletionText(JSON.stringify('just a string'))).toBeNull();
    expect(extractCompletionText(JSON.stringify({ unrelated: true }))).toBeNull();
    // A relay reporting failure with a 200 status.
    expect(extractCompletionText(JSON.stringify({ error: { message: 'nope' } }))).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* HTTP surface                                                        */
/* ------------------------------------------------------------------ */

describe('probe api', () => {
  let sandbox: Sandbox;
  let relay: ReturnType<typeof startRelay> | undefined;

  beforeEach(() => {
    sandbox = createSandbox('hsw-probe', { env: (home) => ({ CODEX_HOME: home('.codex') }) });
  });

  afterEach(() => {
    relay?.stop();
    relay = undefined;
    sandbox.dispose();
  });

  /** The relay's catalog URL, started on demand so each test owns its own port. */
  function relayUrl(): string {
    relay = startRelay();
    return `http://127.0.0.1:${relay.port}`;
  }

  test('requires authentication', async () => {
    const { app } = await createTestApp();
    expect((await app.request('/api/probe', { method: 'POST' })).status).toBe(401);
    expect((await app.request('/api/providers/p/probe', { method: 'POST' })).status).toBe(401);
    expect(
      (await app.request('/api/harnesses/claude/profiles/x/probe', { method: 'POST' })).status,
    ).toBe(401);
  });

  test('draft probe resolves inline keys and never echoes them', async () => {
    const context = await createTestApp();
    const response = await draftProbe(context, { baseUrl: relayUrl(), apiKey: 'sk-test' });
    expect(response.status).toBe(200);
    const raw = await response.text();
    const body = JSON.parse(raw) as { result: ProbeResult };
    expect(body.result.ok).toBe(true);
    // The credential stays server-side: neither echoed nor reflected in any field.
    expect(raw).not.toContain('sk-test');
  });

  test('draft probe reports a missing credential as a structured failure', async () => {
    const context = await createTestApp();
    const response = await draftProbe(context, { baseUrl: relayUrl() });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: ProbeResult };
    expect(body.result.ok).toBe(false);
    expect(body.result.code).toBe(PROBE_CODES.missingApiKey);
    expect(body.result.msg).toBe('No API key supplied; nothing to test');
    expect(body.result.data).toBeUndefined();
  });

  test('vault probe tests the stored credential against its endpoint', async () => {
    const context = await createTestApp();
    const created = await context.post('/api/providers', {
      name: 'acme',
      apiKey: 'sk-test',
      endpoints: [{ key: 'default', baseUrl: relayUrl() }],
    });
    expect(created.status).toBe(201);
    const { provider } = (await created.json()) as { provider: { id: string } };

    const body = await context.postJson<{ result: ProbeResult }>(
      `/api/providers/${provider.id}/probe`,
      {},
    );
    expect(body.result.ok).toBe(true);
    expect(body.result.models?.length).toBeGreaterThan(0);
  });

  test('saved-profile probe uses stored credentials end to end', async () => {
    const context = await createTestApp();
    const created = await context.post('/api/harnesses/claude/profiles', {
      name: 'local-relay',
      baseUrl: relayUrl(),
      apiKey: 'sk-test',
    });
    expect(created.status).toBe(201);

    const body = await context.postJson<{ result: ProbeResult }>(
      '/api/harnesses/claude/profiles/local-relay/probe',
      {},
    );
    expect(body.result.ok).toBe(true);
    expect(body.result.models).toContain('gpt-test-a');

    // Unknown profiles stay a plain 404.
    const missing = await context.post('/api/harnesses/claude/profiles/none/probe');
    expect(missing.status).toBe(404);
  });
});
