import { Hono } from 'hono';
import { HttpError } from '../../common/errors';
import type { InstantiationService } from '../../di';
import { IActivationService } from '../../services/activation';
import { IEnvironmentService } from '../../services/environment';
import { IProfileService } from '../../services/profiles';
import { IHarnessRegistry } from '../../services/registry';

export function createHarnessRoutes(services: InstantiationService): Hono {
  const app = new Hono();
  const harnesses = services.get(IHarnessRegistry);
  const profiles = services.get(IProfileService);
  const activation = services.get(IActivationService);
  const environment = services.get(IEnvironmentService);

  app.get('/', (c) => {
    return c.json({
      envFile: environment.files.env,
      items: harnesses.list().map((item) => ({
        id: item.id,
        label: item.label,
        active: activation.getActive(item.id),
        profiles: profiles.list(item.id),
      })),
    });
  });

  app.get('/:harnessId', (c) => {
    const harnessId = harnesses.require(c.req.param('harnessId'));
    return c.json({
      id: harnessId,
      label: harnesses.label(harnessId),
      active: activation.getActive(harnessId),
      profiles: profiles.list(harnessId),
    });
  });

  app.post('/:harnessId/profiles', async (c) => {
    const harnessId = harnesses.require(c.req.param('harnessId'));
    const body = await c.req
      .json<{
        name?: string;
        baseUrl?: string;
        apiKey?: string;
        model?: string;
        notes?: string;
      }>()
      .catch(() => {
        throw new HttpError(400, 'invalid json');
      });
    const profile = profiles.upsert(
      harnessId,
      {
        name: String(body.name ?? ''),
        baseUrl: body.baseUrl,
        apiKey: body.apiKey,
        model: body.model,
        notes: body.notes,
      },
      true,
    );
    return c.json(profile, 201);
  });

  app.patch('/:harnessId/profiles/:name', async (c) => {
    const harnessId = harnesses.require(c.req.param('harnessId'));
    const name = decodeURIComponent(c.req.param('name'));
    const body = await c.req
      .json<{
        baseUrl?: string;
        apiKey?: string;
        model?: string;
        notes?: string;
      }>()
      .catch(() => {
        throw new HttpError(400, 'invalid json');
      });
    const profile = profiles.upsert(
      harnessId,
      {
        name,
        baseUrl: body.baseUrl,
        apiKey: body.apiKey,
        model: body.model,
        notes: body.notes,
      },
      false,
    );
    return c.json(profile);
  });

  app.delete('/:harnessId/profiles/:name', (c) => {
    const harnessId = harnesses.require(c.req.param('harnessId'));
    profiles.remove(harnessId, decodeURIComponent(c.req.param('name')));
    return c.json({ ok: true });
  });

  app.post('/:harnessId/profiles/:name/activate', (c) => {
    const harnessId = harnesses.require(c.req.param('harnessId'));
    const envFile = activation.activate(harnessId, decodeURIComponent(c.req.param('name')));
    return c.json({ ok: true, envFile });
  });

  return app;
}
