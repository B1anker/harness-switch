import type { TransferConflictPolicy, TransferEnvelope } from '@seaveyon/harness-switch-shared';
import { Hono } from 'hono';
import { HttpError } from '../../common/errors';
import type { InstantiationService } from '../../di';
import { ITransferService } from '../../services/transfer';

type ExportBody = { passphrase?: string; includeCodexLoginCache?: boolean };
type ImportBody = {
  envelope?: TransferEnvelope;
  passphrase?: string;
  conflictPolicy?: TransferConflictPolicy;
  restoreActive?: boolean;
  migrateCodexLoginCache?: boolean;
};

export function createTransferRoutes(services: InstantiationService): Hono {
  const app = new Hono();
  const transfer = services.get(ITransferService);

  app.get('/export/preview', (c) => c.json(transfer.exportPreview()));

  app.post('/export', async (c) => {
    const body = await readBody<ExportBody>(c.req.json.bind(c.req));
    return c.json(
      transfer.exportAll(String(body.passphrase ?? ''), body.includeCodexLoginCache === true),
    );
  });

  app.post('/preview', async (c) => {
    const body = await readBody<ImportBody>(c.req.json.bind(c.req));
    return c.json(
      transfer.preview(
        requireEnvelope(body.envelope),
        String(body.passphrase ?? ''),
        body.conflictPolicy ?? 'skip',
        body.restoreActive === true,
      ),
    );
  });

  app.post('/import', async (c) => {
    const body = await readBody<ImportBody>(c.req.json.bind(c.req));
    return c.json(
      transfer.importAll(
        requireEnvelope(body.envelope),
        String(body.passphrase ?? ''),
        body.conflictPolicy ?? 'skip',
        body.restoreActive === true,
        body.migrateCodexLoginCache === true,
      ),
    );
  });

  return app;
}

function requireEnvelope(envelope: TransferEnvelope | undefined): TransferEnvelope {
  if (!envelope || typeof envelope !== 'object') {
    throw new HttpError(400, '缺少有效的导出文件');
  }
  return envelope;
}

async function readBody<T>(read: () => Promise<T>): Promise<T> {
  return read().catch(() => {
    throw new HttpError(400, 'invalid json');
  });
}
