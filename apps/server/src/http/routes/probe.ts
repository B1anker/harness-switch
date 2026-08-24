import {
  PROBE_CODES,
  type ProbeResponse,
  probeRequestSchema,
} from '@seaveyon/harness-switch-shared';
import { Hono } from 'hono';
import type { InstantiationService } from '../../di';
import { IProbeService } from '../../services/probe';
import { IVaultService } from '../../services/vault';
import { readJsonBody } from '../validate';

/**
 * Connectivity probe for values that are not stored yet: the profile dialog testing
 * a draft, or the vault editor testing a credential it is about to save.
 *
 * The base URL always comes from the request; the credential is either inline or
 * resolved server-side from the vault, so a draft key can be tested without saving
 * it first while a saved key never has to round-trip through the browser.
 */
export function createProbeRoutes(services: InstantiationService): Hono {
  const app = new Hono();
  const vault = services.get(IVaultService);
  const probe = services.get(IProbeService);

  app.post('/', async (c) => {
    const body = await readJsonBody(c, probeRequestSchema);
    const apiKey = draftKey(vault, body);
    if (!apiKey) {
      // Not a request-shape error the schema could have caught: report it as a
      // structured outcome so the UI renders it next to the button.
      return c.json({
        result: {
          ok: false,
          code: PROBE_CODES.missingApiKey,
          message: '未提供 API Key，也无法从凭据库解析，无法测试',
        },
      } satisfies ProbeResponse);
    }
    return c.json({
      result: await probe.probe({ baseUrl: body.baseUrl, apiKey }),
    } satisfies ProbeResponse);
  });

  return app;
}

/**
 * An explicit providerId wins over an inline key — the same precedence the profile
 * store uses. A missing vault entry surfaces as its own 404; no key at all returns
 * an empty string that the caller reports as a structured failure.
 */
function draftKey(vault: IVaultService, body: { providerId?: string; apiKey?: string }): string {
  if (body.providerId?.trim()) {
    return vault.decrypt(body.providerId.trim());
  }
  return body.apiKey?.trim() ?? '';
}
