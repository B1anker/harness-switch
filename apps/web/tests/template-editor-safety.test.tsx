import { beforeEach, expect, test } from '@rstest/core';
import {
  createFavoriteRequestSchema,
  type FavoriteInput,
  PROVIDER_PRESETS,
  resolveFavorite,
} from '@seaveyon/harness-switch-shared';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { FavoriteCreateDialog } from '@/components/model-favorites/create-dialog';
import {
  updateConnectionFacts,
  updateDefaultFacts,
} from '@/components/model-favorites/draft-facts';
import { FavoriteEditor } from '@/components/model-favorites/editor';
import {
  matchPresetConnections,
  presetProtocolForUrl,
} from '@/components/model-favorites/preset-connections';
import {
  favoriteFixture,
  OFFLINE,
  providerFixture,
  renderWithI18n,
  setStoreState,
  stubFetch,
  stubStoreActions,
} from './support';

beforeEach(() => stubFetch(OFFLINE));

test('both Kimi and MiniMax endpoints preserve their own protocol, including trailing slashes', () => {
  for (const id of ['kimi', 'minimax']) {
    const preset = PROVIDER_PRESETS.find((item) => item.id === id)!;
    const providers = preset.endpoints.map((endpoint) =>
      providerFixture({
        id: id + '-' + endpoint.key,
        endpoints: [{ key: 'custom-key', label: '', baseUrl: endpoint.baseUrl + '/' }],
      }),
    );
    const matches = matchPresetConnections(providers, preset);
    expect(matches.map((match) => match.protocol)).toEqual(['openai-chat', 'anthropic-messages']);
    expect(matches.every((match) => match.endpointKey === 'custom-key')).toBe(true);
    expect(presetProtocolForUrl(preset.endpoints[1]!.baseUrl)).toBe('anthropic-messages');
  }
  expect(presetProtocolForUrl('https://unknown.example/v1')).toBeUndefined();
});

test('multiple saved accounts require choosing an account before any preset is applied', async () => {
  const preset = PROVIDER_PRESETS.find((item) => item.id === 'kimi')!;
  const endpoint = preset.endpoints[1]!;
  const first = providerFixture({
    id: 'personal',
    name: '个人账号',
    endpoints: [{ key: 'anthropic', label: '', baseUrl: endpoint.baseUrl }],
  });
  const second = providerFixture({ ...first, id: 'work', name: '工作账号' });
  setStoreState({ providers: [first, second] });
  const selected: unknown[][] = [];
  renderWithI18n(
    <FavoriteCreateDialog
      onClose={() => undefined}
      onBlank={() => undefined}
      onCapture={() => undefined}
      onPreset={(...args) => selected.push(args)}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /快速创建（推荐）/ }));
  fireEvent.click(screen.getByRole('button', { name: /Kimi/ }));
  expect(selected).toHaveLength(0);
  fireEvent.click(await screen.findByRole('button', { name: /工作账号/ }));
  expect(selected).toEqual([[preset, second, 'anthropic', 'anthropic-messages']]);
});

test('new account creation uses the explicitly selected endpoint and matching protocol', async () => {
  const preset = PROVIDER_PRESETS.find((item) => item.id === 'minimax')!;
  const endpoint = preset.endpoints[1]!;
  const provider = providerFixture({
    id: 'minimax',
    endpoints: [{ key: endpoint.key, label: '', baseUrl: endpoint.baseUrl }],
  });
  const created: unknown[] = [];
  const selected: unknown[][] = [];
  setStoreState({
    providers: [],
    createProvider: async (input) => {
      created.push(input);
      return provider;
    },
  });
  renderWithI18n(
    <FavoriteCreateDialog
      onClose={() => undefined}
      onBlank={() => undefined}
      onCapture={() => undefined}
      onPreset={(...args) => selected.push(args)}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /快速创建（推荐）/ }));
  fireEvent.click(screen.getByRole('button', { name: 'MiniMax' }));
  fireEvent.click(screen.getByRole('combobox', { name: '选择工具连接方式' }));
  fireEvent.click(await screen.findByRole('option', { name: /Anthropic/ }));
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'example-not-a-secret' } });
  fireEvent.click(screen.getByRole('button', { name: '连接供应商' }));
  await waitFor(() => expect(selected).toHaveLength(1));
  expect(created).toEqual([
    {
      name: 'MiniMax',
      apiKey: 'example-not-a-secret',
      endpoints: [{ key: endpoint.key, baseUrl: endpoint.baseUrl }],
    },
  ]);
  expect(selected[0]).toEqual([preset, provider, endpoint.key, 'anthropic-messages']);
});

test('switching a preset model to an unknown model clears only inferred limits on that connection', () => {
  const initial = favoriteFixture('test', 'unknown');
  initial.connections.push({
    ...initial.connections[0]!,
    id: '00000000-0000-4000-8000-000000000022',
    requestModelId: 'second',
    factOverrides: { contextWindow: 4096 },
  });
  const id = initial.connections[0]!.id;
  const hinted = updateConnectionFacts(
    initial,
    id,
    { requestModelId: 'known' },
    {},
    { contextWindow: 128000, maxOutputTokens: 8192 },
  );
  const manual = updateConnectionFacts(
    hinted.draft,
    id,
    { factOverrides: { maxOutputTokens: 2048 } },
    hinted.inferred,
  );
  const unknown = updateConnectionFacts(
    manual.draft,
    id,
    { requestModelId: 'custom' },
    manual.inferred,
  );
  expect(resolveFavorite(unknown.draft, unknown.draft.connections[0]!).facts).toEqual({
    maxOutputTokens: 2048,
  });
  expect(resolveFavorite(unknown.draft, unknown.draft.connections[1]!).facts).toEqual({
    contextWindow: 4096,
  });
  expect(unknown.draft.defaults).toEqual({});
  expect(createFavoriteRequestSchema.safeParse(unknown.draft).success).toBe(true);
});

test('curated selection never replaces authored global limits or explicit unknown overrides', () => {
  const initial = favoriteFixture('test', 'unknown');
  initial.defaults = { contextWindow: 1000 };
  initial.connections[0]!.factOverrides = { maxOutputTokens: null };
  const result = updateConnectionFacts(
    initial,
    initial.connections[0]!.id,
    { requestModelId: 'known' },
    {},
    { contextWindow: 128000, maxOutputTokens: 8192 },
  );
  expect(resolveFavorite(result.draft, result.draft.connections[0]!).facts).toEqual({
    contextWindow: 1000,
  });
});

test('turning off reasoning produces a valid payload without hidden inherited effort conflicts', () => {
  const initial = favoriteFixture('test', 'reasoner');
  initial.defaults = { reasoningSupported: true, supportedReasoningEfforts: ['high'] };
  initial.preferences = { reasoningEffort: 'high' };
  initial.connections[0]!.preferenceOverrides = { reasoningEffort: 'high' };
  const result = updateDefaultFacts(initial, { ...initial.defaults, reasoningSupported: false });
  expect(createFavoriteRequestSchema.safeParse(result).success).toBe(true);
  expect(resolveFavorite(result, result.connections[0]!)).toMatchObject({
    facts: { reasoningSupported: false },
    preferences: {},
  });
  const connectionOnly = updateConnectionFacts(
    initial,
    initial.connections[0]!.id,
    { factOverrides: { reasoningSupported: false } },
    {},
  ).draft;
  expect(createFavoriteRequestSchema.safeParse(connectionOnly).success).toBe(true);
  expect(resolveFavorite(connectionOnly, connectionOnly.connections[0]!).preferences).toEqual({});
});

test('unsaved template edits survive an accidental close until discard is confirmed', async () => {
  setStoreState({ providers: [] });
  let closed = 0;
  renderWithI18n(<FavoriteEditor onClose={() => closed++} />);
  fireEvent.change(screen.getByLabelText('模板名称'), { target: { value: '尚未完成' } });
  fireEvent.click(screen.getByRole('button', { name: '关闭对话框' }));
  expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
  expect(closed).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('模板名称')).toHaveValue('尚未完成');
  fireEvent.click(screen.getByRole('button', { name: '关闭对话框' }));
  fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }));
  expect(closed).toBe(1);
});

test('a custom model is saved without generic context or output limits', async () => {
  const favorite = favoriteFixture('custom', 'custom-model');
  const saves: FavoriteInput[] = [];
  setStoreState({
    providers: [],
    saveFavorite: async (input) => {
      saves.push(input);
      return favorite;
    },
  });
  stubStoreActions(['loadFavoriteCatalog']);
  renderWithI18n(<FavoriteEditor initialDraft={favorite} onClose={() => undefined} />);
  fireEvent.click(screen.getByRole('button', { name: '保存模板' }));
  await waitFor(() => expect(saves).toHaveLength(1));
  expect(resolveFavorite(saves[0]!, saves[0]!.connections[0]!).facts).toEqual({});
});
