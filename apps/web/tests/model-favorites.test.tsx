import { expect, test } from '@rstest/core';
import { fireEvent, screen } from '@testing-library/react';
import { ModelFavorites } from '@/components/model-favorites';
import { favoriteFixture, renderWithI18n, setStoreState, stubStoreActions } from './support';

test('searches saved models without probing upstream or hiding disconnected entries', () => {
  const favorites = [
    favoriteFixture('daily', 'vendor/exact-model'),
    {
      ...favoriteFixture('offline', 'other'),
      id: '00000000-0000-4000-8000-000000000003',
      connections: [],
    },
  ];
  setStoreState({ favorites, providers: [], harnesses: [] });
  const actions = stubStoreActions(['loadFavorites', 'loadProviders', 'probeVaultEntry']);
  renderWithI18n(<ModelFavorites />);
  expect(screen.getByRole('heading', { name: 'offline' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('搜索名称、模型或渠道'), {
    target: { value: 'exact-model' },
  });
  expect(screen.getByRole('heading', { name: 'daily' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'offline' })).toBeNull();
  expect(actions.probeVaultEntry).toEqual([]);
});

test('linked profiles show updates and cannot be deleted with their favorite', () => {
  const favorite = favoriteFixture('daily', 'model');
  favorite.references = [
    {
      harness: 'pi',
      name: 'main',
      needsUpdate: true,
      diverged: true,
      sourceMissing: false,
      connectionMissing: false,
    },
  ];
  setStoreState({ favorites: [favorite], providers: [], harnesses: [] });
  stubStoreActions(['loadFavorites', 'loadProviders']);
  renderWithI18n(<ModelFavorites />);
  expect(screen.getByRole('button', { name: '删除收藏' })).toBeDisabled();
  expect(screen.getByText(/pi \/ main/)).toHaveTextContent('有本地分歧');
  expect(screen.getByRole('button', { name: '解除关联，保留配置' })).toBeInTheDocument();
});
