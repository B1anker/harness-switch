import { Hono } from 'hono';
import type { InstantiationService } from '../../di';
import { IUpdateService } from '../../services/update';

export function createUpdateRoutes(services: InstantiationService): Hono {
  const api = new Hono();
  const updates = services.get(IUpdateService);

  api.get('/check', async (c) => c.json(await updates.check(c.req.query('force') === '1')));

  api.post('/', async (c) => {
    await updates.trigger();
    return c.json({ status: 'updating' }, 202);
  });

  return api;
}
