import { Hono } from 'hono';
import type { InstantiationService } from '../../di';
import { IBackupService } from '../../services/backup';
import { param } from '../params';

export function createBackupRoutes(services: InstantiationService): Hono {
  const app = new Hono();
  const backups = services.get(IBackupService);

  app.get('/', (c) => c.json({ items: backups.list() }));

  app.get('/:id', (c) => c.json(backups.detail(param(c, 'id'))));

  app.post('/:id/restore', (c) => {
    backups.restore(param(c, 'id'));
    return c.json({ ok: true });
  });

  return app;
}
