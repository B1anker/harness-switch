import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ErrorResponse } from '@seaveyon/harness-switch-shared';
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { HttpError } from './common/errors';
import type { InstantiationService } from './di';
import { createAuthGuard, createOriginGuard, createServiceMiddleware } from './http/middleware';
import { createAuthRoutes } from './http/routes/auth';
import { createBackupRoutes } from './http/routes/backups';
import { createDoctorRoutes } from './http/routes/doctor';
import { createDriftRoutes } from './http/routes/drift';
import { createHarnessRoutes } from './http/routes/harnesses';
import { createOperationRoutes } from './http/routes/operations';
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

  app.get('/healthz', (c) => c.json({ ok: true }));

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
  api.use('/doctor/*', createAuthGuard(services));
  api.use('/doctor', createAuthGuard(services));
  api.route('/doctor', createDoctorRoutes(services));
  api.use('/drift/*', createAuthGuard(services));
  api.use('/drift', createAuthGuard(services));
  api.route('/drift', createDriftRoutes(services));
  app.route('/api', api);

  const publicDir = environment.publicDir;
  if (existsSync(publicDir)) {
    app.use('/assets/*', serveStatic({ root: publicDir }));
    app.get('*', async (c, next) => {
      if (c.req.path.startsWith('/api') || c.req.path === '/healthz') {
        return next();
      }
      const assetPath = join(publicDir, c.req.path.replace(/^\//, ''));
      if (c.req.path !== '/' && existsSync(assetPath)) {
        return serveStatic({ root: publicDir })(c, next);
      }
      const index = join(publicDir, 'index.html');
      if (existsSync(index)) {
        c.header('Cache-Control', 'no-store');
        return c.html(await Bun.file(index).text());
      }
      return c.text('frontend not built', 503);
    });
  }

  app.notFound((c) => c.json({ error: 'not found' }, 404));
  app.onError((error, c) => {
    if (error instanceof HttpError) {
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
    log.error('unhandled error', error);
    return c.json({ error: 'internal server error' }, 500);
  });

  return app;
}
