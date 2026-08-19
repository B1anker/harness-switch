import { Hono } from 'hono';
import type { InstantiationService } from '../../di';
import { checkForUpdate, triggerUpdate } from '../../update';

export function createUpdateRoutes(_services: InstantiationService): Hono {
  const api = new Hono();

  api.get('/check', async (c) => c.json(await checkForUpdate(c.req.query('force') === '1')));

  api.post('/', async (c) => {
    await triggerUpdate();
    return c.json({ status: 'updating' }, 202);
  });

  return api;
}
