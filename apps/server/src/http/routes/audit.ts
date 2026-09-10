import type { AuditResponse } from '@seaveyon/harness-switch-shared';
import { Hono } from 'hono';
import type { InstantiationService } from '../../di';
import { IAuditService } from '../../services/audit';

/**
 * Read side of the security audit trail, for the operator who would rather open a page
 * than `tail` a file. It only ever reads: entries are appended by the events themselves,
 * never by a request here, so there is nothing to mutate or delete.
 */
export function createAuditRoutes(services: InstantiationService): Hono {
  const app = new Hono();
  const audit = services.get(IAuditService);

  app.get('/', (c) => {
    const limit = Number.parseInt(c.req.query('limit') ?? '', 10);
    const items = audit.list(Number.isFinite(limit) && limit > 0 ? limit : undefined);
    return c.json({ items } satisfies AuditResponse);
  });

  return app;
}
