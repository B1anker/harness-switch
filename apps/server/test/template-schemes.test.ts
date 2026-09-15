import { afterEach, beforeEach, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import {
  createFavoriteRequestSchema,
  ERROR_CODES,
  type FavoriteInput,
  type ModelFavorite,
  remapFavoriteConnections,
  type ToolModelsPreview,
} from '@seaveyon/harness-switch-shared';
import { IAdapterRegistry } from '../src/services/adapters';
import { parseTomlObject, parseYamlDocument } from '../src/services/adapters/serialize';
import { IFileService } from '../src/services/files';
import { createSandbox, createTestApp, type Sandbox } from './support';

let sandbox: Sandbox;
beforeEach(() => {
  sandbox = createSandbox('hsw-template-scheme');
});
afterEach(() => sandbox.dispose());

function scheme(
  protocol: 'openai-responses' | 'anthropic-messages' = 'openai-responses',
): FavoriteInput {
  const groupId = randomUUID();
  const ids = [randomUUID(), randomUUID()];
  return createFavoriteRequestSchema.parse({
    name: 'daily',
    defaultConnectionId: ids[0],
    defaults: {
      contextWindow: 128000,
      reasoningSupported: true,
      supportedReasoningEfforts: ['low', 'high'],
    },
    connections: ids.map((id, index) => ({
      id,
      groupId,
      label: 'shared',
      providerId: 'vault',
      endpointKey: 'api',
      protocol,
      requestModelId: `vendor/model-${index}`,
      factOverrides: { contextWindow: 128000 + index * 128000 },
    })),
    toolBindings:
      protocol === 'anthropic-messages'
        ? {
            claude: {
              connectionId: groupId,
              mode: 'tiers',
              tiers: { opus: ids[0], sonnet: ids[1], haiku: ids[1] },
            },
          }
        : { codex: { connectionId: groupId, modelIds: ids, reasoningEffort: 'high' } },
  });
}

test('legacy templates parse, while model groups reject mixed routes and dangling defaults', () => {
  const draft = scheme();
  const legacy = {
    ...draft,
    defaultConnectionId: undefined,
    toolBindings: undefined,
    connections: [{ ...draft.connections[0], groupId: undefined }],
  };
  expect(createFavoriteRequestSchema.safeParse(legacy).success).toBe(true);
  expect(
    createFavoriteRequestSchema.safeParse({ ...draft, defaultConnectionId: randomUUID() }).success,
  ).toBe(false);
  expect(
    createFavoriteRequestSchema.safeParse({
      ...draft,
      connections: draft.connections.map((entry, index) => ({
        ...entry,
        providerId: index ? 'other' : entry.providerId,
      })),
    }).success,
  ).toBe(false);
  const copied = remapFavoriteConnections(scheme('anthropic-messages'), () => randomUUID());
  expect(createFavoriteRequestSchema.safeParse(copied).success).toBe(true);
  expect(copied.toolBindings?.claude?.tiers?.sonnet).toBe(copied.connections[1]!.id);
  expect(copied.defaultConnectionId).toBe(copied.connections[0]!.id);
});

test('Claude tiers use exact request IDs and reject a mapping across separate connections', async () => {
  const app = await createTestApp();
  const adapter = app.services.get(IAdapterRegistry).get('claude');
  const draft = scheme('anthropic-messages');
  const projection = adapter.projectFavorite(draft, draft.connections[0]!);
  expect(projection.blockers).toEqual([]);
  expect(projection.projection.extras).toMatchObject({
    opusModel: 'vendor/model-0',
    sonnetModel: 'vendor/model-1',
    haikuModel: 'vendor/model-1',
  });
  const invalid = structuredClone(draft);
  invalid.connections[1]!.groupId = randomUUID();
  expect(createFavoriteRequestSchema.safeParse(invalid).success).toBe(false);
  expect(adapter.projectFavorite(invalid, invalid.connections[0]!).blockers.length).toBeGreaterThan(
    0,
  );
});

test('DSH reports unspecified reasoning levels precisely without a generic unsupported capability warning', async () => {
  const app = await createTestApp();
  const adapter = app.services.get(IAdapterRegistry).get('dsh');
  const favorite = scheme();
  favorite.toolBindings = {};
  favorite.defaults = { reasoningSupported: true };
  const result = adapter.projectFavorite(favorite, favorite.connections[0]!);
  expect(result.blockers).toEqual([]);
  expect(result.notRepresented).not.toContain('reasoningSupported');
  expect(result.warnings).toContainEqual({ code: ERROR_CODES.favoriteReasoningLevelsMissing });
  expect(result.projection.extras.reasoningEfforts).toBeUndefined();
});

test('Codex writes a model catalog with per-model facts, and official mode stops using it', async () => {
  const app = await createTestApp();
  const adapter = app.services.get(IAdapterRegistry).get('codex');
  const draft = scheme();
  const projection = adapter.projectFavorite(draft, draft.connections[0]!);
  const profile = {
    favoriteManaged: true,
    name: 'daily',
    model: 'vendor/model-0',
    baseUrl: 'https://example.com/v1',
    apiKey: 'fixture-only',
    extras: Object.fromEntries(
      Object.entries(projection.projection.extras).filter(
        (entry): entry is [string, string] => entry[1] !== null,
      ),
    ),
  };
  const rendered = adapter.render(profile, {});
  const config = parseTomlObject(rendered.config);
  const catalog = JSON.parse(rendered.modelCatalog!);
  expect(config.model).toBe('vendor/model-0');
  expect(config.model_reasoning_effort).toBe('high');
  expect(
    catalog.models.map((entry: { slug: string; context_window: number }) => [
      entry.slug,
      entry.context_window,
    ]),
  ).toEqual([
    ['vendor/model-0', 128000],
    ['vendor/model-1', 256000],
  ]);
  expect(rendered.modelCatalog).not.toContain('fixture-only');
  expect(
    parseTomlObject(adapter.renderOfficial!(profile, rendered).config).model_catalog_json,
  ).toBeUndefined();
  const inherited = adapter.render(
    { ...profile, extras: { ...profile.extras, reasoningEffort: '' } },
    rendered,
  );
  expect(parseTomlObject(inherited.config).model_reasoning_effort).toBeUndefined();
});

test.each(['kimi', 'dsh'] as const)(
  '%s applies both models from one template with independent facts and an explicit default',
  async (harness) => {
    const app = await createTestApp();
    const { provider } = await app.postJson<{ provider: { id: string } }>('/api/providers', {
      name: 'shared',
      apiKey: 'fixture-only',
      endpoints: [{ key: 'api', baseUrl: 'https://example.com/v1' }],
    });
    const draft = scheme();
    draft.toolBindings = {};
    draft.connections = draft.connections.map((entry) => ({ ...entry, providerId: provider.id }));
    const { data: favorite } = await app.postJson<{ data: ModelFavorite }>(
      '/api/model-favorites',
      draft,
    );
    const path = `/api/tool-models/${harness}`;
    const request = {
      expectedRevision: 0,
      draft: {
        items: favorite.connections.map((entry) => ({
          id: entry.id,
          source: { kind: 'favorite', favoriteId: favorite.id, connectionId: entry.id },
          factOverrides: {},
          preferenceOverrides: {},
        })),
        defaultItemId: favorite.connections[1]!.id,
      },
    };
    const { data: preview } = await app.postJson<{ data: ToolModelsPreview }>(
      `${path}/preview`,
      request,
    );
    expect(preview.items.map((entry) => entry.model)).toEqual(['vendor/model-0', 'vendor/model-1']);
    expect(JSON.stringify(preview)).not.toContain('fixture-only');
    await app.postJson(`${path}/apply`, { planId: preview.id });
    const adapter = app.services.get(IAdapterRegistry).get(harness);
    const target = adapter
      .targets()
      .find((entry) => entry.key === (harness === 'kimi' ? 'config' : 'settings'))!;
    const content = app.services.get(IFileService).readOptional(target.path)!;
    if (harness === 'kimi') {
      const config = parseTomlObject(content);
      expect(config.default_model).toBe(`hsw-model-${favorite.connections[1]!.id}`);
      expect(
        Object.values(config.models as Record<string, { max_context_size: number }>)
          .map((entry) => entry.max_context_size)
          .toSorted(),
      ).toEqual([128000, 256000]);
    } else {
      const yaml = parseYamlDocument(content).toJSON();
      expect(JSON.stringify(yaml)).toContain('vendor/model-0');
      expect(JSON.stringify(yaml)).toContain('vendor/model-1');
      expect(JSON.stringify(yaml)).toContain('256000');
    }
  },
);
