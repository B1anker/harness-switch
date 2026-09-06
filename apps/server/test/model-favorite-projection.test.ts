import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import {
  createFavoriteRequestSchema,
  type FavoriteInput,
  resolveFavorite,
} from '@seaveyon/harness-switch-shared';
import { IAdapterRegistry } from '../src/services/adapters';
import { parseYamlDocument } from '../src/services/adapters/serialize';
import { IEnvironmentService } from '../src/services/environment';
import { IFileService } from '../src/services/files';
import { IModelFavoriteStore } from '../src/services/model-favorite-store';
import { createSandbox, createTestServices, type Sandbox } from './support';

let sandbox: Sandbox;
beforeEach(() => {
  sandbox = createSandbox('hsw-favorites');
});
afterEach(() => sandbox.dispose());

function fixture(): FavoriteInput {
  return createFavoriteRequestSchema.parse({
    name: 'daily',
    defaults: {
      contextWindow: 200000,
      maxOutputTokens: 8000,
      reasoningSupported: true,
      supportedReasoningEfforts: ['low', 'high'],
    },
    preferences: { reasoningEffort: 'high' },
    connections: [
      {
        id: randomUUID(),
        label: 'primary',
        providerId: 'vault',
        endpointKey: 'api',
        protocol: 'openai-responses',
        requestModelId: ' vendor/Model-1 ',
      },
    ],
  });
}

describe('favorite contracts and adapter projections', () => {
  test('Claude cannot hide a controlled model override inside extra environment values', () => {
    const adapter = createTestServices().get(IAdapterRegistry).get('claude');
    const profile = {
      name: 'daily',
      apiKey: 'test-key',
      baseUrl: 'https://example.com',
      model: 'primary',
      favoriteManaged: true,
      extras: { extraEnv: 'ANTHROPIC_MODEL=other' },
    };
    expect(() => adapter.validate?.(profile)).toThrow();
    expect(() => adapter.extractFavorite(profile)).toThrow();
  });
  test('DSH keeps secondary native model declarations when a favorite changes the primary', () => {
    const adapter = createTestServices().get(IAdapterRegistry).get('dsh');
    const secondary = {
      id: 'secondary',
      name: 'Secondary',
      contextWindow: 10000,
      maxTokens: 4000,
      reasoningEfforts: false,
    };
    const output = adapter.render(
      {
        name: 'daily',
        apiKey: 'test-key',
        baseUrl: 'https://example.com',
        model: 'primary',
        favoriteManaged: true,
        extras: {
          providerId: 'native',
          models: 'secondary',
          contextWindow: '200000',
          maxTokens: '8000',
        },
      },
      {
        settings: JSON.stringify({
          'llm-pi-ai': { providers: { native: { models: [secondary] } } },
        }),
      },
    );
    const settings = parseYamlDocument(output.settings).toJSON();
    expect(settings['llm-pi-ai'].providers.native.models[1]).toEqual(secondary);
  });
  test('resolves inheritance, explicit clearing and exact model IDs', () => {
    const value = fixture();
    const connection = value.connections[0]!;
    connection.factOverrides = { contextWindow: 128000, maxOutputTokens: null };
    connection.preferenceOverrides = { reasoningEffort: null };
    const result = resolveFavorite(value, connection);
    expect(connection.requestModelId).toBe('vendor/Model-1');
    expect(result.facts.contextWindow).toBe(128000);
    expect(result.facts.maxOutputTokens).toBeUndefined();
    expect(result.preferences).toEqual({});
    expect(result.sources.maxOutputTokens).toBe('unknown');
  });

  test('rejects contradictory declarations and duplicate channels', () => {
    const value = fixture();
    value.connections[0]!.factOverrides.reasoningSupported = false;
    expect(createFavoriteRequestSchema.safeParse(value).success).toBe(false);
    value.connections[0]!.factOverrides = {};
    value.connections.push({ ...value.connections[0]!, id: randomUUID() });
    expect(createFavoriteRequestSchema.safeParse(value).success).toBe(false);
    expect(
      createFavoriteRequestSchema.safeParse({
        ...fixture(),
        defaults: { contextWindow: 100000001 },
      }).success,
    ).toBe(false);
  });

  test('five adapters enforce their protocol matrix and map existing fields', () => {
    const adapters = createTestServices().get(IAdapterRegistry);
    const value = fixture();
    const connection = value.connections[0]!;
    for (const adapter of adapters.all()) {
      for (const protocol of ['openai-chat', 'openai-responses', 'anthropic-messages'] as const) {
        const result = adapter.projectFavorite(value, { ...connection, protocol });
        const allowed =
          adapter.id === 'codex'
            ? protocol === 'openai-responses'
            : adapter.id === 'claude'
              ? protocol === 'anthropic-messages'
              : true;
        expect(result.blockers.length === 0).toBe(allowed);
      }
    }
    expect(adapters.get('pi').projectFavorite(value, connection).projection.extras).toEqual({
      api: 'openai-responses',
      contextWindow: '200000',
      maxTokens: '8000',
      reasoning: 'true',
    });
    const dsh = adapters.get('dsh').projectFavorite(value, connection);
    expect(dsh.projection.extras.reasoningEfforts).toBe('low,high');
    expect(dsh.notRepresented).toContain('reasoningEffort');
    expect(
      adapters.get('codex').projectFavorite(value, connection).projection.extras.reasoningEffort,
    ).toBe('high');
  });

  test('removes only previously owned fields and reports renderer defaults', () => {
    const adapter = createTestServices().get(IAdapterRegistry).get('pi');
    const value = fixture();
    const connection = value.connections[0]!;
    const old = adapter.projectFavorite(value, connection).projection;
    const next = { ...value, defaults: {}, preferences: {} };
    const result = adapter.projectFavorite(next, connection, old);
    expect(result.remove).toContain('extras.maxTokens');
    expect(result.rendererDefaults.maxTokens).toBeTruthy();
    expect(adapter.projectFavorite(next, connection).remove).toEqual([]);
    expect(result.ownedFields).not.toContain('extras.providerId');
  });

  test('capture keeps declarations separate and rejects decorated request IDs', () => {
    const adapters = createTestServices().get(IAdapterRegistry);
    const profile = {
      name: 'daily',
      baseUrl: 'https://example.com',
      apiKey: 'test-key',
      model: 'model',
      extras: { api: 'openai-responses', reasoningEfforts: 'low,high' },
    };
    const result = adapters.get('dsh').extractFavorite(profile);
    expect(result.defaults.supportedReasoningEfforts).toEqual(['low', 'high']);
    expect(result.preferences).toEqual({});
    expect(() =>
      adapters.get('claude').extractFavorite({ ...profile, model: 'model[1m]' }),
    ).toThrow();
  });
});

describe('favorite store', () => {
  test('missing is empty; revisions use CAS and writes are private', () => {
    const services = createTestServices();
    const store = services.get(IModelFavoriteStore);
    expect(store.list()).toEqual([]);
    const favorite = store.create(fixture());
    expect(() => store.update(favorite.id, fixture(), undefined)).toThrow();
    expect(store.update(favorite.id, fixture(), 1).revision).toBe(2);
    expect(() => store.remove(favorite.id, 1)).toThrow();
    store.remove(favorite.id, 2);
    expect(store.list()).toEqual([]);
  });

  test('corrupt and unknown-version stores are never overwritten or quarantined', () => {
    const services = createTestServices();
    const files = services.get(IFileService);
    const path = services.get(IEnvironmentService).files.favorites;
    const store = services.get(IModelFavoriteStore);
    for (const content of ['{broken', '{"schemaVersion":2,"favorites":[]}']) {
      files.writeSecure(path, content);
      expect(() => store.create(fixture())).toThrow();
      expect(files.readText(path)).toBe(content);
    }
  });
});
