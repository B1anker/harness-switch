import {
  FAVORITE_CODES,
  toolModelsApplySchema,
  toolModelsHarnessSchema,
  toolModelsRequestSchema,
} from '@seaveyon/harness-switch-shared';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { InstantiationService } from '../../di';
import { IEnvironmentService } from '../../services/environment';
import { IToolModelsService } from '../../services/tool-models';
import { param } from '../params';
import { readJsonBody } from '../validate';

export function createToolModelsRoutes(services: InstantiationService): Hono {
  const app = new Hono();
  const models = services.get(IToolModelsService);
  const environment = services.get(IEnvironmentService);
  app.get('/:harness', (c) =>
    c.json({
      code: FAVORITE_CODES.result,
      data: models.get(toolModelsHarnessSchema.parse(param(c, 'harness'))),
    }),
  );
  app.put('/:harness', async (c) =>
    c.json({
      code: FAVORITE_CODES.result,
      data: models.save(
        toolModelsHarnessSchema.parse(param(c, 'harness')),
        await readJsonBody(c, toolModelsRequestSchema),
      ),
    }),
  );
  app.post('/:harness/preview', async (c) =>
    c.json({
      code: FAVORITE_CODES.result,
      data: models.preview(
        toolModelsHarnessSchema.parse(param(c, 'harness')),
        await readJsonBody(c, toolModelsRequestSchema),
        getCookie(c, environment.cookieName) ?? '',
      ),
    }),
  );
  app.post('/:harness/apply', async (c) => {
    const body = await readJsonBody(c, toolModelsApplySchema);
    return c.json({
      code: FAVORITE_CODES.result,
      data: models.apply(
        toolModelsHarnessSchema.parse(param(c, 'harness')),
        body.planId,
        getCookie(c, environment.cookieName) ?? '',
      ),
    });
  });
  return app;
}
