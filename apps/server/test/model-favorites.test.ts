import { afterEach, beforeEach, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import {
  ERROR_CODES,
  type FavoritePlan,
  type ModelFavorite,
} from '@seaveyon/harness-switch-shared';
import { IActivationService } from '../src/services/activation';
import { ICryptoService } from '../src/services/crypto';
import { IEnvironmentService } from '../src/services/environment';
import { IFileService } from '../src/services/files';
import { IJournalService } from '../src/services/journal';
import { IModelFavoriteService } from '../src/services/model-favorite';
import { IModelFavoriteApplyService } from '../src/services/model-favorite-apply';
import { IModelFavoriteStore } from '../src/services/model-favorite-store';
import { IProfileService } from '../src/services/profiles';
import { ITransferService } from '../src/services/transfer';
import { createSandbox, createTestApp, type Sandbox } from './support';
import { expectResponseError } from './support/http-error';

let sandbox: Sandbox;
beforeEach(() => {
  sandbox = createSandbox('hsw-favorite-api');
});
afterEach(() => sandbox.dispose());

async function setup() {
  const app = await createTestApp();
  const { provider } = await app.postJson<{ provider: { id: string } }>('/api/providers', {
    name: 'channel',
    apiKey: 'test-secret-never-return',
    endpoints: [{ key: 'api', baseUrl: 'https://example.com' }],
  });
  const { data: favorite } = await app.postJson<{ data: ModelFavorite }>('/api/model-favorites', {
    name: 'daily',
    connections: [
      {
        id: randomUUID(),
        label: 'channel',
        providerId: provider.id,
        endpointKey: 'api',
        protocol: 'anthropic-messages',
        requestModelId: 'model',
      },
    ],
  });
  const plan = async (harness = 'pi', existing = false, mode = 'save') =>
    (
      await app.postJson<{ data: FavoritePlan }>('/api/model-favorite-plans', {
        favoriteId: favorite.id,
        expectedRevision: favorite.revision,
        items: [
          { harness, connectionId: favorite.connections[0]!.id, profile: 'daily', existing, mode },
        ],
      })
    ).data;
  return { app, favorite, provider, plan };
}

test('PATCH preserves omitted notes, facts and connections', async () => {
  const { app, favorite } = await setup();
  await app.patch(`/api/model-favorites/${favorite.id}`, {
    expectedRevision: 1,
    notes: 'keep this note',
    defaults: { contextWindow: 123000 },
  });
  const response = await app.patch(`/api/model-favorites/${favorite.id}`, {
    expectedRevision: 2,
    name: 'renamed',
  });
  expect(response.status).toBe(200);
  const { data } = (await response.json()) as { data: ModelFavorite };
  expect(data.connections).toEqual(favorite.connections);
  expect(data.notes).toBe('keep this note');
  expect(data.defaults.contextWindow).toBe(123000);
});

test('Codex login-cache writes require a specific plan approval and previews redact credentials', async () => {
  const { app, provider } = await setup();
  const profiles = app.services.get(IProfileService);
  profiles.upsert(
    'codex',
    {
      name: 'auth-cache',
      providerId: provider.id,
      providerEndpoint: 'api',
      model: 'model',
      extras: { authMode: 'openai_auth' },
    },
    true,
  );
  const favorites = app.services.get(IModelFavoriteService);
  const favorite = favorites.capture({
    harness: 'codex',
    name: 'auth-cache',
    favoriteName: 'auth favorite',
    sourceFingerprint: favorites.sourceFingerprint('codex', 'auth-cache'),
    linkSource: true,
  });
  const apply = app.services.get(IModelFavoriteApplyService);
  const item = {
    harness: 'codex' as const,
    connectionId: favorite.connections[0]!.id,
    profile: 'auth-cache',
    existing: true,
    mode: 'activate' as const,
    overwriteDiverged: false,
    ignorePreference: false,
  };
  const blocked = apply.plan(
    { favoriteId: favorite.id, expectedRevision: 1, items: [item] },
    'session',
  );
  expect(blocked.items[0]!.projection.blockers).toHaveLength(1);
  const approved = apply.plan(
    {
      favoriteId: favorite.id,
      expectedRevision: 1,
      items: [{ ...item, allowAuthOverwrite: true }],
    },
    'session',
  );
  expect(approved.items[0]!.projection.blockers).toEqual([]);
  expect(approved.items[0]!.nativeFiles.some((file) => file.key === 'auth')).toBe(true);
  expect(JSON.stringify(approved)).not.toContain('test-secret-never-return');
  expect(apply.apply(approved.id, randomUUID(), 'session').items[0]!.status).toBe('applied');
});

test('save-only generation never writes native files, is idempotent and protects linked fields', async () => {
  const { app, plan } = await setup();
  const prepared = await plan('dsh');
  expect(prepared.items[0]!.nativeFiles).toEqual([]);
  expect(JSON.stringify(prepared)).not.toContain('test-secret-never-return');
  const requestId = randomUUID();
  const result = await app.postJson<Record<string, unknown>>(
    `/api/model-favorite-plans/${prepared.id}/apply`,
    { requestId },
  );
  expect(
    await app.postJson<Record<string, unknown>>(`/api/model-favorite-plans/${prepared.id}/apply`, {
      requestId,
    }),
  ).toEqual(result);
  const files = app.services.get(IFileService);
  expect(files.exists(app.services.get(IEnvironmentService).files.active)).toBe(false);
  expect(files.exists(sandbox.home('.dsh/settings.yaml'))).toBe(false);
  const profile = app.services.get(IProfileService).get('dsh', 'daily')!;
  expect(profile.modelFavorite).toBeDefined();
  await expectResponseError(
    await app.patch('/api/harnesses/dsh/profiles/daily', { model: 'changed' }),
    ERROR_CODES.favoriteProfileDiverged,
  );
  expect((await app.patch('/api/harnesses/dsh/profiles/daily', { notes: 'my notes' })).status).toBe(
    200,
  );
});

test('references prevent deleting unused provider endpoints and linked favorites', async () => {
  const { app, provider, favorite, plan } = await setup();
  await expectResponseError(
    await app.del(`/api/providers/${provider.id}`),
    ERROR_CODES.favoriteInUse,
  );
  await expectResponseError(
    await app.patch(`/api/providers/${provider.id}`, {
      endpoints: [{ key: 'other', baseUrl: 'https://example.com' }],
    }),
    ERROR_CODES.favoriteEndpointMissing,
  );
  const prepared = await plan();
  await app.postJson(`/api/model-favorite-plans/${prepared.id}/apply`, { requestId: randomUUID() });
  await expectResponseError(
    await app.request(`/api/model-favorites/${favorite.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1 }),
    }),
    ERROR_CODES.favoriteInUse,
  );
});

test('revision and live changes invalidate plans without writes', async () => {
  const { app, favorite, plan } = await setup();
  const prepared = await plan();
  await app.patch(`/api/model-favorites/${favorite.id}`, { expectedRevision: 1, notes: 'changed' });
  await expectResponseError(
    await app.post(`/api/model-favorite-plans/${prepared.id}/apply`, { requestId: randomUUID() }),
    ERROR_CODES.favoritePlanStale,
  );
  expect(app.services.get(IProfileService).list('pi')).toEqual([]);
});

test('deleting a favorite invalidates its uncommitted plan without creating profiles', async () => {
  const { app, favorite, plan } = await setup();
  const prepared = await plan();
  const removed = await app.request(`/api/model-favorites/${favorite.id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedRevision: favorite.revision }),
  });
  expect(removed.status).toBe(200);
  await expectResponseError(
    await app.post(`/api/model-favorite-plans/${prepared.id}/apply`, { requestId: randomUUID() }),
    ERROR_CODES.favoritePlanStale,
  );
  expect(app.services.get(IProfileService).list('pi')).toEqual([]);
});

test('capture failure restores vault, favorites and profiles together', async () => {
  const { app } = await setup();
  const profiles = app.services.get(IProfileService);
  profiles.upsert(
    'pi',
    {
      name: 'inline',
      model: 'model',
      baseUrl: 'https://example.com',
      apiKey: 'inline-test-key',
      extras: { api: 'anthropic-messages' },
    },
    true,
  );
  const favorites = app.services.get(IModelFavoriteService);
  const files = app.services.get(IFileService);
  const environment = app.services.get(IEnvironmentService);
  const before = [
    environment.files.profiles,
    environment.files.vault,
    environment.files.favorites,
  ].map((path) => files.readOptional(path));
  const write = files.writeJson.bind(files);
  let failed = false;
  files.writeJson = (path, value) => {
    if (path === environment.files.favorites && !failed) {
      failed = true;
      throw new Error('injected failure');
    }
    write(path, value);
  };
  expect(() =>
    favorites.capture({
      harness: 'pi',
      name: 'inline',
      sourceFingerprint: favorites.sourceFingerprint('pi', 'inline'),
      favoriteName: 'capture',
      extractCredential: true,
      linkSource: true,
    }),
  ).toThrow();
  expect(
    [environment.files.profiles, environment.files.vault, environment.files.favorites].map((path) =>
      files.readOptional(path),
    ),
  ).toEqual(before);
});

test('undo refuses to discard profiles created after a favorite operation', async () => {
  const { app, plan } = await setup();
  const prepared = await plan();
  await app.postJson(`/api/model-favorite-plans/${prepared.id}/apply`, { requestId: randomUUID() });
  const journal = app.services.get(IJournalService);
  const operation = journal.list()[0]!;
  app.services
    .get(IProfileService)
    .upsert(
      'pi',
      { name: 'later', model: 'model', apiKey: 'test-key', baseUrl: 'https://example.com' },
      true,
    );
  expect(() => journal.undo(operation.id)).toThrow();
  expect(app.services.get(IProfileService).get('pi', 'later')).toBeDefined();
});

test('v2 preserves remapped relationships, skip keeps target links, and legacy export omits favorites', async () => {
  const { app, plan, favorite } = await setup();
  const prepared = await plan();
  await app.postJson(`/api/model-favorite-plans/${prepared.id}/apply`, { requestId: randomUUID() });
  const transfer = app.services.get(ITransferService);
  const envelope = transfer.exportAll('test-passphrase', false);
  const crypto = app.services.get(ICryptoService);
  const payload = JSON.parse(
    crypto.open({ salt: envelope.kdf.salt, ...envelope.cipher }, 'test-passphrase'),
  );
  expect(payload.version).toBe(2);
  expect(payload.favorites).toHaveLength(1);
  transfer.importAll(envelope, 'test-passphrase', 'skip', false, false);
  expect(app.services.get(IProfileService).get('pi', 'daily')!.modelFavorite!.favoriteId).toBe(
    favorite.id,
  );
  transfer.importAll(envelope, 'test-passphrase', 'overwrite', false, false);
  const imported = app.services.get(IProfileService).get('pi', 'daily')!;
  expect(imported.modelFavorite!.favoriteId).not.toBe(favorite.id);
  const copied = app.services.get(IModelFavoriteStore).get(imported.modelFavorite!.favoriteId);
  expect(copied.connections[0]!.id).toBe(imported.modelFavorite!.connectionId);
  expect(copied.connections[0]!.providerId).toBe(imported.providerId!);
  expect(imported.modelFavorite!.baseline.providerId).toBe(imported.providerId!);
  const legacy = transfer.exportAll('test-passphrase', false, true);
  const old = JSON.parse(
    crypto.open({ salt: legacy.kdf.salt, ...legacy.cipher }, 'test-passphrase'),
  );
  expect(old.version).toBe(1);
  expect(old.favorites).toBeUndefined();
  expect(old.profiles.every((profile: { modelFavorite?: unknown }) => !profile.modelFavorite)).toBe(
    true,
  );
});

test('batch rollback keeps the first item and continues the third, and receipts survive restart', async () => {
  const { app, favorite } = await setup();
  const { data: prepared } = await app.postJson<{ data: FavoritePlan }>(
    '/api/model-favorite-plans',
    {
      favoriteId: favorite.id,
      expectedRevision: favorite.revision,
      items: ['claude', 'pi', 'dsh'].map((harness) => ({
        harness,
        connectionId: favorite.connections[0]!.id,
        profile: 'batch',
      })),
    },
  );
  const profiles = app.services.get(IProfileService);
  const upsert = profiles.upsert.bind(profiles);
  profiles.upsert = (harness, input, create) => {
    if (harness === 'pi') {
      throw new Error('injected item failure');
    }
    return upsert(harness, input, create);
  };
  const requestId = randomUUID();
  const { data: result } = await app.postJson<{
    data: { items: Array<{ harness: string; status: string }> };
  }>(`/api/model-favorite-plans/${prepared.id}/apply`, { requestId });
  expect(result.items.map((item) => [item.harness, item.status])).toEqual([
    ['claude', 'applied'],
    ['pi', 'failed'],
    ['dsh', 'applied'],
  ]);
  expect(profiles.get('claude', 'batch')).toBeDefined();
  expect(profiles.get('pi', 'batch')).toBeUndefined();
  expect(profiles.get('dsh', 'batch')).toBeDefined();
  const restarted = await createTestApp();
  expect(
    restarted.services
      .get(IModelFavoriteApplyService)
      .operation(requestId)
      .items.map((item) => item.status),
  ).toEqual(['applied', 'failed', 'applied']);
});

test('activation rolls back profiles and active when native writing fails', async () => {
  const { app, plan } = await setup();
  const prepared = await plan('pi', false, 'activate');
  const files = app.services.get(IFileService);
  const write = files.writeUserFile.bind(files);
  files.writeUserFile = (path, content) => {
    if (path.endsWith('models.json')) {
      throw new Error('injected native write failure');
    }
    write(path, content);
  };
  await app.postJson(`/api/model-favorite-plans/${prepared.id}/apply`, { requestId: randomUUID() });
  expect(app.services.get(IProfileService).get('pi', 'daily')).toBeUndefined();
  expect(app.services.get(IActivationService).getActive('pi')).toBeNull();
});

test('active save updates are blocked, but a metadata-only favorite revision can be applied without native writes', async () => {
  const { app, plan, favorite } = await setup();
  const active = await plan('pi', false, 'activate');
  await app.postJson(`/api/model-favorite-plans/${active.id}/apply`, { requestId: randomUUID() });
  const favorites = app.services.get(IModelFavoriteStore);
  favorites.update(favorite.id, { ...favorite, notes: 'new note' }, 1);
  const apply = app.services.get(IModelFavoriteApplyService);
  const next = apply.plan(
    {
      favoriteId: favorite.id,
      expectedRevision: 2,
      items: [
        {
          harness: 'pi',
          connectionId: favorite.connections[0]!.id,
          profile: 'daily',
          existing: true,
          mode: 'save',
          ignorePreference: false,
          overwriteDiverged: false,
        },
      ],
    },
    'test-session',
  );
  expect(next.items[0]!.projection.blockers).toEqual([]);
  const result = apply.apply(next.id, randomUUID(), 'test-session');
  expect(result.items[0]!.status).toBe('unchanged');
  expect(app.services.get(IProfileService).get('pi', 'daily')!.modelFavorite!.appliedRevision).toBe(
    2,
  );
  favorites.update(
    favorite.id,
    {
      ...favorite,
      connections: favorite.connections.map((connection) => ({
        ...connection,
        requestModelId: 'other-model',
      })),
    },
    2,
  );
  const blocked = apply.plan(
    {
      favoriteId: favorite.id,
      expectedRevision: 3,
      items: [
        {
          harness: 'pi',
          connectionId: favorite.connections[0]!.id,
          profile: 'daily',
          existing: true,
          mode: 'save',
          ignorePreference: false,
          overwriteDiverged: false,
        },
      ],
    },
    'test-session',
  );
  expect(blocked.items[0]!.projection.blockers.map((item) => item.code)).toContain(
    ERROR_CODES.favoriteActiveUpdateRequiresApply,
  );
});
