import { expect, test } from '@rstest/core';
import type {
  ToolModelsPreview,
  ToolModelsRequest,
  ToolModelsState,
} from '@seaveyon/harness-switch-shared';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { ToolModels } from '@/components/tool-models';
import { useAppStore } from '@/stores/app-store';
import {
  favoriteFixture,
  renderWithI18n,
  setStoreState,
  stubFetch,
  stubStoreActions,
} from './support';

function setup() {
  const first = favoriteFixture('First', 'model-a');
  const second = {
    ...favoriteFixture('Second', 'model-b'),
    id: '00000000-0000-4000-8000-000000000099',
  };
  const saved: ToolModelsState = {
    revision: 0,
    draft: { items: [], defaultItemId: null },
    applied: [],
  };
  setStoreState({ toolModels: [{ harness: 'dsh', state: saved }], favorites: [first, second] });
  const actions = stubStoreActions([
    'loadToolModels',
    'loadFavorites',
    'saveToolModels',
    'previewToolModels',
    'applyToolModels',
  ]);
  renderWithI18n(<ToolModels harness="dsh" />);
  fireEvent.click(screen.getByRole('button', { name: '管理模型' }));
  return { first, second, saved, actions };
}

test('selecting several templates saves one draft and does not change the default or apply it', async () => {
  const { actions } = setup();
  fireEvent.click(screen.getByRole('checkbox', { name: 'First' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Second' }));
  fireEvent.click(screen.getByRole('button', { name: '仅保存草稿' }));
  await waitFor(() => expect(actions.saveToolModels).toHaveLength(1));
  const [harness, request] = actions.saveToolModels[0] as [string, ToolModelsRequest];
  expect(harness).toBe('dsh');
  expect(request.draft.items).toHaveLength(2);
  expect(request.draft.items.map((item) => item.factOverrides)).toEqual([{}, {}]);
  expect(request.draft.defaultItemId).toBeNull();
  expect(actions.applyToolModels).toHaveLength(0);
  expect(await screen.findByText('草稿已保存，工具配置尚未改变。')).toBeInTheDocument();
});

test('edits invalidate a prepared preview and apply only uses the reviewed plan', async () => {
  const { actions } = setup();
  fireEvent.click(screen.getByRole('checkbox', { name: 'First' }));
  const preview: ToolModelsPreview = {
    id: 'reviewed-plan',
    items: [],
    removed: [],
    defaultItemId: null,
    files: [],
  };
  act(() => setStoreState({ toolModelsPreview: preview }));
  fireEvent.click(screen.getByRole('button', { name: '应用这些变更' }));
  await waitFor(() => expect(actions.applyToolModels).toEqual([['dsh', 'reviewed-plan']]));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Second' }));
  expect(screen.queryByRole('button', { name: '应用这些变更' })).toBeNull();
});

test('failed apply preserves edits and exposes recovery feedback', async () => {
  setup();
  fireEvent.click(screen.getByRole('checkbox', { name: 'First' }));
  act(() =>
    setStoreState({
      toolModelsPreview: { id: 'plan', items: [], removed: [], defaultItemId: null, files: [] },
      applyToolModels: async () => {
        throw new Error('test failure');
      },
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: '应用这些变更' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('test failure'));
  expect(screen.getAllByText('model-a').length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: '应用这些变更' })).toBeEnabled();
});

test('a per-tool capacity override leaves its template unchanged and reset restores inheritance', async () => {
  const { first, actions } = setup();
  fireEvent.click(screen.getByRole('checkbox', { name: 'First' }));
  fireEvent.click(screen.getByRole('button', { name: '为这个工具单独设置' }));
  const capacity = screen.getByLabelText('上下文窗口');
  fireEvent.change(capacity, { target: { value: '99000' } });
  fireEvent.click(screen.getByRole('button', { name: '预览应用' }));
  await waitFor(() => expect(actions.previewToolModels).toHaveLength(1));
  const request = actions.previewToolModels[0]![1] as ToolModelsRequest;
  expect(request.draft.items[0]!.factOverrides.contextWindow).toBe(99000);
  expect(useAppStore.getState().favorites![0]!.defaults).toEqual(first.defaults);
  fireEvent.click(screen.getByRole('button', { name: '恢复跟随模板和连接' }));
  fireEvent.click(screen.getByRole('button', { name: '仅保存草稿' }));
  await waitFor(() => expect(actions.saveToolModels).toHaveLength(1));
  expect(
    (actions.saveToolModels[0]![1] as ToolModelsRequest).draft.items[0]!.factOverrides,
  ).toEqual({});
});

test('a preview response arriving after editing is discarded', async () => {
  let finish!: (body: unknown) => void;
  stubFetch(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const request: ToolModelsRequest = {
    expectedRevision: 0,
    draft: { items: [], defaultItemId: null },
  };
  const pending = useAppStore.getState().previewToolModels('kimi', request);
  useAppStore.getState().clearToolModelsPreview();
  finish({ data: { id: 'stale', items: [], removed: [], defaultItemId: null, files: [] } });
  await pending;
  expect(useAppStore.getState().toolModelsPreview).toBeNull();
});
