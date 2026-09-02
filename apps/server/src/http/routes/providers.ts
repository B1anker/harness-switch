import type {
  LocalizedMessage,
  ProbeResponse,
  ProviderMutationResponse,
  ProvidersResponse,
} from '@seaveyon/harness-switch-shared';
import {
  createProviderRequestSchema,
  PROBE_CODES,
  probeStoredRequestSchema,
  updateProviderRequestSchema,
  WARNING_CODES,
} from '@seaveyon/harness-switch-shared';
import { Hono } from 'hono';
import type { InstantiationService } from '../../di';
import { IActivationService } from '../../services/activation';
import { ILogService } from '../../services/log';
import { IProbeService } from '../../services/probe';
import { IProfileService } from '../../services/profiles';
import { IVaultService } from '../../services/vault';
import { parseWith, readJsonBody } from '../validate';

export function createProviderRoutes(services: InstantiationService): Hono {
  const app = new Hono();
  const vault = services.get(IVaultService);
  const profiles = services.get(IProfileService);
  const activation = services.get(IActivationService);
  const log = services.get(ILogService);
  const probe = services.get(IProbeService);

  app.get('/', (c) => c.json({ items: vault.list() } satisfies ProvidersResponse));

  app.get('/:id', (c) => c.json(vault.get(decodeURIComponent(c.req.param('id')))));

  /**
   * Returns the stored credential in plaintext for the vault editor's reveal toggle.
   *
   * Every other read masks the key, so this is the one place it leaves the server. It
   * stays behind the same session guard as the rest of `/api/providers`, and the
   * response is marked no-store so the browser keeps no copy on disk.
   */
  app.get('/:id/reveal', (c) => {
    const id = decodeURIComponent(c.req.param('id'));
    // Resolve through `get` first so an unknown id is a 404 before anything decrypts.
    vault.get(id);
    c.header('Cache-Control', 'no-store');
    return c.json({ apiKey: vault.decrypt(id) });
  });

  app.post('/', async (c) => {
    const body = await readJsonBody(c, createProviderRequestSchema);
    return c.json(
      { provider: vault.create(body), warnings: [] } satisfies ProviderMutationResponse,
      201,
    );
  });

  app.patch('/:id', async (c) => {
    const id = decodeURIComponent(c.req.param('id'));
    const body = await readJsonBody(c, updateProviderRequestSchema);
    const { provider, affected } = vault.update(id, body);

    // Refresh the cached credential/base URL of every referencing profile so the
    // store stays a faithful mirror of the vault (single write for all of them).
    profiles.sweepVaultCache(id, vault.decrypt(id), provider.endpoints);

    // Re-apply every ACTIVE profile that references this provider so the live files
    // reflect the rotation/endpoint change immediately. Failures are reported, never
    // raised: the store is already updated and the vault stays the source of truth.
    const warnings: LocalizedMessage[] = [];
    for (const ref of affected) {
      if (activation.getActive(ref.harness as never)?.name !== ref.name) {
        continue;
      }
      const profile = profiles.get(ref.harness as never, ref.name);
      if (
        profile?.providerEndpoint &&
        !provider.endpoints.some((ep) => ep.key === profile.providerEndpoint)
      ) {
        warnings.push({
          message: `${ref.harness}/${ref.name}: endpoint ${profile.providerEndpoint} 已不存在，将回退到 provider 首个 endpoint`,
          code: WARNING_CODES.endpointFallback,
          params: {
            harness: ref.harness,
            profile: ref.name,
            endpoint: profile.providerEndpoint,
          },
        });
      }
      try {
        activation.activate(ref.harness as never, ref.name);
      } catch (error) {
        log.error(`providers update: failed to re-apply ${ref.harness}/${ref.name}`, error);
        warnings.push({
          message: `${ref.harness}/${ref.name} 重新应用失败：${(error as Error).message}`,
          code: WARNING_CODES.reapplyFailed,
          params: { harness: ref.harness, profile: ref.name, reason: (error as Error).message },
        });
      }
    }
    return c.json({ provider, warnings } satisfies ProviderMutationResponse);
  });

  app.post('/:id/probe', async (c) => {
    const id = decodeURIComponent(c.req.param('id'));
    // An absent body is fine: the endpoint parameter is optional.
    const body = parseWith(probeStoredRequestSchema, await c.req.json().catch(() => ({})));
    const apiKey = vault.decrypt(id);
    const baseUrl = resolveEndpointBaseUrl(vault.get(id), body.endpoint);
    if (!baseUrl) {
      return c.json({
        result: {
          ok: false,
          code: PROBE_CODES.missingBaseUrl,
          message: `provider ${id} 未配置任何 endpoint，无法测试`,
        },
      } satisfies ProbeResponse);
    }
    return c.json({ result: await probe.probe({ baseUrl, apiKey }) } satisfies ProbeResponse);
  });

  app.delete('/:id', (c) => {
    vault.remove(decodeURIComponent(c.req.param('id')));
    return c.json({ ok: true });
  });

  return app;
}

/** A named endpoint wins; absent or unknown names fall back to the first endpoint. */
function resolveEndpointBaseUrl(
  entry: { endpoints: Array<{ key: string; baseUrl: string }> },
  endpointKey: string | undefined,
): string | null {
  if (endpointKey?.trim()) {
    const named = entry.endpoints.find((candidate) => candidate.key === endpointKey.trim());
    if (named) {
      return named.baseUrl;
    }
  }
  return entry.endpoints[0]?.baseUrl ?? null;
}
