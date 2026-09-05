import {
  createFavoriteRequestSchema,
  FAVORITE_CODES,
  favoriteApplyRequestSchema,
  favoriteCaptureRequestSchema,
  favoriteDetachRequestSchema,
  favoritePlanRequestSchema,
  favoriteRevisionRequestSchema,
  HARNESS_IDS,
  harnessIdSchema,
  updateFavoriteRequestSchema,
} from '@seaveyon/harness-switch-shared';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { InstantiationService } from '../../di';
import { IAdapterRegistry } from '../../services/adapters';
import { IEnvironmentService } from '../../services/environment';
import { IFavoriteBackupService } from '../../services/favorite-backup';
import { IModelFavoriteService } from '../../services/model-favorite';
import { IModelFavoriteApplyService } from '../../services/model-favorite-apply';
import { IModelFavoriteStore } from '../../services/model-favorite-store';
import { IProfileService } from '../../services/profiles';
import { param } from '../params';
import { readJsonBody } from '../validate';

export function createModelFavoriteRoutes(services: InstantiationService): Hono {
  const app = new Hono();
  const favorites = services.get(IModelFavoriteService);
  const store = services.get(IModelFavoriteStore);
  const apply = services.get(IModelFavoriteApplyService);
  const adapters = services.get(IAdapterRegistry);
  const profiles = services.get(IProfileService);
  const backups = services.get(IFavoriteBackupService);
  app.get('/backups', (c) => c.json({ code: FAVORITE_CODES.result, data: backups.list() }));
  app.post('/backups', (c) => c.json({ code: FAVORITE_CODES.result, data: backups.create() }, 201));
  app.post('/backups/:backupId/restore', (c) => {
    backups.restore(param(c, 'backupId'));
    return c.json({ code: FAVORITE_CODES.result, data: { ok: true } });
  });
  app.get('/', (c) =>
    c.json({
      code: FAVORITE_CODES.result,
      data: favorites.list().map((favorite) => ({
        ...favorite,
        references: favorite.references.map((ref) => ({
          ...ref,
          ...apply.state(profiles.get(ref.harness, ref.name)!),
        })),
      })),
    }),
  );
  app.post('/', async (c) =>
    c.json(
      {
        code: FAVORITE_CODES.result,
        data: favorites.create(await readJsonBody(c, createFavoriteRequestSchema)),
      },
      201,
    ),
  );
  app.post('/from-profile', async (c) =>
    c.json(
      {
        code: FAVORITE_CODES.result,
        data: favorites.capture(await readJsonBody(c, favoriteCaptureRequestSchema)),
      },
      201,
    ),
  );
  app.get('/source/:harness/:name', (c) =>
    c.json({
      code: FAVORITE_CODES.result,
      data: {
        sourceFingerprint: favorites.sourceFingerprint(
          harnessIdSchema.parse(param(c, 'harness')),
          param(c, 'name'),
        ),
      },
    }),
  );
  app.post('/source/:harness/:name/detach', async (c) => {
    const body = await readJsonBody(c, favoriteDetachRequestSchema);
    favorites.detach(
      harnessIdSchema.parse(param(c, 'harness')),
      param(c, 'name'),
      body.sourceFingerprint,
    );
    return c.json({ code: FAVORITE_CODES.result, data: { ok: true } });
  });
  app.patch('/:id', async (c) =>
    c.json({
      code: FAVORITE_CODES.result,
      data: favorites.update(param(c, 'id'), await readJsonBody(c, updateFavoriteRequestSchema)),
    }),
  );
  app.delete('/:id', async (c) => {
    const body = await readJsonBody(c, favoriteRevisionRequestSchema);
    favorites.remove(param(c, 'id'), body.expectedRevision);
    return c.json({ code: FAVORITE_CODES.result, data: { ok: true } });
  });
  app.get('/:id/targets', (c) => {
    const favorite = store.get(param(c, 'id'));
    return c.json({
      code: FAVORITE_CODES.result,
      data: HARNESS_IDS.map((harness) => ({
        harness,
        protocols: adapters.get(harness).favoriteSupport,
        connections: favorite.connections.map((connection) => ({
          id: connection.id,
          projection: adapters.get(harness).projectFavorite(favorite, connection),
        })),
      })),
    });
  });
  return app;
}

export function createModelFavoritePlanRoutes(services: InstantiationService): Hono {
  const app = new Hono();
  const apply = services.get(IModelFavoriteApplyService);
  const environment = services.get(IEnvironmentService);
  app.post('/', async (c) =>
    c.json({
      code: FAVORITE_CODES.result,
      data: apply.plan(
        await readJsonBody(c, favoritePlanRequestSchema),
        getCookie(c, environment.cookieName)!,
      ),
    }),
  );
  app.post('/:id/apply', async (c) => {
    const body = await readJsonBody(c, favoriteApplyRequestSchema);
    return c.json({
      code: FAVORITE_CODES.result,
      data: apply.apply(param(c, 'id'), body.requestId, getCookie(c, environment.cookieName)!),
    });
  });
  return app;
}

export function createModelFavoriteOperationRoutes(services: InstantiationService): Hono {
  const app = new Hono();
  app.get('/:id', (c) =>
    c.json({
      code: FAVORITE_CODES.result,
      data: services.get(IModelFavoriteApplyService).operation(param(c, 'id')),
    }),
  );
  return app;
}
