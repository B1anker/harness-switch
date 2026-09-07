import { expect, test } from '@rstest/core';
import { type FavoriteInput, resolveFavorite } from '@seaveyon/harness-switch-shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import {
  NEW_TEMPLATE_FACTS,
  updateConnectionFacts,
} from '@/components/model-favorites/draft-facts';
import { FavoriteEditor } from '@/components/model-favorites/editor';
import { presetFactsForConnection } from '@/components/model-favorites/preset-connections';
import {
  favoriteFixture,
  providerFixture,
  renderWithI18n,
  setStoreState,
  stubStoreActions,
} from './support';

test('clearing an inherited capacity explicitly unsets it, and reset restores live inheritance', async () => {
  const favorite = favoriteFixture('daily', 'custom/model');
  favorite.defaults = { ...NEW_TEMPLATE_FACTS };
  const saves: FavoriteInput[] = [];
  setStoreState({
    providers: [],
    saveFavorite: async (input) => {
      saves.push(input);
      return favorite;
    },
  });
  stubStoreActions(['loadFavoriteCatalog']);
  renderWithI18n(<FavoriteEditor favorite={favorite} onClose={() => undefined} />);
  fireEvent.click(screen.getByRole('tab', { name: '模型能力' }));
  const defaults = within(screen.getByRole('region', { name: '模板默认能力' }));
  const overrides = within(screen.getByRole('region', { name: '按连接单独设置' }));
  fireEvent.click(overrides.getByRole('button', { name: /route/ }));
  const output = overrides.getByRole('spinbutton', { name: '最大输出 token' });
  expect(output).toHaveValue(65536);
  fireEvent.change(output, { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: '保存模板' }));
  await waitFor(() => expect(saves).toHaveLength(1));
  expect(saves[0]!.connections[0]!.factOverrides.maxOutputTokens).toBeNull();
  expect(
    resolveFavorite(saves[0]!, saves[0]!.connections[0]!).facts.maxOutputTokens,
  ).toBeUndefined();
  fireEvent.click(overrides.getByRole('button', { name: '全部恢复为继承模板' }));
  fireEvent.change(defaults.getByRole('spinbutton', { name: '最大输出 token' }), {
    target: { value: '32000' },
  });
  expect(output).toHaveValue(32000);
  fireEvent.click(screen.getByRole('button', { name: '保存模板' }));
  await waitFor(() => expect(saves).toHaveLength(2));
  expect(saves[1]!.connections[0]!.factOverrides).toEqual({});
});

test('removing a supported effort clears the incompatible preference and unknown models offer only default behavior', async () => {
  const favorite = favoriteFixture('daily', 'custom/model');
  favorite.defaults = { ...NEW_TEMPLATE_FACTS, supportedReasoningEfforts: ['low', 'high'] };
  favorite.preferences = { reasoningEffort: 'high' };
  setStoreState({ providers: [] });
  renderWithI18n(<FavoriteEditor favorite={favorite} onClose={() => undefined} />);
  fireEvent.click(screen.getByRole('tab', { name: '模型能力' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'high' }));
  expect(screen.getByRole('combobox', { name: '默认思考偏好' })).toHaveTextContent(
    '不指定，沿用默认',
  );
  fireEvent.click(screen.getByRole('combobox', { name: '默认思考偏好' }));
  expect(screen.getByRole('option', { name: 'low' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'high' })).toBeNull();
  fireEvent.click(screen.getByRole('option', { name: '不指定，沿用默认' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'low' }));
  fireEvent.click(screen.getByRole('combobox', { name: '默认思考偏好' }));
  expect(screen.getAllByRole('option')).toHaveLength(1);
});

test('exact preset endpoint and model supply effort levels, and changing identity clears inferred values', () => {
  const provider = providerFixture({
    id: 'official',
    endpoints: [{ key: 'main', label: 'Main', baseUrl: 'https://api.openai.com/v1' }],
  });
  const hint = presetFactsForConnection([provider], 'official', 'main', 'gpt-5');
  expect(hint?.supportedReasoningEfforts).toEqual(['minimal', 'low', 'medium', 'high']);
  expect(presetFactsForConnection([provider], 'official', 'main', 'vendor/gpt-5')).toBeUndefined();
  const initial = favoriteFixture('daily', 'custom/model');
  initial.defaults = { ...NEW_TEMPLATE_FACTS };
  const connection = initial.connections[0]!;
  const chosen = updateConnectionFacts(
    initial,
    connection.id,
    { requestModelId: 'gpt-5' },
    {},
    hint,
  );
  expect(resolveFavorite(chosen.draft, chosen.draft.connections[0]!).facts).toMatchObject({
    contextWindow: 400000,
    maxOutputTokens: 128000,
    supportedReasoningEfforts: ['minimal', 'low', 'medium', 'high'],
  });
  const changed = updateConnectionFacts(
    chosen.draft,
    connection.id,
    { requestModelId: 'custom/model' },
    chosen.inferred,
  );
  expect(resolveFavorite(changed.draft, changed.draft.connections[0]!).facts).toEqual(
    NEW_TEMPLATE_FACTS,
  );
});

test('changing a saved model route does not carry its old effort declaration or preference', () => {
  const initial = favoriteFixture('saved', 'gpt-5');
  initial.defaults = { ...NEW_TEMPLATE_FACTS };
  initial.connections[0]!.factOverrides = { supportedReasoningEfforts: ['minimal', 'high'] };
  initial.connections[0]!.preferenceOverrides = { reasoningEffort: 'minimal' };
  const changed = updateConnectionFacts(
    initial,
    initial.connections[0]!.id,
    { requestModelId: 'custom/model' },
    {},
  );
  expect(
    resolveFavorite(changed.draft, changed.draft.connections[0]!).facts.supportedReasoningEfforts,
  ).toBeUndefined();
  expect(resolveFavorite(changed.draft, changed.draft.connections[0]!).preferences).toEqual({});
});
