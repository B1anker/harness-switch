import { existsSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import type { ErrorResponse } from '@seaveyon/harness-switch-shared';
import { Hono } from 'hono';
import { HttpError } from './common/errors';
import type { InstantiationService } from './di';
import { createAuthGuard, createOriginGuard, createServiceMiddleware } from './http/middleware';
import { createAuthRoutes } from './http/routes/auth';
import { createBackupRoutes } from './http/routes/backups';
import { createDoctorRoutes } from './http/routes/doctor';
import { createDriftRoutes } from './http/routes/drift';
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

  app.notFound((c) => c.json({ error: 'not found' }, 404));
  app.onError((error, c) => {
    const request = `${c.req.method} ${new URL(c.req.url).pathname}`;
    if (error instanceof HttpError) {
      // A 4xx is a normal answer to a bad request and stays silent; a 5xx is a server
      // fault that has to leave a trace even when the response body is deliberately terse.
      if (error.status >= 500) {
        log.error(`${request} failed with ${error.status}: ${error.message}`, error);
      }
      // `error` stays the prose the CLI prints; `code` lets the web UI localize it.
      return c.json(
        {
          error: error.message,
          ...(error.code ? { code: error.code } : {}),
          ...(error.params ? { params: error.params } : {}),
        } satisfies ErrorResponse,
        error.status as 400,
      );
    }
    log.error(`unhandled error on ${request}: ${describe(error)}`, error);
    return c.json({ error: 'internal server error' }, 500);
  });

  return app;
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

/**
 * A one-line summary of a thrown value. Node's errno errors carry the facts that
 * actually identify the failure (`EACCES`, the syscall, the path) outside `message`,
 * and a non-Error throw has no `stack` for the logger to fall back on.
 */
function describe(error: unknown): string {
  if (!(error instanceof Error)) {
    return `non-error thrown: ${String(error)}`;
  }
  const errno = error as NodeJS.ErrnoException;
  const parts = [error.name, error.message];
  if (errno.code) parts.push(`code=${errno.code}`);
  if (errno.syscall) parts.push(`syscall=${errno.syscall}`);
  if (errno.path) parts.push(`path=${errno.path}`);
  return parts.join(' ');
}
