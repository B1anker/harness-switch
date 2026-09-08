import type {
  ProbeResponse,
  ProviderMutationResponse,
  ProvidersResponse,
} from '@seaveyon/harness-switch-shared';
import {
  createProviderRequestSchema,
  probeStoredRequestSchema,
  updateProviderRequestSchema,
} from '@seaveyon/harness-switch-shared';
import { Hono } from 'hono';
import type { InstantiationService } from '../../di';
import { AUDIT_EVENTS, IAuditService } from '../../services/audit';
import { IProviderService } from '../../services/provider';
import { IVaultService } from '../../services/vault';
import { param } from '../params';
import { readJsonBody, readOptionalJsonBody } from '../validate';

export function createProviderRoutes(services: InstantiationService): Hono {
  const app = new Hono();
  const vault = services.get(IVaultService);
  const providers = services.get(IProviderService);
  const audit = services.get(IAuditService);

  app.get('/', (c) => c.json({ items: vault.list() } satisfies ProvidersResponse));

  app.get('/:id', (c) => c.json(vault.get(param(c, 'id'))));

  /**
   * Returns the stored credential in plaintext for the vault editor's reveal toggle.
   *
   * Every other read masks the key, so this is the one place it leaves the server. It
   * stays behind the same session guard as the rest of `/api/providers`, and the
   * response is marked no-store so the browser keeps no copy on disk.
   */
  app.get('/:id/reveal', (c) => {
    const id = param(c, 'id');
    // Resolve through `get` first so an unknown id is a 404 before anything decrypts.
    vault.get(id);
    const apiKey = vault.decrypt(id);
    // Record only that a reveal happened and for which entry — never the value itself,
    // which `audit.record` would strip regardless. This is the one route that hands a
    // plaintext key back, so it is the one worth a durable line.
    audit.record(AUDIT_EVENTS.credentialRevealed, { provider: id });
    c.header('Cache-Control', 'no-store');
    return c.json({ apiKey });
  });

  app.post('/', async (c) => {
    const body = await readJsonBody(c, createProviderRequestSchema);
    return c.json(
      { provider: vault.create(body), warnings: [] } satisfies ProviderMutationResponse,
      201,
    );
  });

  app.patch('/:id', async (c) => {
    const id = param(c, 'id');
    const body = await readJsonBody(c, updateProviderRequestSchema);
    return c.json(providers.update(id, body) satisfies ProviderMutationResponse);
  });

  app.post('/:id/probe', async (c) => {
    const id = param(c, 'id');
    // An absent body is fine: the endpoint parameter is optional.
    const body = await readOptionalJsonBody(c, probeStoredRequestSchema);
    return c.json({ result: await providers.probe(id, body) } satisfies ProbeResponse);
  });

  app.delete('/:id', (c) => {
    providers.remove(param(c, 'id'));
    return c.json({ ok: true });
  });

  return app;
}
