import type { ProbeResponse } from '@seaveyon/harness-switch-shared';
import {
  createProfileRequestSchema,
  probeStoredRequestSchema,
  updateProfileRequestSchema,
} from '@seaveyon/harness-switch-shared';
import { Hono } from 'hono';
import type { InstantiationService } from '../../di';
import { IActivationService } from '../../services/activation';
import { IHarnessService } from '../../services/harness';
import { IProbeProfileService } from '../../services/probe-profile';
import { IProfileService } from '../../services/profiles';
import { IHarnessRegistry } from '../../services/registry';
import { param } from '../params';
import { readJsonBody, readOptionalJsonBody } from '../validate';

export function createHarnessRoutes(services: InstantiationService): Hono {
  const app = new Hono();
  const registry = services.get(IHarnessRegistry);
  const harnesses = services.get(IHarnessService);
  const profiles = services.get(IProfileService);
  const activation = services.get(IActivationService);
  const profileProbe = services.get(IProbeProfileService);

  app.get('/', (c) => c.json(harnesses.overview()));

  app.get('/:harnessId', (c) =>
    c.json(harnesses.summary(registry.require(c.req.param('harnessId')))),
  );

  app.post('/:harnessId/profiles', async (c) => {
    const harnessId = registry.require(c.req.param('harnessId'));
    const body = await readJsonBody(c, createProfileRequestSchema);
    return c.json(harnesses.createProfile(harnessId, body), 201);
  });

  app.patch('/:harnessId/profiles/:name', async (c) => {
    const harnessId = registry.require(c.req.param('harnessId'));
    const name = param(c, 'name');
    const body = await readJsonBody(c, updateProfileRequestSchema);
    return c.json(harnesses.updateProfile(harnessId, name, body));
  });

  app.delete('/:harnessId/profiles/:name', (c) => {
    harnesses.deleteProfile(registry.require(c.req.param('harnessId')), param(c, 'name'));
    return c.json({ ok: true });
  });

  app.get('/:harnessId/profiles/:name/preview', (c) => {
    const harnessId = registry.require(c.req.param('harnessId'));
    return c.json({ targets: activation.preview(harnessId, param(c, 'name')) });
  });

  app.get('/:harnessId/official/preview', (c) => {
    const harnessId = registry.require(c.req.param('harnessId'));
    return c.json({ targets: activation.previewOfficial(harnessId) });
  });

  app.post('/:harnessId/profiles/:name/probe', async (c) => {
    const harnessId = registry.require(c.req.param('harnessId'));
    const name = param(c, 'name');
    // An absent body is fine: every completion option is optional.
    const body = await readOptionalJsonBody(c, probeStoredRequestSchema);
    const decrypted = profiles.decrypt(harnessId, name);
    return c.json({
      result: await profileProbe.probe(harnessId, decrypted, body),
    } satisfies ProbeResponse);
  });

  app.post('/:harnessId/profiles/:name/activate', (c) => {
    const harnessId = registry.require(c.req.param('harnessId'));
    const result = activation.activate(harnessId, param(c, 'name'));
    return c.json({ ok: true, envFile: result.envFile, warnings: result.warnings });
  });

  app.post('/:harnessId/official/activate', (c) => {
    const result = activation.activateOfficial(registry.require(c.req.param('harnessId')));
    return c.json({ ok: true, envFile: result.envFile, warnings: result.warnings });
  });

  return app;
}
