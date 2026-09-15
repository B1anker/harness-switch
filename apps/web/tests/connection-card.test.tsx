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

test('the channel name edits inline in the card header', async () => {
  const favorite = favoriteFixture('daily', 'model');
  setStoreState({
    providers: [
      providerFixture({
        id: 'vault',
        name: 'Vault',
        endpoints: [{ key: 'api', label: '', baseUrl: '' }],
      }),
    ],
  });
  const actions = stubStoreActions(['saveFavorite', 'loadFavoriteCatalog']);
  renderWithI18n(<FavoriteEditor favorite={favorite} onClose={() => undefined} />);
  expect(screen.queryByText('自定义渠道名称')).toBeNull();
  const title = screen.getByLabelText('渠道标签');
  expect(title).toHaveValue('route');
  fireEvent.change(title, { target: { value: '备用路由' } });
  fireEvent.click(screen.getByRole('button', { name: '保存模板' }));
  await waitFor(() => expect(actions.saveFavorite).toHaveLength(1));
  expect(actions.saveFavorite[0]![0]).toMatchObject({
    connections: [{ label: '备用路由' }],
  });
});

test('an unnamed channel falls back to the provider name as placeholder', () => {
  const favorite = favoriteFixture('daily', 'model');
  favorite.connections[0]!.label = '';
  setStoreState({
    providers: [
      providerFixture({
        id: 'vault',
        name: 'Vault',
        endpoints: [{ key: 'api', label: '', baseUrl: '' }],
      }),
    ],
  });
  stubStoreActions(['loadFavoriteCatalog']);
  renderWithI18n(<FavoriteEditor favorite={favorite} onClose={() => undefined} />);
  expect(screen.getByLabelText('渠道标签')).toHaveAttribute('placeholder', 'Vault');
});

test('without a provider the placeholder is the channel number', () => {
  const favorite = favoriteFixture('daily', 'model');
  favorite.connections[0]!.label = '';
  renderWithI18n(<FavoriteEditor favorite={favorite} onClose={() => undefined} />);
  expect(screen.getByLabelText('渠道标签')).toHaveAttribute('placeholder', '渠道 1');
});

test('the model picker trigger matches the protocol select height', () => {
  const favorite = favoriteFixture('daily', 'model');
  stubStoreActions(['loadFavoriteCatalog']);
  renderWithI18n(<FavoriteEditor favorite={favorite} onClose={() => undefined} />);
  const model = screen.getByRole('combobox', { name: /^模型(?:（可多选）)?$/ });
  fireEvent.click(screen.getByRole('button', { name: '更改协议' }));
  const protocol = screen.getByRole('combobox', { name: '协议' });
  expect(model.className).toContain('h-10');
  expect(model.className).not.toContain('min-h-11');
  expect(protocol.className).toContain('h-10');
});

test('the model list scrolls with the wheel inside the modal dialog', () => {
  const favorite = favoriteFixture('daily', 'manual/model');
  stubStoreActions(['loadFavoriteCatalog']);
  renderWithI18n(<FavoriteEditor favorite={favorite} onClose={() => undefined} />);
  fireEvent.click(screen.getByRole('combobox', { name: /^模型(?:（可多选）)?$/ }));
  const list = screen.getByRole('listbox', { name: '搜索或输入模型 ID' });
  expect(list.className).toContain('overflow-y-auto');
  // The modal dialog's RemoveScroll would swallow a wheel that bubbles to the document.
  const seen: Event[] = [];
  const listener = (event: Event) => seen.push(event);
  document.addEventListener('wheel', listener);
  fireEvent.wheel(list, { deltaY: 120 });
  document.removeEventListener('wheel', listener);
  expect(seen).toHaveLength(0);
});
