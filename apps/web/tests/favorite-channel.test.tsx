import { expect, test } from '@rstest/core';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { FavoriteEditor } from '@/components/model-favorites/editor';
import {
  favoriteFixture,
  providerFixture,
  renderWithI18n,
  setStoreState,
  stubStoreActions,
} from './support';

test('one model picker searches the catalog and saves the exact selected ID', async () => {
  const favorite = favoriteFixture('daily', 'manual/model');
  setStoreState({
    favoriteCatalogs: { 'vault/api': { ok: true, models: ['Vendor/Model:Exact', 'other/model'] } },
  });
  const actions = stubStoreActions(['saveFavorite', 'loadFavoriteCatalog']);
  renderWithI18n(<FavoriteEditor favorite={favorite} onClose={() => undefined} />);
  expect(screen.queryByLabelText('精确请求模型 ID')).toBeNull();
  expect(screen.queryByLabelText('从目录选择模型 ID')).toBeNull();
  fireEvent.click(screen.getByRole('combobox', { name: /^模型(?:（可多选）)?$/ }));
  fireEvent.change(screen.getByRole('combobox', { name: '搜索或输入模型 ID' }), {
    target: { value: 'model:exact' },
  });
  fireEvent.click(await screen.findByRole('option', { name: 'Vendor/Model:Exact' }));
  expect(screen.getByRole('checkbox', { name: 'Vendor/Model:Exact' })).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: '保存模板' }));
  await waitFor(() => expect(actions.saveFavorite).toHaveLength(1));
  expect(actions.saveFavorite[0]![0]).toMatchObject({
    connections: [{ requestModelId: 'manual/model' }, { requestModelId: 'Vendor/Model:Exact' }],
  });
  expect(actions.loadFavoriteCatalog).toHaveLength(0);
});

test('a custom ID can be entered without a catalog using the keyboard', async () => {
  const favorite = favoriteFixture('daily', 'existing/model');
  const actions = stubStoreActions(['saveFavorite', 'loadFavoriteCatalog']);
  renderWithI18n(<FavoriteEditor favorite={favorite} onClose={() => undefined} />);
  fireEvent.click(screen.getByRole('combobox', { name: /^模型(?:（可多选）)?$/ }));
  const search = screen.getByRole('combobox', { name: '搜索或输入模型 ID' });
  fireEvent.change(search, { target: { value: 'Private/Custom:V2' } });
  await waitFor(() =>
    expect(screen.getByRole('option', { name: '使用「Private/Custom:V2」' })).toHaveAttribute(
      'aria-selected',
      'true',
    ),
  );
  fireEvent.keyDown(search, { key: 'Enter', code: 'Enter', keyCode: 13 });
  expect(screen.getByRole('checkbox', { name: 'Private/Custom:V2' })).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: '保存模板' }));
  await waitFor(() => expect(actions.saveFavorite).toHaveLength(1));
  expect(actions.saveFavorite[0]![0]).toMatchObject({
    connections: [{ requestModelId: 'existing/model' }, { requestModelId: 'Private/Custom:V2' }],
  });
});

test('changing endpoint preserves the model and uses only that endpoint catalog', async () => {
  const favorite = favoriteFixture('daily', 'manual/model');
  favorite.connections[0]!.providerId = 'openrouter';
  favorite.connections[0]!.endpointKey = 'main';
  setStoreState({
    providers: [providerFixture()],
    favoriteCatalogs: {
      'openrouter/main': { ok: true, models: ['main/model'] },
      'openrouter/fallback': { ok: true, models: ['fallback/model'] },
    },
  });
  const actions = stubStoreActions(['loadFavoriteCatalog']);
  renderWithI18n(<FavoriteEditor favorite={favorite} onClose={() => undefined} />);
  fireEvent.click(screen.getByRole('combobox', { name: '服务商账号' }));
  fireEvent.click(await screen.findByRole('option', { name: 'OpenRouter · fallback' }));
  expect(screen.getByRole('checkbox', { name: 'manual/model' })).toBeChecked();
  fireEvent.click(screen.getByRole('combobox', { name: /^模型(?:（可多选）)?$/ }));
  expect(screen.getByRole('option', { name: 'fallback/model' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'main/model' })).toBeNull();
  expect(actions.loadFavoriteCatalog).toHaveLength(0);
});
