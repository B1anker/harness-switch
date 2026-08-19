import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { HttpError } from './common/errors';
import type { InstantiationService } from './di';
import { createAuthGuard, createOriginGuard, createServiceMiddleware } from './http/middleware';
import { createAuthRoutes } from './http/routes/auth';
import { createBackupRoutes } from './http/routes/backups';
import { createHarnessRoutes } from './http/routes/harnesses';
import { createTransferRoutes } from './http/routes/transfer';
import { createUpdateRoutes } from './http/routes/update';
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
  api.use('/harnesses/*', createAuthGuard(services));
  api.use('/harnesses', createAuthGuard(services));
  api.route('/harnesses', createHarnessRoutes(services));
  api.use('/backups/*', createAuthGuard(services));
  api.use('/backups', createAuthGuard(services));
  api.route('/backups', createBackupRoutes(services));
  api.use('/transfer/*', createAuthGuard(services));
  api.route('/transfer', createTransferRoutes(services));
  api.use('/update/*', createAuthGuard(services));
  api.use('/update', createAuthGuard(services));
  api.route('/update', createUpdateRoutes(services));
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
      return c.json({ error: error.message }, error.status as 400);
    }
    log.error('unhandled error', error);
    return c.json({ error: 'internal server error' }, 500);
  });

  return app;
}
