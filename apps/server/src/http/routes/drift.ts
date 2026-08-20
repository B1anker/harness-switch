import { Hono } from 'hono';
import type { InstantiationService } from '../../di';
import { IDriftService } from '../../services/drift';
import { IHarnessRegistry } from '../../services/registry';

export function createDriftRoutes(services: InstantiationService): Hono {
  const app = new Hono();
  const drift = services.get(IDriftService);
  const harnesses = services.get(IHarnessRegistry);

  app.get('/', (c) => c.json({ items: drift.inspectAll() }));

  app.get('/:harnessId', (c) => c.json(drift.inspect(harnesses.require(c.req.param('harnessId')))));

  app.post('/:harnessId/reapply', (c) =>
    c.json(drift.reapply(harnesses.require(c.req.param('harnessId')))),
  );

  app.post('/:harnessId/adopt', (c) =>
    c.json(drift.adopt(harnesses.require(c.req.param('harnessId')))),
  );

  return app;
}
