import { Hono } from 'hono';
import type { InstantiationService } from '../../di';
import { IBackupService } from '../../services/backup';

export function createBackupRoutes(services: InstantiationService): Hono {
  const app = new Hono();
  const backups = services.get(IBackupService);

  app.get('/', (c) => c.json({ items: backups.list() }));

  app.post('/:id/restore', (c) => {
    backups.restore(decodeURIComponent(c.req.param('id')));
    return c.json({ ok: true });
  });

  return app;
}
