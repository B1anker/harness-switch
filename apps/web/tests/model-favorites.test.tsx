import { expect, test } from '@rstest/core';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { GlobalBackups } from '@/components/global-backups';
import { ModelFavoriteApplyDialog } from '@/components/model-favorite-apply-dialog';
import { FavoritePreview } from '@/components/model-favorite-apply-dialog/preview';
import { PreviewTabs } from '@/components/model-favorite-apply-dialog/preview-tabs';
import { ModelFavorites } from '@/components/model-favorites';
import { FavoriteEditor } from '@/components/model-favorites/editor';
import {
  favoriteFixture,
  favoritePlanFixture,
  favoriteTargetFixture,
  renderWithI18n,
  setStoreState,
  stubStoreActions,
} from './support';

test('an unchanged saved profile is distinguished from native configuration and blocked activation', () => {
  const item = favoritePlanFixture(favoriteFixture('daily', 'model')).items[0]!;
  renderWithI18n(<FavoritePreview item={{ ...item, mode: 'activate', diff: [] }} />);
  expect(screen.getByText('工具当前配置 → 应用后')).toBeInTheDocument();
  expect(screen.getByText('尚未生成原生文件预览，请先处理阻止应用的问题。')).toBeInTheDocument();
  expect(screen.queryByText('参数保持不变')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '保存档案无变化 · 查看详情' }));
  expect(screen.getByText(/切换到该档案时，工具的原生文件仍可能变化/)).toBeVisible();
});

test('failed impact preview cannot restore using a previously loaded backup preview', async () => {
  setStoreState({
    favoriteBackups: [{ id: 'checkpoint', createdAt: '2026-09-05T00:00:00Z', reason: 'manual' }],
    favoriteBackupPreview: {
      id: 'another',
      fingerprint: 'old',
      files: [{ key: 'store/favorites', path: '/test/favorites.json', action: 'replace' }],
    },
    previewFavoriteBackup: async () => {
      throw new Error('preview unavailable');
    },
  });
  const actions = stubStoreActions(['loadFavoriteBackups', 'restoreFavoriteBackup']);
  renderWithI18n(<GlobalBackups onClose={() => undefined} />);
  fireEvent.click(screen.getByRole('button', { name: '查看恢复影响' }));
  await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  expect(screen.getByRole('button', { name: '确认恢复' })).toBeDisabled();
  expect(actions.restoreFavoriteBackup).toHaveLength(0);
});

test('preview tabs show one tool at a time and support keyboard switching without applying', () => {
  const item = favoritePlanFixture(favoriteFixture('daily', 'model')).items[0]!;
  const actions = stubStoreActions(['applyFavorite', 'planFavorite']);
  renderWithI18n(
    <PreviewTabs items={[item, { ...item, harness: 'claude', profile: 'claude-profile' }]} />,
  );
  expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
  expect(screen.queryByText('claude-profile')).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: /Claude Code/ }));
  expect(screen.getByRole('tabpanel', { name: /Claude Code/ })).toHaveTextContent('claude-profile');
  fireEvent.click(screen.getByRole('button', { name: '查看保存档案的变更' }));
  expect(screen.getAllByRole('table')).toHaveLength(1);
  fireEvent.keyDown(screen.getByRole('tab', { name: /Claude Code/ }), { key: 'ArrowLeft' });
  expect(screen.getByRole('tabpanel', { name: /Pi/ })).toBeInTheDocument();
  expect(screen.queryByText('claude-profile')).toBeNull();
  expect(actions.applyFavorite).toHaveLength(0);
  expect(actions.planFavorite).toHaveLength(0);
});

test('selection and review are separate steps, and going back preserves choices without applying', async () => {
  const favorite = favoriteFixture('daily', 'model');
  setStoreState({
    favoriteTargets: { [favorite.id]: [favoriteTargetFixture(favorite)] },
    harnesses: [],
  });
  const actions = stubStoreActions(['loadFavoriteTargets', 'applyFavorite']);
  setStoreState({
    planFavorite: async () => {
      setStoreState({ favoritePlan: favoritePlanFixture(favorite) });
    },
  });
  renderWithI18n(<ModelFavoriteApplyDialog favorite={favorite} onClose={() => undefined} />);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Pi' }));
  fireEvent.click(screen.getByRole('button', { name: '生成预览' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '确认保存到 1 个工具' })).toBeEnabled(),
  );
  expect(screen.queryByRole('checkbox', { name: 'Pi' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '查看保存档案的变更' }));
  expect(screen.getByRole('table')).toBeInTheDocument();
  expect(actions.applyFavorite).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '返回选择' }));
  expect(screen.getByRole('checkbox', { name: 'Pi' })).toBeChecked();
  expect(screen.queryByRole('table')).toBeNull();
});

test('a single channel only requires selecting a tool and leaves advanced choices collapsed', async () => {
  const favorite = favoriteFixture('daily', 'model');
  setStoreState({
    favoriteTargets: { [favorite.id]: [favoriteTargetFixture(favorite)] },
    harnesses: [],
  });
  const actions = stubStoreActions(['loadFavoriteTargets', 'planFavorite']);
  renderWithI18n(<ModelFavoriteApplyDialog favorite={favorite} onClose={() => undefined} />);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Pi' }));
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

test('save mode uses mutually exclusive radio options and sends the selected activation mode', async () => {
  const favorite = favoriteFixture('daily', 'model');
  setStoreState({
    favoriteTargets: { [favorite.id]: [favoriteTargetFixture(favorite)] },
    harnesses: [],
  });
  const actions = stubStoreActions(['loadFavoriteTargets', 'planFavorite']);
  renderWithI18n(<ModelFavoriteApplyDialog favorite={favorite} onClose={() => undefined} />);
  expect(screen.getByRole('radio', { name: '仅保存' })).toBeChecked();
  fireEvent.click(screen.getByRole('radio', { name: '保存并激活' }));
  expect(screen.getByRole('radio', { name: '仅保存' })).toHaveAttribute('aria-checked', 'false');
  expect(screen.getByRole('radio', { name: '保存并激活' })).toBeChecked();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Pi' }));
  fireEvent.click(screen.getByRole('button', { name: '生成预览' }));
  await waitFor(() => expect(actions.planFavorite).toHaveLength(1));
  expect(actions.planFavorite[0]![0]).toMatchObject({
    items: [{ harness: 'pi', mode: 'activate' }],
  });
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
  setStoreState({
    previewFavoriteBackup: async (id) => {
      setStoreState({
        favoriteBackupPreview: {
          id,
          fingerprint: 'preview-fingerprint',
          files: [
            { key: 'store/favorites', path: '/test/favorites.json', action: 'replace' },
            { key: 'kimi/config', path: '/test/kimi.toml', action: 'delete' },
          ],
        },
      });
    },
  });
  renderWithI18n(<GlobalBackups onClose={() => undefined} />);
  fireEvent.click(screen.getByRole('button', { name: '查看恢复影响' }));
  expect(actions.restoreFavoriteBackup).toHaveLength(0);
  expect(screen.getByText(/全部收藏、配置档案、凭据库/)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: '确认恢复' })).toBeEnabled());
  expect(screen.getByText('删除备份时不存在的文件')).toBeInTheDocument();
  expect(screen.getByText('/test/kimi.toml')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '确认恢复' }));
  await waitFor(() =>
    expect(actions.restoreFavoriteBackup).toEqual([['checkpoint', 'preview-fingerprint']]),
  );
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
