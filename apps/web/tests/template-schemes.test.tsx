import { expect, rs, test } from '@rstest/core';
import type { FavoriteInput } from '@seaveyon/harness-switch-shared';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { SchemeApply } from '@/components/model-favorite-apply-dialog/scheme-apply';
import { FavoriteEditor } from '@/components/model-favorites/editor';
import { IgnoreUpdates } from '@/components/model-favorites/ignore-updates';
import {
  favoriteFixture,
  harnessFixture,
  renderWithI18n,
  setStoreState,
  stubStoreActions,
} from './support';

async function addModel(model: string) {
  fireEvent.click(screen.getByRole('combobox', { name: '模型（可多选）' }));
  fireEvent.change(screen.getByRole('combobox', { name: '搜索或输入模型 ID' }), {
    target: { value: model },
  });
  fireEvent.click(await screen.findByRole('option', { name: `使用「${model}」` }));
  fireEvent.click(screen.getByRole('combobox', { name: '模型（可多选）' }));
}

test('adding a model keeps the existing default; removing that default requires an explicit replacement', async () => {
  const favorite = favoriteFixture('daily', 'vendor/main');
  const actions = stubStoreActions(['saveFavorite', 'loadFavoriteCatalog']);
  renderWithI18n(<FavoriteEditor favorite={favorite} onClose={() => undefined} />);
  await addModel('vendor/fast');
  expect(screen.getByRole('combobox', { name: '默认模型' })).toHaveTextContent('vendor/main');
  fireEvent.click(screen.getByRole('checkbox', { name: 'vendor/main' }));
  fireEvent.click(screen.getByRole('button', { name: '保存模板' }));
  expect(actions.saveFavorite).toHaveLength(0);
  expect(screen.getByText('默认模型已移除，请重新选择。')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('combobox', { name: '默认模型' }));
  fireEvent.click(await screen.findByRole('option', { name: 'route / vendor/fast' }));
  fireEvent.click(screen.getByRole('button', { name: '保存模板' }));
  await waitFor(() => expect(actions.saveFavorite).toHaveLength(1));
  const saved = actions.saveFavorite[0]![0] as FavoriteInput;
  expect(saved.defaultConnectionId).toBe(saved.connections[0]!.id);
  expect(saved.connections[0]!.requestModelId).toBe('vendor/fast');
});

test('Claude tier assignments persist with the template and can reuse a model', async () => {
  const favorite = favoriteFixture('daily', 'vendor/main');
  favorite.connections[0]!.protocol = 'anthropic-messages';
  setStoreState({ providers: [] });
  const actions = stubStoreActions(['saveFavorite', 'loadFavoriteCatalog']);
  renderWithI18n(<FavoriteEditor favorite={favorite} onClose={() => undefined} />);
  await addModel('vendor/fast');
  fireEvent.click(screen.getByRole('radio', { name: '按档位分配' }));
  for (const [tier, model] of [
    ['Opus', 'vendor/main'],
    ['Sonnet', 'vendor/fast'],
    ['Haiku', 'vendor/fast'],
  ]) {
    fireEvent.click(screen.getByRole('combobox', { name: tier! }));
    fireEvent.click(await screen.findByRole('option', { name: model! }));
  }
  fireEvent.click(screen.getByRole('button', { name: '保存模板' }));
  await waitFor(() => expect(actions.saveFavorite).toHaveLength(1));
  const saved = actions.saveFavorite[0]![0] as FavoriteInput;
  expect(saved.toolBindings?.claude?.tiers).toEqual({
    opus: saved.connections[0]!.id,
    sonnet: saved.connections[1]!.id,
    haiku: saved.connections[1]!.id,
  });
  expect(saved.connections[0]!.groupId).toBe(saved.connections[1]!.groupId);
});

test('Codex explains incompatible routes and can create a separate Responses connection', async () => {
  const favorite = favoriteFixture('daily', 'vendor/main');
  favorite.connections[0]!.protocol = 'anthropic-messages';
  const actions = stubStoreActions(['saveFavorite', 'loadFavoriteCatalog']);
  renderWithI18n(<FavoriteEditor favorite={favorite} onClose={() => undefined} />);
  fireEvent.click(screen.getByRole('tab', { name: 'Codex' }));
  expect(screen.getByText(/Codex 需要 openai-responses 协议/)).toBeVisible();
  expect(screen.queryByRole('combobox', { name: '使用连接' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '从 route 添加 Codex 连接' }));
  expect(screen.getByRole('combobox', { name: '使用连接' })).toHaveTextContent('route · codex');
  fireEvent.click(screen.getByRole('button', { name: '保存模板' }));
  await waitFor(() => expect(actions.saveFavorite).toHaveLength(1));
  const saved = actions.saveFavorite[0]![0] as FavoriteInput;
  expect(saved.connections[0]!.protocol).toBe('anthropic-messages');
  expect(saved.connections[1]!.protocol).toBe('openai-responses');
  expect(saved.connections[1]!.providerId).toBe(saved.connections[0]!.providerId);
  expect(saved.toolBindings?.codex?.defaultModelId).toBe(saved.connections[1]!.id);
});

test('cancelling the selected tool preview closes the workflow instead of returning to the chooser', () => {
  const favorite = favoriteFixture('daily', 'vendor/main');
  const onClose = rs.fn();
  setStoreState({ harnesses: [harnessFixture({ id: 'claude' }), harnessFixture({ id: 'dsh' })] });
  renderWithI18n(
    <SchemeApply
      props={{ favorite, onClose }}
      renderSingle={(props) => <button onClick={props.onClose}>cancel preview</button>}
    />,
  );
  expect(screen.getByRole('tab', { name: 'Claude Code' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.queryByRole('combobox', { name: '目标工具' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '预览并确认' }));
  fireEvent.click(screen.getByRole('button', { name: 'cancel preview' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('ignore update sends the current template revision through the store', async () => {
  const favorite = favoriteFixture('daily', 'vendor/main');
  const actions = stubStoreActions(['ignoreFavoriteUpdates']);
  renderWithI18n(<IgnoreUpdates favorite={favorite} />);
  fireEvent.click(screen.getByRole('button', { name: '忽略本次更新' }));
  await waitFor(() => expect(actions.ignoreFavoriteUpdates).toEqual([[favorite]]));
});
