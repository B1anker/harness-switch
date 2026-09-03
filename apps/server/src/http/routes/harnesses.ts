import {
  createProfileRequestSchema,
  ERROR_CODES,
  type HarnessId,
  type ProbeResponse,
  probeStoredRequestSchema,
  updateProfileRequestSchema,
} from '@seaveyon/harness-switch-shared';
import { Hono } from 'hono';
import { HttpError } from '../../common/errors';
import type { InstantiationService } from '../../di';
import { IActivationService } from '../../services/activation';
import { IAdapterRegistry } from '../../services/adapters';
import { IEnvironmentService } from '../../services/environment';
import { IFileService } from '../../services/files';
import { ILogService } from '../../services/log';
import { IProbeService } from '../../services/probe';
import { IProfileService } from '../../services/profiles';
import { IHarnessRegistry } from '../../services/registry';
import { parseWith, readJsonBody } from '../validate';

export function createHarnessRoutes(services: InstantiationService): Hono {
  const app = new Hono();
  const harnesses = services.get(IHarnessRegistry);
  const profiles = services.get(IProfileService);
  const activation = services.get(IActivationService);
  const adapters = services.get(IAdapterRegistry);
  const environment = services.get(IEnvironmentService);
  const files = services.get(IFileService);
  const log = services.get(ILogService);
  const probe = services.get(IProbeService);

  function summary(id: HarnessId) {
    const adapter = adapters.get(id);
    const targets = adapter.targets();
    const current = adapter.officialNeedsCurrent
      ? Object.fromEntries(targets.map((target) => [target.key, files.readOptional(target.path)]))
      : {};
    const capability = adapter.official?.(current);
    const profileList = profiles.list(id);
    const linkedProfile = capability?.matchesProfile
      ? profileList.find(capability.matchesProfile)
      : undefined;
    return {
      id,
      label: harnesses.label(id),
      mode: adapter.mode,
      active: activation.getActive(id),
      profiles: profileList,
      fields: adapter.fields,
      modelRequired: adapter.modelRequired,
      targets,
      envVars: adapter.envVarNames,
      envNote: adapter.envNote,
      envNoteCode: adapter.envNoteCode,
      ...(capability
        ? {
            official: {
              kind: capability.kind,
              available: capability.available,
              active: activation.getActive(id)?.official === true,
              titleCode: capability.titleCode,
              hintCode: capability.hintCode,
              ...(linkedProfile ? { linkedProfileName: linkedProfile.name } : {}),
            },
          }
        : {}),
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
    const body = await readJsonBody(c, createProfileRequestSchema);
    // A server-side copy may inherit its `providerType` when the request leaves
    // `extras` absent. Check the eventual type, not just the untrusted payload.
    const copiedProviderType = body.copySourceName
      ? profiles.get(harnessId, body.copySourceName)?.extras.providerType
      : undefined;
    if (
      harnessId === 'dsh' &&
      (body.extras?.providerType ?? copiedProviderType) === 'official' &&
      profiles.list('dsh').some((profile) => profile.extras.providerType === 'official')
    ) {
      throw new HttpError(409, 'DeepSeek 官方配置已存在，请直接编辑现有官方配置', {
        code: ERROR_CODES.officialProfileAlreadyExists,
      });
    }
    const profile = profiles.upsert(
      harnessId,
      {
        name: body.name,
        copySourceName: body.copySourceName,
        baseUrl: body.baseUrl,
        apiKey: body.apiKey,
        model: body.model,
        notes: body.notes,
        extras: body.extras,
        overrides: body.overrides,
        providerId: body.providerId,
        providerEndpoint: body.providerEndpoint,
      },
      true,
    );
    try {
      activation.syncProfile(harnessId, profile.name);
    } catch (error) {
      profiles.remove(harnessId, profile.name);
      throw error;
    }
    return c.json(profile, 201);
  });

  app.patch('/:harnessId/profiles/:name', async (c) => {
    const harnessId = harnesses.require(c.req.param('harnessId'));
    const name = decodeURIComponent(c.req.param('name'));
    const body = await readJsonBody(c, updateProfileRequestSchema);
    const wasActive = activation.getActive(harnessId)?.name === name;
    // Snapshot the store before touching it: a live-file rewrite that fails part
    // way must not leave the persisted profile, the active pointer and the live
    // files each pointing at a different state.
    const snapshot = files.readOptional(environment.files.profiles);
    let persisted = false;
    try {
      const profile = profiles.upsert(
        harnessId,
        {
          name: body.name ?? name,
          sourceName: name,
          baseUrl: body.baseUrl,
          apiKey: body.apiKey,
          model: body.model,
          notes: body.notes,
          extras: body.extras,
          overrides: body.overrides,
          providerId: body.providerId,
          providerEndpoint: body.providerEndpoint,
        },
        false,
      );
      persisted = true;
      // Editing the live provider must reach the live files immediately, otherwise the UI
      // would show the new values while the tool keeps using the old ones.
      activation.reconcileProfileUpdate(harnessId, name, profile.name);
      activation.syncProfile(harnessId, profile.name);
      return c.json(profile);
    } catch (error) {
      if (persisted) {
        restoreProfileStore(files, environment.files.profiles, snapshot);
        if (wasActive) {
          try {
            // Put the live files and the active pointer back on the previous
            // profile so the edit is fully undone, not half-applied.
            activation.activate(harnessId, name);
          } catch (rollbackError) {
            log.error(`edit rollback: failed to re-activate ${harnessId}/${name}`, rollbackError);
          }
        }
      }
      throw error;
    }
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

  app.get('/:harnessId/official/preview', (c) => {
    const harnessId = harnesses.require(c.req.param('harnessId'));
    return c.json({ targets: activation.previewOfficial(harnessId) });
  });

  app.post('/:harnessId/profiles/:name/probe', async (c) => {
    const harnessId = harnesses.require(c.req.param('harnessId'));
    const name = decodeURIComponent(c.req.param('name'));
    // An absent body is fine: the request carries no options today.
    parseWith(probeStoredRequestSchema, await c.req.json().catch(() => ({})));
    const decrypted = profiles.decrypt(harnessId, name);
    return c.json({ result: await probe.probe(decrypted) } satisfies ProbeResponse);
  });

  app.post('/:harnessId/profiles/:name/activate', (c) => {
    const harnessId = harnesses.require(c.req.param('harnessId'));
    const name = decodeURIComponent(c.req.param('name'));
    const result = activation.activate(harnessId, name);
    return c.json({ ok: true, envFile: result.envFile, warnings: result.warnings });
  });

  app.post('/:harnessId/official/activate', (c) => {
    const harnessId = harnesses.require(c.req.param('harnessId'));
    const result = activation.activateOfficial(harnessId);
    return c.json({ ok: true, envFile: result.envFile, warnings: result.warnings });
  });

  return app;
}

function restoreProfileStore(
  files: IFileService,
  path: string,
  snapshot: string | undefined,
): void {
  if (snapshot === undefined) {
    files.remove(path);
    return;
  }
  files.writeSecure(path, snapshot);
}
