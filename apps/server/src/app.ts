import { existsSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import type { ErrorResponse } from '@seaveyon/harness-switch-shared';
import { ERROR_CODES } from '@seaveyon/harness-switch-shared';
import { Hono } from 'hono';
import { HttpError } from './common/errors';
import { localizeError, localizeMessage, requestLanguage } from './common/localize';
import type { InstantiationService } from './di';
import { createAuthGuard, createOriginGuard, createServiceMiddleware } from './http/middleware';
import { createAuthRoutes } from './http/routes/auth';
import { createBackupRoutes } from './http/routes/backups';
import { createDoctorRoutes } from './http/routes/doctor';
import { createDriftRoutes } from './http/routes/drift';
import { createGitHubRoutes } from './http/routes/github';
import { createHarnessRoutes } from './http/routes/harnesses';
import { createOperationRoutes } from './http/routes/operations';
import { createProbeRoutes } from './http/routes/probe';
import { createProviderRoutes } from './http/routes/providers';
import { createScanRoutes } from './http/routes/scan';
import { createTransferRoutes } from './http/routes/transfer';
import { createUpdateRoutes } from './http/routes/update';
import { createUserRoutes } from './http/routes/users';
import { IEnvironmentService } from './services/environment';
import { ILogService } from './services/log';
import { serverVersion } from './version';

export function createApp(services: InstantiationService): Hono {
  const app = new Hono();
  const environment = services.get(IEnvironmentService);
  const log = services.get(ILogService);

  app.use('*', createServiceMiddleware(services));

  app.get('/healthz', (c) =>
    c.json({
      ok: true,
      ...(process.env.HSW_DAEMON_TOKEN ? { instance: process.env.HSW_DAEMON_TOKEN } : {}),
    }),
  );

  const api = new Hono();
  api.use('*', createOriginGuard());
  api.use('*', async (c, next) => {
    await next();
    const contentType = c.res.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json') || !c.res.ok) return;
    const payload = await c.res
      .clone()
      .json()
      .catch(() => undefined);
    if (payload === undefined) return;
    const localized = localizeResponsePayload(
      payload,
      requestLanguage(c.req.header('Accept-Language')),
    );
    c.res = new Response(JSON.stringify(localized), c.res);
  });
  api.get('/version', async (c) =>
    c.json({ name: 'harness-switch', version: await serverVersion() }),
  );
  api.route('/auth', createAuthRoutes(services));
  api.use('/users/*', createAuthGuard(services));
  api.use('/users', createAuthGuard(services));
  api.route('/users', createUserRoutes(services));
  api.use('/harnesses/*', createAuthGuard(services));
  api.use('/harnesses', createAuthGuard(services));
  api.route('/harnesses', createHarnessRoutes(services));
  api.use('/backups/*', createAuthGuard(services));
  api.use('/backups', createAuthGuard(services));
  api.route('/backups', createBackupRoutes(services));
  api.use('/scan/*', createAuthGuard(services));
  api.use('/scan', createAuthGuard(services));
  api.route('/scan', createScanRoutes(services));
  api.use('/operations/*', createAuthGuard(services));
  api.use('/operations', createAuthGuard(services));
  api.route('/operations', createOperationRoutes(services));
  api.use('/transfer/*', createAuthGuard(services));
  api.route('/transfer', createTransferRoutes(services));
  api.use('/github/*', createAuthGuard(services));
  api.use('/github', createAuthGuard(services));
  api.route('/github', createGitHubRoutes(services));
  api.use('/update/*', createAuthGuard(services));
  api.use('/update', createAuthGuard(services));
  api.route('/update', createUpdateRoutes(services));
  api.use('/providers/*', createAuthGuard(services));
  api.use('/providers', createAuthGuard(services));
  api.route('/providers', createProviderRoutes(services));
  api.use('/probe/*', createAuthGuard(services));
  api.use('/probe', createAuthGuard(services));
  api.route('/probe', createProbeRoutes(services));
  api.use('/doctor/*', createAuthGuard(services));
  api.use('/doctor', createAuthGuard(services));
  api.route('/doctor', createDoctorRoutes(services));
  api.use('/drift/*', createAuthGuard(services));
  api.use('/drift', createAuthGuard(services));
  api.route('/drift', createDriftRoutes(services));
  app.route('/api', api);

  const publicDir = environment.publicDir;
  if (existsSync(publicDir)) {
    app.get('*', async (c, next) => {
      if (c.req.path.startsWith('/api') || c.req.path === '/healthz') {
        return next();
      }
      const assetPath = resolve(publicDir, c.req.path.replace(/^\//, ''));
      if (c.req.path !== '/' && isPublicAsset(publicDir, assetPath) && existsSync(assetPath)) {
        c.header('Content-Type', contentType(assetPath));
        return c.body(readFileSync(assetPath));
      }
      const index = join(publicDir, 'index.html');
      if (existsSync(index)) {
        c.header('Cache-Control', 'no-store');
        return c.html(readFileSync(index, 'utf8'));
      }
      return c.text('frontend not built', 503);
    });
  }

  app.notFound((c) => {
    const code = ERROR_CODES.requestFailed;
    return c.json(
      { code, msg: localizeError(requestLanguage(c.req.header('Accept-Language')), code) },
      404,
    );
  });
  app.onError((error, c) => {
    const request = `${c.req.method} ${new URL(c.req.url).pathname}`;
    if (error instanceof HttpError) {
      // A 4xx is a normal answer to a bad request and stays silent; a 5xx is a server
      // fault that has to leave a trace even when the response body is deliberately terse.
      if (error.status >= 500) {
        log.error(`${request} failed with ${error.status}: ${error.message}`, error);
      }
      const data = error.params;
      return c.json(
        {
          code: error.code,
          ...(data ? { data } : {}),
          msg: localizeError(requestLanguage(c.req.header('Accept-Language')), error.code, data),
        } satisfies ErrorResponse,
        error.status as 400,
      );
    }
    log.error(`unhandled error on ${request}`, error);
    const code = ERROR_CODES.internalServerError;
    return c.json(
      {
        code,
        msg: localizeError(requestLanguage(c.req.header('Accept-Language')), code),
      } satisfies ErrorResponse,
      500,
    );
  });

  return app;
}

/** Adds the standard { code, data, msg } contract to nested success messages.
 *
 * Old `message`/`label`/`params` fields remain during the compatibility window so
 * existing web and CLI releases keep working. New clients can consistently prefer
 * `msg` and `data` whenever a server-reported `code` is present.
 */
function localizeResponsePayload(value: unknown, language: 'en' | 'zh-CN'): unknown {
  if (Array.isArray(value)) return value.map((item) => localizeResponsePayload(item, language));
  if (typeof value !== 'object' || value === null) return value;
  const record = value as Record<string, unknown>;
  const next = Object.fromEntries(
    Object.entries(record).map(([key, child]) => [key, localizeResponsePayload(child, language)]),
  ) as Record<string, unknown>;
  const code = typeof record.code === 'string' ? record.code : undefined;
  const params = isMessageParams(record.params) ? record.params : undefined;
  if (code && (typeof record.message === 'string' || typeof record.label === 'string')) {
    next.data = params;
    next.msg = localizeMessage(language, code, params);
  }
  if (typeof record.noteCode === 'string' && typeof record.note === 'string') {
    next.noteData = params;
    next.noteMsg = localizeMessage(language, record.noteCode, params);
  }
  return next;
}

function isMessageParams(value: unknown): value is Record<string, string | number | boolean> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(
      (item) => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean',
    )
  );
}

function isPublicAsset(publicDir: string, assetPath: string): boolean {
  const path = relative(publicDir, assetPath);
  return path !== '' && !path.startsWith('..') && !path.includes('..\\');
}

function contentType(path: string): string {
  switch (extname(path)) {
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.png':
      return 'image/png';
    case '.ico':
      return 'image/x-icon';
    default:
      return 'application/octet-stream';
  }
}
