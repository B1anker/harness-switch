import type { HarnessId } from '@seaveyon/harness-switch-shared';
import { Hono } from 'hono';
import { HttpError } from '../../common/errors';
import type { InstantiationService } from '../../di';
import { IActivationService } from '../../services/activation';
import { IAdapterRegistry } from '../../services/adapters';
import { IEnvironmentService } from '../../services/environment';
import { IProfileService } from '../../services/profiles';
import { IHarnessRegistry } from '../../services/registry';

type ProfileBody = {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  notes?: string;
  extras?: Record<string, string>;
  overrides?: Record<string, string>;
};

export function createHarnessRoutes(services: InstantiationService): Hono {
  const app = new Hono();
  const harnesses = services.get(IHarnessRegistry);
  const profiles = services.get(IProfileService);
  const activation = services.get(IActivationService);
  const adapters = services.get(IAdapterRegistry);
  const environment = services.get(IEnvironmentService);

  function summary(id: HarnessId) {
    const adapter = adapters.get(id);
    return {
      id,
      label: harnesses.label(id),
      mode: adapter.mode,
      active: activation.getActive(id),
      profiles: profiles.list(id),
      fields: adapter.fields,
      targets: adapter.targets(),
      envVars: adapter.envVarNames,
      envNote: adapter.envNote,
    };
  }

  app.get('/', (c) =>
    c.json({
      envFile: environment.files.env,
      items: harnesses.list().map((item) => summary(item.id)),
    }),
  );

  app.get('/:harnessId', (c) => c.json(summary(harnesses.require(c.req.param('harnessId')))));

  app.post('/:harnessId/profiles', async (c) => {
    const harnessId = harnesses.require(c.req.param('harnessId'));
    const body = await readBody(c.req.json.bind(c.req));
    const profile = profiles.upsert(
      harnessId,
      {
        name: String(body.name ?? ''),
        baseUrl: body.baseUrl,
        apiKey: body.apiKey,
        model: body.model,
        notes: body.notes,
        extras: body.extras,
        overrides: body.overrides,
      },
      true,
    );
    return c.json(profile, 201);
  });

  app.patch('/:harnessId/profiles/:name', async (c) => {
    const harnessId = harnesses.require(c.req.param('harnessId'));
    const name = decodeURIComponent(c.req.param('name'));
    const body = await readBody(c.req.json.bind(c.req));
    const profile = profiles.upsert(
      harnessId,
      {
        name,
        baseUrl: body.baseUrl,
        apiKey: body.apiKey,
        model: body.model,
        notes: body.notes,
        extras: body.extras,
        overrides: body.overrides,
      },
      false,
    );
    // Editing the live provider must reach the live files immediately, otherwise the UI
    // would show the new values while the tool keeps using the old ones.
    activation.reapplyIfActive(harnessId, name);
    return c.json(profile);
  });

  app.delete('/:harnessId/profiles/:name', (c) => {
    const harnessId = harnesses.require(c.req.param('harnessId'));
    const name = decodeURIComponent(c.req.param('name'));
    activation.prepareDelete(harnessId, name);
    profiles.remove(harnessId, name);
    return c.json({ ok: true });
  });

  app.get('/:harnessId/profiles/:name/preview', (c) => {
    const harnessId = harnesses.require(c.req.param('harnessId'));
    const name = decodeURIComponent(c.req.param('name'));
    return c.json({ targets: activation.preview(harnessId, name) });
  });

  app.post('/:harnessId/profiles/:name/activate', (c) => {
    const harnessId = harnesses.require(c.req.param('harnessId'));
    const name = decodeURIComponent(c.req.param('name'));
    const result = activation.activate(harnessId, name);
    return c.json({ ok: true, envFile: result.envFile, warnings: result.warnings });
  });

  return app;
}

async function readBody(read: () => Promise<ProfileBody>): Promise<ProfileBody> {
  return read().catch(() => {
    throw new HttpError(400, 'invalid json');
  });
}
