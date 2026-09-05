import { Hono } from 'hono';
import type { InstantiationService } from './di';
import { registerAssetRoutes } from './http/assets';
import { registerErrorHandlers } from './http/error-handler';
import { createLocalizeMiddleware } from './http/localize';
import { createAuthGuard, createOriginGuard } from './http/middleware';
import { createAuthRoutes } from './http/routes/auth';
import { createBackupRoutes } from './http/routes/backups';
import { createDoctorRoutes } from './http/routes/doctor';
import { createDriftRoutes } from './http/routes/drift';
import { createGitHubRoutes } from './http/routes/github';
import { createHarnessRoutes } from './http/routes/harnesses';
import {
  createModelFavoriteOperationRoutes,
  createModelFavoritePlanRoutes,
  createModelFavoriteRoutes,
} from './http/routes/model-favorites';
import { createOperationRoutes } from './http/routes/operations';
import { createProbeRoutes } from './http/routes/probe';
import { createProviderRoutes } from './http/routes/providers';
import { createScanRoutes } from './http/routes/scan';
import { createTransferRoutes } from './http/routes/transfer';
import { createUpdateRoutes } from './http/routes/update';
import { createUserRoutes } from './http/routes/users';
import { IEnvironmentService } from './services/environment';
import { ILogService } from './services/log';
import { IVersionService } from './services/version';

export function createApp(services: InstantiationService): Hono {
  const app = new Hono();
  const environment = services.get(IEnvironmentService);
  const versions = services.get(IVersionService);

  app.get('/healthz', (c) =>
    c.json({
      ok: true,
      ...(process.env.HSW_DAEMON_TOKEN ? { instance: process.env.HSW_DAEMON_TOKEN } : {}),
    }),
  );

  const api = new Hono();
  api.use('*', createOriginGuard());
  api.use('*', createLocalizeMiddleware());
  api.get('/version', async (c) =>
    c.json({ name: 'harness-switch', version: await versions.version() }),
  );
  api.route('/auth', createAuthRoutes(services));

  /**
   * Mounts a router behind the session guard.
   *
   * One `/x/*` registration is enough: Hono matches a trailing wildcard against the bare
   * `/x` as well as its sub-paths, on every router implementation. Each prefix used to
   * register the guard twice — once bare, once wildcard — which ran the session lookup
   * twice for bare-path requests, and left `/transfer` looking under-protected next to
   * its neighbours when it was not. `test/api.test.ts` asserts the coverage either way.
   */
  const guarded = (path: string, routes: Hono): void => {
    api.use(`${path}/*`, createAuthGuard(services));
    api.route(path, routes);
  };

  guarded('/model-favorites', createModelFavoriteRoutes(services));
  guarded('/model-favorite-plans', createModelFavoritePlanRoutes(services));
  guarded('/model-favorite-operations', createModelFavoriteOperationRoutes(services));
  guarded('/users', createUserRoutes(services));
  guarded('/harnesses', createHarnessRoutes(services));
  guarded('/backups', createBackupRoutes(services));
  guarded('/scan', createScanRoutes(services));
  guarded('/operations', createOperationRoutes(services));
  guarded('/transfer', createTransferRoutes(services));
  guarded('/github', createGitHubRoutes(services));
  guarded('/update', createUpdateRoutes(services));
  guarded('/providers', createProviderRoutes(services));
  guarded('/probe', createProbeRoutes(services));
  guarded('/doctor', createDoctorRoutes(services));
  guarded('/drift', createDriftRoutes(services));
  app.route('/api', api);

  registerAssetRoutes(app, environment.publicDir);
  registerErrorHandlers(app, services.get(ILogService));

  return app;
}
