import { expect, test } from '@rstest/core';
import type { FavoritePlanRequest } from '@seaveyon/harness-switch-shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ModelFavorites } from '@/components/model-favorites';
import { FavoriteNextStep } from '@/components/model-favorites/next-step';
import { FavoriteRelationships } from '@/components/model-favorites/relationships';
import {
  favoriteFixture,
  favoriteTargetFixture,
  harnessFixture,
  profileFixture,
  renderWithI18n,
  setStoreState,
  stubStoreActions,
} from './support';

function linkedSetup() {
  const favorite = favoriteFixture('daily', 'vendor/model');
  const profile = profileFixture({
    harness: 'pi',
    name: 'main',
    modelFavorite: {
      favoriteId: favorite.id,
      connectionId: favorite.connections[0]!.id,
      appliedRevision: 1,
      projectionVersion: 1,
      baseline: favoriteTargetFixture(favorite).connections[0]!.projection.projection,
    },
  });
  favorite.references = [
    {
      harness: 'pi',
      name: 'main',
      needsUpdate: false,
      diverged: false,
      sourceMissing: false,
      connectionMissing: false,
    },
  ];
  const harness = harnessFixture({
    id: 'pi',
    label: 'Pi',
    profiles: [profile],
    active: { name: profile.name, model: profile.model, baseUrl: profile.baseUrl },
  });
  setStoreState({
    favorites: [favorite],
    providers: [],
    harnesses: [harness],
    favoriteTargets: { [favorite.id]: [favoriteTargetFixture(favorite)] },
  });
  stubStoreActions(['loadFavorites', 'loadProviders', 'loadFavoriteTargets']);
  return { favorite, profile, harness };
}

test('first-time users can create a template without having an existing profile', () => {
  setStoreState({ favorites: [], providers: [], harnesses: [] });
  const actions = stubStoreActions(['loadFavorites', 'loadProviders', 'captureFavorite']);
  renderWithI18n(<ModelFavorites />);
  fireEvent.click(screen.getByRole('button', { name: '创建第一个模板' }));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /快速创建（推荐）/ })).toBeInTheDocument();
  expect(actions.captureFavorite).toHaveLength(0);
});

test('empty capture dialog explains eligibility and provides a direct create route', () => {
  setStoreState({ favorites: [], providers: [], harnesses: [] });
  stubStoreActions(['loadFavorites', 'loadProviders']);
  renderWithI18n(<ModelFavorites />);
  fireEvent.click(screen.getByRole('button', { name: '从已有配置创建模板' }));
  expect(screen.getByText('还没有可复用的配置')).toBeInTheDocument();
  expect(screen.queryByRole('combobox')).toBeNull();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '新建模板' }));
  expect(screen.getByRole('button', { name: /快速创建（推荐）/ })).toBeInTheDocument();
});

test('saving a second template selects it immediately and clears an old search', async () => {
  const original = { ...favoriteFixture('daily', 'model'), connections: [] };
  const saved = { ...original, id: '00000000-0000-4000-8000-000000000004', name: 'new-template' };
  setStoreState({
    favorites: [original],
    providers: [],
    harnesses: [],
    saveFavorite: async () => {
      setStoreState({ favorites: [original, saved] });
      return saved;
    },
  });
  stubStoreActions(['loadFavorites', 'loadProviders', 'loadFavoriteTargets']);
  renderWithI18n(<ModelFavorites />);
  fireEvent.change(screen.getByLabelText('搜索名称、模型或渠道'), { target: { value: 'daily' } });
  fireEvent.click(screen.getByRole('button', { name: '复制模板' }));
  fireEvent.click(screen.getByRole('button', { name: '保存模板' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByRole('button', { name: /new-template/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(screen.getByLabelText('搜索名称、模型或渠道')).toHaveValue('');
  expect(screen.getByRole('button', { name: '下一步：添加模型连接' })).toBeInTheDocument();
});

test('detaching requires confirmation, keeps configuration state and enables deleting the last template reference', async () => {
  const { favorite, profile, harness } = linkedSetup();
  const calls: string[][] = [];
  setStoreState({
    detachFavorite: async (id, name) => {
      calls.push([id, name]);
      setStoreState({
        favorites: [{ ...favorite, references: [] }],
        harnesses: [{ ...harness, profiles: [{ ...profile, modelFavorite: undefined }] }],
      });
    },
  });
  renderWithI18n(<ModelFavorites />);
  fireEvent.click(screen.getByRole('button', { name: '管理已生成配置与收藏' }));
  expect(screen.getByRole('button', { name: '删除模板' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '解除关联，保留配置' }));
  expect(calls).toHaveLength(0);
  expect(screen.getByRole('alertdialog')).toHaveTextContent('配置内容和当前使用状态都会保留');
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(calls).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '解除关联，保留配置' }));
  fireEvent.click(
    within(screen.getByRole('alertdialog')).getByRole('button', { name: '解除关联，保留配置' }),
  );
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(calls).toEqual([['pi', 'main']]);
  expect(screen.getByRole('button', { name: '删除模板' })).toBeEnabled();
  expect(
    screen.getByText('已解除 pi / main 的关联，配置和当前使用状态已保留。'),
  ).toBeInTheDocument();
});

test('a failed detach keeps its dialog open and preserves the delete restriction', async () => {
  linkedSetup();
  setStoreState({
    detachFavorite: async () => {
      throw new Error('detachment failed');
    },
  });
  renderWithI18n(<ModelFavorites />);
  fireEvent.click(screen.getByRole('button', { name: '管理已生成配置与收藏' }));
  fireEvent.click(screen.getByRole('button', { name: '解除关联，保留配置' }));
  fireEvent.click(
    within(screen.getByRole('alertdialog')).getByRole('button', { name: '解除关联，保留配置' }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('detachment failed');
  expect(
    within(screen.getByRole('alertdialog')).getByRole('button', { name: '解除关联，保留配置' }),
  ).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(screen.getByRole('button', { name: '删除模板' })).toBeDisabled();
});

test('linked profile details open from the template without saving or detaching', () => {
  const { profile } = linkedSetup();
  const actions = stubStoreActions(['updateProfile', 'detachFavorite']);
  renderWithI18n(<ModelFavorites />);
  fireEvent.click(screen.getByRole('button', { name: '管理已生成配置与收藏' }));
  fireEvent.click(screen.getByRole('button', { name: '查看配置' }));
  expect(within(screen.getByRole('dialog')).getByLabelText('配置名称')).toHaveValue(profile.name);
  expect(actions.updateProfile).toHaveLength(0);
  expect(actions.detachFavorite).toHaveLength(0);
});

test('saving from a graph tool node opens the actual preview flow in save-only mode', async () => {
  linkedSetup();
  const actions = stubStoreActions(['applyFavorite', 'planFavorite']);
  renderWithI18n(<ModelFavorites />);
  fireEvent.click(screen.getByRole('button', { name: '保存备用' }));
  const tool = await screen.findByRole('button', { name: 'Pi 正在使用' });
  await waitFor(() => expect(tool).toBeEnabled());
  fireEvent.click(tool);
  expect(within(screen.getByRole('dialog')).getByRole('radio', { name: '保存备用' })).toBeChecked();
  expect(actions.applyFavorite).toHaveLength(0);
  expect(actions.planFavorite).toHaveLength(0);
});

test('graph mode separates save and switch actions and retain exact request identity', async () => {
  const { favorite } = linkedSetup();
  const requests: FavoritePlanRequest['items'][] = [];
  renderWithI18n(
    <FavoriteRelationships
      favorite={favorite}
      onApply={(items) => requests.push(items)}
      onEditConnections={() => undefined}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '保存备用' }));
  const tool = await screen.findByRole('button', { name: 'Pi 正在使用' });
  await waitFor(() => expect(tool).toBeEnabled());
  fireEvent.click(tool);
  fireEvent.click(screen.getByRole('button', { name: '保存并立即切换' }));
  fireEvent.click(tool);
  expect(requests.map((items) => items[0]?.mode)).toEqual(['save', 'activate']);
  expect(requests[0]?.[0]).toMatchObject({
    profile: 'main',
    existing: true,
    connectionId: favorite.connections[0]!.id,
  });
  expect(screen.getByText('vendor/model')).toBeInTheDocument();
  expect(screen.getByText(/openai-responses/)).toBeInTheDocument();
});

test('refreshed reference status shows pending updates and previews one profile per tool without activation', () => {
  const { favorite, profile, harness } = linkedSetup();
  favorite.references = [
    { ...favorite.references[0]!, needsUpdate: true },
    { ...favorite.references[0]!, name: 'backup', needsUpdate: true },
  ];
  setStoreState({
    harnesses: [{ ...harness, profiles: [profile, { ...profile, name: 'backup' }] }],
  });
  const requests: FavoritePlanRequest['items'][] = [];
  const { rerender } = renderWithI18n(
    <FavoriteNextStep
      favorite={favorite}
      onConfigure={() => undefined}
      onConnect={() => undefined}
      onApply={(items) => requests.push(items)}
    />,
  );
  expect(screen.getByText('2 个待更新')).toBeInTheDocument();
  expect(screen.getByText('1 个正在使用')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '预览待更新配置（1）' }));
  expect(requests[0]).toHaveLength(1);
  expect(requests[0]?.[0]).toMatchObject({ harness: 'pi', mode: 'save', overwriteDiverged: false });
  act(() =>
    rerender(
      <FavoriteNextStep
        favorite={{ ...favorite, references: [] }}
        onConfigure={() => undefined}
        onConnect={() => undefined}
        onApply={() => undefined}
      />,
    ),
  );
  expect(screen.queryByText('2 个待更新')).toBeNull();
});
