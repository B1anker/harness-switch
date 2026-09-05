import { expect, test } from '@rstest/core';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ModelFavoriteApplyDialog } from '@/components/model-favorite-apply-dialog';
import { ModelFavorites } from '@/components/model-favorites';
import { FavoriteBackups } from '@/components/model-favorites/backups';
import { FavoriteEditor } from '@/components/model-favorites/editor';
import {
  favoriteFixture,
  favoriteTargetFixture,
  renderWithI18n,
  setStoreState,
  stubStoreActions,
} from './support';

test('a single channel only requires selecting a tool and leaves advanced choices collapsed', async () => {
  const favorite = favoriteFixture('daily', 'model');
  setStoreState({
    favoriteTargets: { [favorite.id]: [favoriteTargetFixture(favorite)] },
    harnesses: [],
  });
  const actions = stubStoreActions(['loadFavoriteTargets', 'planFavorite']);
  renderWithI18n(<ModelFavoriteApplyDialog favorite={favorite} onClose={() => undefined} />);
  fireEvent.click(screen.getByRole('checkbox', { name: 'pi' }));
  expect(screen.queryByRole('combobox', { name: '选择渠道' })).toBeNull();
  expect(screen.queryByRole('combobox', { name: '目标配置' })).toBeNull();
  expect(screen.queryByRole('checkbox', { name: '以收藏覆盖已分歧的受控字段' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '生成预览' }));
  await waitFor(() => expect(actions.planFavorite).toHaveLength(1));
  expect(actions.planFavorite[0]).toEqual([
    {
      favoriteId: favorite.id,
      expectedRevision: 1,
      items: [
        {
          harness: 'pi',
          connectionId: favorite.connections[0]!.id,
          existing: false,
          profile: undefined,
          mode: 'save',
          ignorePreference: false,
          overwriteDiverged: false,
        },
      ],
    },
  ]);
});

test('model capability fields are optional and hidden until advanced settings are opened', () => {
  setStoreState({ providers: [] });
  renderWithI18n(<FavoriteEditor onClose={() => undefined} />);
  expect(screen.queryByRole('spinbutton')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '高级设置：能力、思考与备注' }));
  expect(screen.getAllByRole('spinbutton').length).toBeGreaterThan(0);
});

test('restore explains the full scope and only writes after explicit confirmation', async () => {
  setStoreState({
    favoriteBackups: [{ id: 'checkpoint', createdAt: '2026-09-05T00:00:00Z', reason: 'manual' }],
  });
  const actions = stubStoreActions([
    'loadFavoriteBackups',
    'restoreFavoriteBackup',
    'createFavoriteBackup',
  ]);
  renderWithI18n(<FavoriteBackups onClose={() => undefined} />);
  fireEvent.click(screen.getByRole('button', { name: '恢复到此时' }));
  expect(actions.restoreFavoriteBackup).toHaveLength(0);
  expect(screen.getByText(/全部收藏、配置档案、凭据库/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '确认恢复' }));
  await waitFor(() => expect(actions.restoreFavoriteBackup).toEqual([['checkpoint']]));
});

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
