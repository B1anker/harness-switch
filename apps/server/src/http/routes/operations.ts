import type { OperationsResponse, OperationUndoResponse } from '@seaveyon/harness-switch-shared';
import { Hono } from 'hono';
import type { InstantiationService } from '../../di';
import { IJournalService } from '../../services/journal';
import { param } from '../params';

/** Receipts for completed operations, plus the one-click undo built on top of them. */
export function createOperationRoutes(services: InstantiationService): Hono {
  const app = new Hono();
  const journal = services.get(IJournalService);

  app.get('/', (c) => {
    const harnessParam = c.req.query('harness');
    const items =
      harnessParam && harnessParam.length > 0
        ? journal.list().filter((item) => item.harness === harnessParam)
        : journal.list();
    return c.json({ items } satisfies OperationsResponse);
  });

  app.get('/:id', (c) => c.json(journal.detail(param(c, 'id'))));

  app.post('/:id/undo', (c) =>
    c.json({
      ok: true,
      receipt: journal.undo(param(c, 'id')),
    } satisfies OperationUndoResponse),
  );

  return app;
}
