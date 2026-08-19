import type { TransferConflictPolicy, TransferEnvelope } from '@seaveyon/harness-switch-shared';
import { Hono } from 'hono';
import { HttpError } from '../../common/errors';
import type { InstantiationService } from '../../di';
import { ITransferService } from '../../services/transfer';

type ExportBody = { passphrase?: string };
type ImportBody = {
  envelope?: TransferEnvelope;
  passphrase?: string;
  conflictPolicy?: TransferConflictPolicy;
  restoreActive?: boolean;
};

export function createTransferRoutes(services: InstantiationService): Hono {
  const app = new Hono();
  const transfer = services.get(ITransferService);

  app.post('/export', async (c) => {
    const body = await readBody<ExportBody>(c.req.json.bind(c.req));
    return c.json(transfer.exportAll(String(body.passphrase ?? '')));
  });

  app.post('/preview', async (c) => {
    const body = await readBody<ImportBody>(c.req.json.bind(c.req));
    return c.json(transfer.preview(requireEnvelope(body.envelope), String(body.passphrase ?? '')));
  });

  app.post('/import', async (c) => {
    const body = await readBody<ImportBody>(c.req.json.bind(c.req));
    return c.json(
      transfer.importAll(
        requireEnvelope(body.envelope),
        String(body.passphrase ?? ''),
        body.conflictPolicy ?? 'skip',
        body.restoreActive === true,
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
