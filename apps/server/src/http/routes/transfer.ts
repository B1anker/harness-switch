import {
  transferExportRequestSchema,
  transferImportRequestSchema,
} from '@seaveyon/harness-switch-shared';
import { Hono } from 'hono';
import type { InstantiationService } from '../../di';
import { ITransferService } from '../../services/transfer';
import { readJsonBody } from '../validate';

export function createTransferRoutes(services: InstantiationService): Hono {
  const app = new Hono();
  const transfer = services.get(ITransferService);

  app.get('/export/preview', (c) => c.json(transfer.exportPreview()));

  app.post('/export', async (c) => {
    const body = await readJsonBody(c, transferExportRequestSchema);
    return c.json(
      transfer.exportAll(
        body.passphrase,
        body.includeCodexLoginCache !== false,
        body.legacy === true,
      ),
    );
  });

  app.post('/preview', async (c) => {
    const body = await readJsonBody(c, transferImportRequestSchema);
    return c.json(
      transfer.preview(
        body.envelope,
        body.passphrase,
        body.conflictPolicy ?? 'skip',
        body.restoreActive === true,
      ),
    );
  });

  app.post('/import', async (c) => {
    const body = await readJsonBody(c, transferImportRequestSchema);
    return c.json(
      transfer.importAll(
        body.envelope,
        body.passphrase,
        body.conflictPolicy ?? 'skip',
        body.restoreActive === true,
        body.migrateCodexLoginCache !== false,
      ),
    );
  });

  return app;
}
