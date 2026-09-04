import { expect } from 'bun:test';
import type { Hono } from 'hono';
import { createApp } from '../../src/app';
import { createServices } from '../../src/bootstrap';
import type { InstantiationService } from '../../src/di';
import { IAuthService } from '../../src/services/auth';
import { IEnvironmentService } from '../../src/services/environment';

export type TestApp = {
  readonly app: Hono;
  readonly services: InstantiationService;
  /** The `Cookie` header value for an authenticated session. */
  readonly cookie: string;
  /** The generated first-run password, for tests that re-authenticate. */
  readonly password: string;
  request(path: string, init?: RequestInit): Promise<Response>;
  /** `request` plus a status assertion and a JSON parse, for the happy path. */
  json<T>(path: string, init?: RequestInit): Promise<T>;
  /** `post` plus the same status assertion and parse, for a command that returns a body. */
  postJson<T>(path: string, body?: unknown): Promise<T>;
  get(path: string): Promise<Response>;
  post(path: string, body?: unknown): Promise<Response>;
  patch(path: string, body?: unknown): Promise<Response>;
  del(path: string): Promise<Response>;
};

/**
 * The service graph over the current sandbox, with its data directory on disk.
 *
 * For suites that exercise services directly and never make an HTTP request. The
 * `ensureDataDir` is not optional — a service that writes before it exists fails on the
 * mkdir, so every caller was already pairing the two.
 */
export function createTestServices(): InstantiationService {
  const services = createServices();
  services.get(IEnvironmentService).ensureDataDir();
  return services;
}

export type TestAppOptions = {
  /**
   * A graph the caller built and adjusted first, for suites that have to stub a service
   * before any route can observe it. Defaults to a fresh graph over the sandbox.
   */
  services?: InstantiationService;
};

/**
 * Boots the service graph over the current sandbox and logs in.
 *
 * Nine suites each had their own `createTestApp`, identical down to the
 * `expect(login.status).toBe(200)`, and each grew its own `post`/`patch` wrapper for
 * remembering the cookie and the content type. Centralising it means a change to the
 * session contract is one edit, and a route test reads as the request it is making.
 */
export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const services = options.services ?? createServices();
  services.get(IEnvironmentService).ensureDataDir();
  const password = services.get(IAuthService).ensurePassword();
  const app = createApp(services);
  const login = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  expect(login.status).toBe(200);
  return authenticated(app, services, password, login.headers.get('set-cookie') ?? '');
}

/**
 * Rebuilds the service graph and app over the same data directory, as a process restart
 * would. Recovery tests depend on nothing in the old process carrying over.
 */
export function restartApp(): TestApp {
  const services = createServices();
  services.get(IEnvironmentService).ensureDataDir();
  const password = services.get(IAuthService).ensurePassword();
  return authenticated(createApp(services), services, password, '');
}

/** A second session against an already-booted app, for the multi-session user tests. */
export async function loginAgain(context: TestApp): Promise<string> {
  const response = await context.app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: context.password }),
  });
  expect(response.status).toBe(200);
  return response.headers.get('set-cookie') ?? '';
}

/** The same request surface bound to a different session cookie. */
export function asSession(context: TestApp, cookie: string): TestApp {
  return authenticated(context.app, context.services, context.password, cookie);
}

function authenticated(
  app: Hono,
  services: InstantiationService,
  password: string,
  cookie: string,
): TestApp {
  const request = (path: string, init: RequestInit = {}): Promise<Response> =>
    // `Hono.request` is typed as sync-or-async; every caller here awaits it either way.
    Promise.resolve(
      app.request(path, {
        ...init,
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
        },
      }),
    );
  const send = (method: string, path: string, body?: unknown): Promise<Response> =>
    request(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

  return {
    app,
    services,
    cookie,
    password,
    request,
    async json<T>(path: string, init: RequestInit = {}): Promise<T> {
      const response = await request(path, init);
      expect(response.status).toBeLessThan(400);
      return (await response.json()) as T;
    },
    async postJson<T>(path: string, body?: unknown): Promise<T> {
      const response = await send('POST', path, body);
      expect(response.status).toBeLessThan(400);
      return (await response.json()) as T;
    },
    get: (path) => request(path),
    post: (path, body) => send('POST', path, body),
    patch: (path, body) => send('PATCH', path, body),
    del: (path) => send('DELETE', path),
  };
}
