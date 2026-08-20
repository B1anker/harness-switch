import type {
  CreateProviderRequest,
  ProviderMutationResponse,
  ProvidersResponse,
  UpdateProviderRequest,
} from '@seaveyon/harness-switch-shared';
import { Hono } from 'hono';
import { HttpError } from '../../common/errors';
import type { InstantiationService } from '../../di';
import { IActivationService } from '../../services/activation';
import { ILogService } from '../../services/log';
import { IProfileService } from '../../services/profiles';
import { IVaultService } from '../../services/vault';

export function createProviderRoutes(services: InstantiationService): Hono {
  const app = new Hono();
  const vault = services.get(IVaultService);
  const profiles = services.get(IProfileService);
  const activation = services.get(IActivationService);
  const log = services.get(ILogService);

  app.get('/', (c) => c.json({ items: vault.list() } satisfies ProvidersResponse));

  app.get('/:id', (c) => c.json(vault.get(decodeURIComponent(c.req.param('id')))));

  app.post('/', async (c) => {
    const body = await readBody<CreateProviderRequest>(c.req.json.bind(c.req));
    return c.json(
      { provider: vault.create(body), warnings: [] } satisfies ProviderMutationResponse,
      201,
    );
  });

  app.patch('/:id', async (c) => {
    const id = decodeURIComponent(c.req.param('id'));
    const body = await readBody<UpdateProviderRequest>(c.req.json.bind(c.req));
    const { provider, affected } = vault.update(id, body);

    // Refresh the cached credential/base URL of every referencing profile so the
    // store stays a faithful mirror of the vault (single write for all of them).
    profiles.sweepVaultCache(id, vault.decrypt(id), provider.endpoints);

    // Re-apply every ACTIVE profile that references this provider so the live files
    // reflect the rotation/endpoint change immediately. Failures are reported, never
    // raised: the store is already updated and the vault stays the source of truth.
    const warnings: string[] = [];
    for (const ref of affected) {
      if (activation.getActive(ref.harness as never)?.name !== ref.name) {
        continue;
      }
      const profile = profiles.get(ref.harness as never, ref.name);
      if (
        profile?.providerEndpoint &&
        !provider.endpoints.some((ep) => ep.key === profile.providerEndpoint)
      ) {
        warnings.push(
          `${ref.harness}/${ref.name}: endpoint ${profile.providerEndpoint} 已不存在，将回退到 provider 首个 endpoint`,
        );
      }
      try {
        activation.activate(ref.harness as never, ref.name);
      } catch (error) {
        log.error(`providers update: failed to re-apply ${ref.harness}/${ref.name}`, error);
        warnings.push(`${ref.harness}/${ref.name} 重新应用失败：${(error as Error).message}`);
      }
    }
    return c.json({ provider, warnings } satisfies ProviderMutationResponse);
  });

  app.delete('/:id', (c) => {
    vault.remove(decodeURIComponent(c.req.param('id')));
    return c.json({ ok: true });
  });

  return app;
}

async function readBody<T>(read: () => Promise<T>): Promise<T> {
  return read().catch(() => {
    throw new HttpError(400, 'invalid json');
  });
}
