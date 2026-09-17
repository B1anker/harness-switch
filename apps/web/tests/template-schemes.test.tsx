import { expect, rs, test } from '@rstest/core';
import type {
  FavoriteInput,
  ToolModelsPreview,
  ToolModelsRequest,
} from '@seaveyon/harness-switch-shared';
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
  favorite.connections[0]!.protocols = ['anthropic-messages'];
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

test('incomplete Claude tiers stay in the draft and block save until filled', async () => {
  const favorite = favoriteFixture('daily', 'vendor/main');
  favorite.connections[0]!.protocol = 'anthropic-messages';
  favorite.connections[0]!.protocols = ['anthropic-messages'];
  setStoreState({ providers: [] });
  const actions = stubStoreActions(['saveFavorite', 'loadFavoriteCatalog']);
  renderWithI18n(<FavoriteEditor favorite={favorite} onClose={() => undefined} />);
  fireEvent.click(screen.getByRole('radio', { name: '按档位分配' }));
  fireEvent.click(screen.getByRole('combobox', { name: 'Opus' }));
  fireEvent.click(await screen.findByRole('option', { name: 'vendor/main' }));
  fireEvent.click(screen.getByRole('button', { name: '保存模板' }));
  expect(actions.saveFavorite).toHaveLength(0);
  expect(screen.getByRole('radio', { name: '按档位分配' })).toBeChecked();
  expect(screen.getByRole('combobox', { name: 'Opus' })).toHaveTextContent('vendor/main');
});

test('explicit empty DSH model selection survives prune and save', async () => {
  const favorite = favoriteFixture('daily', 'vendor/main');
  favorite.connections.push({
    ...favorite.connections[0]!,
    id: '00000000-0000-4000-8000-000000000003',
    groupId: favorite.connections[0]!.id,
    requestModelId: 'vendor/fast',
  });
  favorite.connections[0]!.groupId = favorite.connections[0]!.id;
  favorite.toolBindings = { dsh: { modelIds: [] } };
  const actions = stubStoreActions(['saveFavorite', 'loadFavoriteCatalog']);
  renderWithI18n(<FavoriteEditor favorite={favorite} onClose={() => undefined} />);
  fireEvent.click(screen.getByRole('button', { name: '保存模板' }));
  await waitFor(() => expect(actions.saveFavorite).toHaveLength(1));
  const saved = actions.saveFavorite[0]![0] as FavoriteInput;
  expect(saved.toolBindings?.dsh?.modelIds).toEqual([]);
});

test('Codex explains incompatible routes and can enable Responses on the same connection', async () => {
  const favorite = favoriteFixture('daily', 'vendor/main');
  favorite.connections[0]!.protocol = 'anthropic-messages';
  favorite.connections[0]!.protocols = ['anthropic-messages'];
  const actions = stubStoreActions(['saveFavorite', 'loadFavoriteCatalog']);
  renderWithI18n(<FavoriteEditor favorite={favorite} onClose={() => undefined} />);
  fireEvent.click(screen.getByRole('tab', { name: 'Codex' }));
  expect(screen.getByText(/Codex 需要 openai-responses 协议/)).toBeVisible();
  expect(screen.queryByRole('combobox', { name: '使用连接' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '在 route 上启用 openai-responses' }));
  expect(screen.getByRole('combobox', { name: '使用连接' })).toHaveTextContent('route');
  fireEvent.click(screen.getByRole('button', { name: '保存模板' }));
  await waitFor(() => expect(actions.saveFavorite).toHaveLength(1));
  const saved = actions.saveFavorite[0]![0] as FavoriteInput;
  expect(saved.connections).toHaveLength(1);
  expect(saved.connections[0]!.protocols).toEqual(['anthropic-messages', 'openai-responses']);
  expect(saved.connections[0]!.protocol).toBe('anthropic-messages');
  expect(saved.toolBindings?.codex?.defaultModelId).toBe(saved.connections[0]!.id);
});

test('deleting a protocol copy drops the stale Codex binding so save still works', async () => {
  const favorite = favoriteFixture('daily', 'vendor/main');
  const kept = favorite.connections[0]!;
  kept.protocol = 'anthropic-messages';
  kept.protocols = ['anthropic-messages'];
  const gone = '00000000-0000-4000-8000-0000000000cc';
  favorite.toolBindings = {
    codex: { connectionId: gone, defaultModelId: gone },
  };
  const actions = stubStoreActions(['saveFavorite', 'loadFavoriteCatalog']);
  renderWithI18n(<FavoriteEditor favorite={favorite} onClose={() => undefined} />);
  fireEvent.click(screen.getByRole('button', { name: '保存模板' }));
  await waitFor(() => expect(actions.saveFavorite).toHaveLength(1));
  const saved = actions.saveFavorite[0]![0] as FavoriteInput;
  expect(saved.toolBindings?.codex).toBeUndefined();
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

function collectionSetup() {
  const favorite = favoriteFixture('daily', 'vendor/main');
  let previewResult: ToolModelsPreview | null = null;
  setStoreState({
    harnesses: [harnessFixture({ id: 'claude' }), harnessFixture({ id: 'dsh' })],
    toolModels: [
      {
        harness: 'dsh',
        state: { revision: 0, draft: { items: [], defaultItemId: null }, applied: [] },
      },
    ],
  });
  const actions = stubStoreActions(['loadToolModels', 'saveToolModels', 'applyToolModels']);
  const previewCalls: unknown[][] = [];
  setStoreState({
    previewToolModels: async (...args: unknown[]) => {
      previewCalls.push(args);
      if (previewResult) {
        setStoreState({ toolModelsPreview: previewResult });
      }
    },
  });
  renderWithI18n(
    <SchemeApply props={{ favorite, onClose: () => undefined }} renderSingle={() => null} />,
  );
  fireEvent.click(screen.getByRole('tab', { name: 'DSH' }));
  return {
    favorite,
    actions: { ...actions, previewToolModels: previewCalls },
    usePreview(preview: ToolModelsPreview) {
      previewResult = preview;
    },
  };
}

test('a collection tool walks choose then review before switching', async () => {
  const { favorite, actions, usePreview } = collectionSetup();
  expect(screen.queryByRole('radio', { name: '保存备用' })).toBeNull();
  expect(screen.queryByRole('button', { name: '预览应用' })).toBeNull();
  usePreview({
    id: 'reviewed-plan',
    items: [],
    removed: [],
    defaultItemId: favorite.connections[0]!.id,
    files: [{ key: 'config', changed: true, before: '', after: '{"models":[]}' }],
  });
  fireEvent.click(screen.getByRole('button', { name: '预览并确认' }));
  await screen.findByText('工具当前配置 → 应用后');
  expect(actions.previewToolModels).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '确认保存并切换 1 个工具' }));
  await waitFor(() => expect(actions.applyToolModels).toEqual([['dsh', 'reviewed-plan']]));
  expect(actions.saveToolModels).toHaveLength(0);
  expect(screen.getByRole('button', { name: '完成' })).toBeInTheDocument();
});

test('switching a collection tool previews the native files as a diff before applying', async () => {
  const { favorite, actions, usePreview } = collectionSetup();
  usePreview({
    id: 'reviewed-plan',
    items: [],
    removed: [],
    defaultItemId: favorite.connections[0]!.id,
    files: [{ key: 'config', changed: true, before: '', after: '{"models":[]}' }],
  });
  fireEvent.click(screen.getByRole('button', { name: '预览并确认' }));
  await screen.findByText('工具当前配置 → 应用后');
  expect(screen.getByText('config')).toBeInTheDocument();
  expect(screen.queryByText('变更前')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '确认保存并切换 1 个工具' }));
  await waitFor(() => expect(actions.applyToolModels).toEqual([['dsh', 'reviewed-plan']]));
  expect(actions.saveToolModels).toHaveLength(0);
});

test('collection apply collapses Claude/Codex protocol copies into one provider', async () => {
  const favorite = favoriteFixture('daily', 'vendor/main');
  const anthropic = {
    ...favorite.connections[0]!,
    id: '00000000-0000-4000-8000-0000000000aa',
    label: 'route',
    protocol: 'anthropic-messages' as const,
  };
  const responses = {
    ...favorite.connections[0]!,
    id: '00000000-0000-4000-8000-0000000000bb',
    label: 'route · codex',
    groupId: '00000000-0000-4000-8000-0000000000bb',
    protocol: 'openai-responses' as const,
  };
  favorite.connections = [anthropic, responses];
  favorite.defaultConnectionId = anthropic.id;
  let captured: ToolModelsRequest | undefined;
  setStoreState({
    harnesses: [harnessFixture({ id: 'claude' }), harnessFixture({ id: 'kimi' })],
    toolModels: [
      {
        harness: 'kimi',
        state: { revision: 0, draft: { items: [], defaultItemId: null }, applied: [] },
      },
    ],
    previewToolModels: async (_harness, request) => {
      captured = request;
      setStoreState({
        toolModelsPreview: {
          id: 'collapsed-plan',
          items: [],
          removed: [],
          defaultItemId: anthropic.id,
          files: [{ key: 'config', changed: true, before: '', after: '{}' }],
        },
      });
    },
  });
  stubStoreActions(['loadToolModels', 'saveToolModels', 'applyToolModels']);
  renderWithI18n(
    <SchemeApply props={{ favorite, onClose: () => undefined }} renderSingle={() => null} />,
  );
  fireEvent.click(screen.getByRole('tab', { name: 'Kimi' }));
  expect(screen.getByText('1 个模型')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '预览并确认' }));
  await screen.findByText('工具当前配置 → 应用后');
  expect(captured?.draft.items.map((item) => item.source)).toEqual([
    { kind: 'favorite', favoriteId: favorite.id, connectionId: anthropic.id },
  ]);
  expect(captured?.draft.defaultItemId).toBe(anthropic.id);
});

test('ignore update sends the current template revision through the store', async () => {
  const favorite = favoriteFixture('daily', 'vendor/main');
  const actions = stubStoreActions(['ignoreFavoriteUpdates']);
  renderWithI18n(<IgnoreUpdates favorite={favorite} />);
  fireEvent.click(screen.getByRole('button', { name: '忽略本次更新' }));
  await waitFor(() => expect(actions.ignoreFavoriteUpdates).toEqual([[favorite]]));
});
