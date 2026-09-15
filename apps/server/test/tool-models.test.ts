import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import {
  ERROR_CODES,
  type ModelFavorite,
  type ToolModelsHarness,
  type ToolModelsPreview,
  type ToolModelsRequest,
  type ToolModelsState,
} from '@seaveyon/harness-switch-shared';
import { IActivationService } from '../src/services/activation';
import { IAdapterRegistry } from '../src/services/adapters';
import { parseTomlObject, parseYamlDocument } from '../src/services/adapters/serialize';
import { IDriftService } from '../src/services/drift';
import { IEnvironmentService } from '../src/services/environment';
import { IFavoriteBackupService } from '../src/services/favorite-backup';
import { IFileService } from '../src/services/files';
import { IJournalService } from '../src/services/journal';
import { IProfileService } from '../src/services/profiles';
import { IToolModelsService } from '../src/services/tool-models';
import { asSession, createSandbox, createTestApp, loginAgain, type Sandbox } from './support';
import { expectResponseError } from './support/http-error';

let sandbox: Sandbox;
beforeEach(() => {
  sandbox = createSandbox('hsw-tool-models');
});
afterEach(() => sandbox.dispose());

async function setup(harness: ToolModelsHarness) {
  const app = await createTestApp();
  const { provider } = await app.postJson<{ provider: { id: string } }>('/api/providers', {
    name: 'shared',
    apiKey: 'collection-test-secret',
    endpoints: [{ key: 'api', baseUrl: 'https://example.com/v1' }],
  });
  const favorites: ModelFavorite[] = [];
  for (const [index, contextWindow] of [128000, 262144].entries()) {
    favorites.push(
      (
        await app.postJson<{ data: ModelFavorite }>('/api/model-favorites', {
          name: `model-${index}`,
          defaults: {
            contextWindow,
            maxOutputTokens: 8000 + index,
            reasoningSupported: true,
            supportedReasoningEfforts: ['low', 'high'],
          },
          connections: [
            {
              id: randomUUID(),
              label: 'shared',
              providerId: provider.id,
              endpointKey: 'api',
              protocol: 'openai-chat',
              requestModelId: `request-${index}`,
            },
          ],
        })
      ).data,
    );
  }
  const request: ToolModelsRequest = {
    expectedRevision: 0,
    draft: {
      items: favorites.map((favorite) => ({
        id: randomUUID(),
        source: {
          kind: 'favorite',
          favoriteId: favorite.id,
          connectionId: favorite.connections[0]!.id,
        },
        factOverrides: {},
        preferenceOverrides: {},
      })),
      defaultItemId: null,
    },
  };
  const path = `/api/tool-models/${harness}`;
  const models = app.services.get(IToolModelsService);
  const files = app.services.get(IFileService);
  const adapter = app.services.get(IAdapterRegistry).get(harness);
  const current = () =>
    Object.fromEntries(
      adapter.targets().map((target) => [target.key, files.readOptional(target.path)]),
    );
  const plan = async (input = request) =>
    (await app.postJson<{ data: ToolModelsPreview }>(`${path}/preview`, input)).data;
  const apply = async (input = request) => {
    const preview = await plan(input);
    return (await app.postJson<{ data: ToolModelsState }>(`${path}/apply`, { planId: preview.id }))
      .data;
  };
  return { app, path, request, plan, apply, models, files, adapter, current, favorites };
}

for (const harness of ['kimi', 'dsh'] as const) {
  test(`${harness}: save is metadata-only; apply shares credentials, keeps independent facts and default`, async () => {
    const { app, path, request, plan, files, adapter, current } = await setup(harness);
    const saved = await app.request(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    expect(saved.status).toBe(200);
    expect(Object.values(current()).every((value) => value === undefined)).toBe(true);
    expect(app.services.get(IProfileService).list(harness)).toHaveLength(0);
    request.expectedRevision = 1;
    request.draft.defaultItemId = request.draft.items[1]!.id;
    request.draft.items[0]!.factOverrides.contextWindow = 99000;
    const preview = await plan();
    expect(JSON.stringify(preview)).not.toContain('collection-test-secret');
    const applied = await app.postJson<{ data: ToolModelsState }>(`${path}/apply`, {
      planId: preview.id,
    });
    expect(applied.data.applied).toHaveLength(2);
    expect(applied.data.nativeStatus).toBe('in-sync');
    expect(app.services.get(IActivationService).getActive(harness)?.model).toBe('request-1');
    const detected = adapter.detect!(current());
    expect(detected.map((item) => item.model).toSorted()).toEqual(['request-0', 'request-1']);
    expect(detected.find((item) => item.active)?.model).toBe('request-1');
    if (harness === 'kimi') {
      const config = parseTomlObject(current().config);
      expect(Object.keys(config.providers as object)).toHaveLength(1);
      expect(
        Object.values(config.models as Record<string, { max_context_size: number }>)
          .map((model) => model.max_context_size)
          .toSorted(),
      ).toEqual([99000, 262144].toSorted());
    } else {
      const doc = parseYamlDocument(current().settings);
      const providers = doc.toJSON()['llm-pi-ai'].providers;
      expect(Object.keys(providers)).toHaveLength(1);
      const models = Object.values(providers)[0] as {
        models: Array<{ id: string; contextWindow: number; maxTokens: number }>;
      };
      expect(models.models.find((item) => item.id === 'request-0')?.contextWindow).toBe(99000);
      expect(models.models.find((item) => item.id === 'request-1')?.maxTokens).toBe(8001);
    }
    const before = current();
    await app.postJson(`${path}/apply`, { planId: preview.id });
    expect(current()).toEqual(before);
    const activeProfile = applied.data.applied[1]!.profile;
    const other = applied.data.applied[0]!.profile;
    const otherProfile = app.services.get(IProfileService).decrypt(harness, other);
    const revoked = adapter.revoke!(otherProfile, current());
    for (const target of adapter.targets()) {
      if (revoked[target.key]) {
        files.writeUserFile(target.path, revoked[target.key]!);
      }
    }
    expect(app.services.get(IDriftService).inspect(harness).status).not.toBe('in-sync');
    expect(app.services.get(IToolModelsService).get(harness).nativeStatus).toBe('drifted');
    app.services.get(IActivationService).activate(harness, activeProfile);
    expect(
      adapter.detect!(current())
        .map((item) => item.model)
        .toSorted(),
    ).toEqual(['request-0', 'request-1']);
  });

  test(`${harness}: removing one model retains sibling credential and keeps the default`, async () => {
    const { app, request, apply, current, adapter, path } = await setup(harness);
    request.draft.defaultItemId = request.draft.items[1]!.id;
    const state = await apply();
    const next = {
      expectedRevision: state.revision,
      draft: { items: [request.draft.items[1]!], defaultItemId: null },
    };
    await apply(next);
    const models = adapter.detect!(current());
    expect(models).toHaveLength(1);
    expect(models[0]!.model).toBe('request-1');
    expect(models[0]!.apiKey).toBe('collection-test-secret');
    expect(models[0]!.active).toBe(true);
    expect(app.services.get(IProfileService).list(harness)).toHaveLength(1);
    await expectResponseError(
      await app.post(`${path}/preview`, {
        expectedRevision: 2,
        draft: { items: [], defaultItemId: null },
      }),
      ERROR_CODES.toolModelsDefaultRequired,
    );
  });

  test(`${harness}: registration preserves external defaults and unrelated configuration`, async () => {
    const { request, apply, files, current, adapter } = await setup(harness);
    const original = adapter.render(
      {
        name: 'external',
        model: 'external-model',
        baseUrl: 'https://elsewhere.example',
        apiKey: 'external-secret',
        extras: {},
      },
      {},
    );
    for (const target of adapter.targets()) {
      files.writeUserFile(target.path, original[target.key]!);
    }
    await apply(request);
    const detected = adapter.detect!(current());
    expect(detected).toHaveLength(3);
    expect(detected.find((item) => item.active)?.model).toBe('external-model');
  });
}

test('previews are session-bound and reject changed native files', async () => {
  const { app, path, plan, files, adapter } = await setup('kimi');
  const preview = await plan();
  const second = asSession(app, await loginAgain(app));
  await expectResponseError(
    await second.post(`${path}/apply`, { planId: preview.id }),
    ERROR_CODES.favoritePlanExpired,
  );
  files.writeUserFile(adapter.targets()[0]!.path, 'default_model = "external"\n');
  await expectResponseError(
    await app.post(`${path}/apply`, { planId: preview.id }),
    ERROR_CODES.favoritePlanStale,
  );
});

test('transaction failure rolls back native files, profiles, active pointer and collection together', async () => {
  const { app, request, plan, path, files, current } = await setup('dsh');
  request.draft.defaultItemId = request.draft.items[0]!.id;
  const preview = await plan();
  const environment = app.services.get(IEnvironmentService);
  const write = files.writeJson.bind(files);
  const failing = spyOn(files, 'writeJson').mockImplementation((filePath, value) => {
    if (filePath === environment.files.toolModels) {
      throw new Error('injected collection write failure');
    }
    write(filePath, value);
  });
  try {
    expect((await app.post(`${path}/apply`, { planId: preview.id })).status).toBe(500);
  } finally {
    failing.mockRestore();
  }
  expect(Object.values(current()).every((value) => value === undefined)).toBe(true);
  expect(app.services.get(IProfileService).list('dsh')).toHaveLength(0);
  expect(app.services.get(IActivationService).getActive('dsh')).toBeNull();
  expect(files.readOptional(environment.files.toolModels)).toBeUndefined();
  expect(
    app.services
      .get(IJournalService)
      .list()
      .some((entry) => entry.state === 'rolled-back'),
  ).toBe(true);
});

test('unknown collection versions remain untouched and stale drafts cannot overwrite saves', async () => {
  const { app, models, request, files } = await setup('kimi');
  models.save('kimi', request);
  expect(() => models.save('kimi', request)).toThrow();
  const path = app.services.get(IEnvironmentService).files.toolModels;
  files.writeJson(path, { version: 100, collections: {} });
  const before = files.readOptional(path);
  expect(() => models.get('kimi')).toThrow();
  expect(files.readOptional(path)).toBe(before);
});

test('all credential file values are redacted, including unrelated reference names', async () => {
  const { plan, files, adapter } = await setup('dsh');
  files.writeUserFile(
    adapter.targets().find((target) => target.key === 'credentials')!.path,
    'version: 1\nrefs:\n  custom: unrelated-secret\n',
  );
  expect(JSON.stringify(await plan())).not.toContain('unrelated-secret');
});

test('legacy active profiles start as a singleton and adding models does not change their default', async () => {
  const { app, models, request, apply, adapter, current } = await setup('kimi');
  app.services.get(IProfileService).upsert(
    'kimi',
    {
      name: 'legacy',
      model: 'legacy-model',
      baseUrl: 'https://legacy.example',
      apiKey: 'legacy-key',
    },
    true,
  );
  app.services.get(IActivationService).activate('kimi', 'legacy');
  const initial = models.get('kimi');
  expect(initial.draft.items).toHaveLength(1);
  expect(initial.draft.items[0]!.source).toEqual({ kind: 'profile', name: 'legacy' });
  request.draft.items.unshift(initial.draft.items[0]!);
  await apply();
  expect(adapter.detect!(current()).find((item) => item.active)?.model).toBe('legacy-model');
  expect(app.services.get(IActivationService).getActive('kimi')?.name).toBe('legacy');
});

test('changing a template model removes its previous native slot without deleting siblings', async () => {
  const { app, favorites, request, apply, adapter, current } = await setup('dsh');
  request.draft.defaultItemId = request.draft.items[0]!.id;
  await apply();
  const favorite = favorites[0]!;
  await app.patch(`/api/model-favorites/${favorite.id}`, {
    expectedRevision: 1,
    connections: [{ ...favorite.connections[0], requestModelId: 'replacement-model' }],
  });
  request.expectedRevision = 1;
  await apply();
  expect(
    adapter.detect!(current())
      .map((item) => item.model)
      .toSorted(),
  ).toEqual(['replacement-model', 'request-1']);
  expect(adapter.detect!(current()).find((item) => item.active)?.model).toBe('replacement-model');
});

test('full backups restore the collection, its profiles and native model slots together', async () => {
  const { app, models, request, apply, adapter, current } = await setup('dsh');
  request.draft.defaultItemId = request.draft.items[1]!.id;
  await apply();
  const backups = app.services.get(IFavoriteBackupService);
  const checkpoint = backups.create();
  await apply({
    expectedRevision: 1,
    draft: { items: [request.draft.items[1]!], defaultItemId: null },
  });
  expect(adapter.detect!(current())).toHaveLength(1);
  backups.restore(checkpoint.id, backups.preview(checkpoint.id).fingerprint);
  expect(models.get('dsh').applied).toHaveLength(2);
  expect(models.get('dsh').nativeStatus).toBe('in-sync');
  expect(adapter.detect!(current())).toHaveLength(2);
});

test('duplicate native model routes and inconsistent per-tool reasoning settings are rejected before saving', async () => {
  const { app, favorites, path, request, models } = await setup('dsh');
  const duplicate = {
    ...request,
    draft: {
      ...request.draft,
      items: [request.draft.items[0]!, { ...request.draft.items[0]!, id: randomUUID() }],
    },
  };
  expect((await app.post(`${path}/preview`, duplicate)).status).toBe(400);
  request.draft.items[0]!.factOverrides = { reasoningSupported: false };
  expect((await app.post(`${path}/preview`, request)).status).toBe(400);
  expect(models.get('dsh').revision).toBe(0);
  expect(favorites[0]!.defaults.contextWindow).toBe(128000);
});
