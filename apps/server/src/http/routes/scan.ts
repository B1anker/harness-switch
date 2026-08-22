import { type ScanResponse, scanImportRequestSchema } from '@seaveyon/harness-switch-shared';
import { Hono } from 'hono';
import type { InstantiationService } from '../../di';
import { IScanService } from '../../services/scan';
import { readJsonBody } from '../validate';

export function createScanRoutes(services: InstantiationService): Hono {
  const app = new Hono();
  const scan = services.get(IScanService);

  app.get('/', (c) => c.json({ items: scan.scan() } satisfies ScanResponse));

  app.post('/import', async (c) => {
    const body = await readJsonBody(c, scanImportRequestSchema);
    return c.json(scan.importSelections(body.selections));
  });

  return app;
}
