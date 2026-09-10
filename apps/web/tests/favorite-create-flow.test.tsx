import { beforeEach, expect, test } from '@rstest/core';
import type { ModelFavorite } from '@seaveyon/harness-switch-shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ModelFavorites } from '@/components/model-favorites';
import { CaptureFavorite } from '@/components/model-favorites/capture';
import { FavoriteEditor } from '@/components/model-favorites/editor';
import { Toaster } from '@/components/ui/sonner';
import { useAppStore } from '@/stores/app-store';
import {
  favoriteFixture,
  harnessFixture,
  OFFLINE,
  profileFixture,
  providerFixture,
  renderWithI18n,
  setStoreState,
  stubFetch,
  stubStoreActions,
} from './support';

beforeEach(() => stubFetch(OFFLINE));

function renderList() {
  setStoreState({ favorites: [], providers: [providerFixture()], harnesses: [] });
  stubStoreActions(['loadFavorites', 'loadProviders']);
  renderWithI18n(<ModelFavorites />);
}

test('new template opens a three-way choice instead of a blank form', async () => {
  renderList();
  fireEvent.click(screen.getByRole('button', { name: '新建模板' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByRole('button', { name: /快速创建（推荐）/ })).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: /从已有配置创建模板/ })).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: /手动配置（高级）/ }));
  expect(await screen.findByLabelText('模板名称')).toBeInTheDocument();
});

test('blank create starts with the requested editable template defaults', async () => {
  renderList();
  fireEvent.click(screen.getByRole('button', { name: '新建模板' }));
  fireEvent.click(screen.getByRole('button', { name: /手动配置（高级）/ }));
  fireEvent.click(screen.getByRole('tab', { name: '模型能力' }));
  expect(screen.getByRole('spinbutton', { name: '上下文窗口' })).toHaveValue(262144);
  expect(screen.getByRole('spinbutton', { name: '最大输出 token' })).toHaveValue(65536);
  // Default reasoning does not guess any supported effort levels.
  expect(screen.getByRole('combobox', { name: '支持推理' })).toHaveTextContent('是');
  fireEvent.change(screen.getByRole('spinbutton', { name: '上下文窗口' }), {
    target: { value: '' },
  });
  expect(screen.getByRole('spinbutton', { name: '上下文窗口' })).toHaveValue(null);
});

test('editing an existing template fills missing defaults but permits clearing them before save', async () => {
  const favorite = favoriteFixture('facts-less', 'model');
  const saves: unknown[][] = [];
  setStoreState({
    providers: [],
    saveFavorite: async (...args: unknown[]) => {
      saves.push(args);
      return favorite;
    },
  });
  renderWithI18n(
    <>
      <Toaster />
      <FavoriteEditor favorite={favorite} onClose={() => undefined} />
    </>,
  );
  fireEvent.click(screen.getByRole('tab', { name: '模型能力' }));
  const context = screen.getByRole('spinbutton', { name: '上下文窗口' });
  const output = screen.getByRole('spinbutton', { name: '最大输出 token' });
  expect(context).toHaveValue(262144);
  expect(output).toHaveValue(65536);
  expect(screen.getByRole('combobox', { name: '支持推理' })).toHaveTextContent('是');
  // A typed value replaces the hint instead of mixing with it.
  fireEvent.change(context, { target: { value: '128000' } });
  expect(context).toHaveValue(128000);
  expect(context.getAttribute('placeholder')).toBeNull();
  fireEvent.change(context, { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: '保存模板' }));
  await waitFor(() => expect(saves).toHaveLength(1));
  const payload = saves[0]![0] as { defaults: Record<string, unknown> };
  expect(payload.defaults).toEqual({ maxOutputTokens: 65536, reasoningSupported: true });
});

test('capture links the source profile by default and opting out is explicit', async () => {
  const profile = profileFixture();
  setStoreState({ harnesses: [harnessFixture({ profiles: [profile] })] });
  const actions = stubStoreActions(['captureFavorite']);
  renderWithI18n(<CaptureFavorite onClose={() => undefined} />);
  expect(screen.getByRole('checkbox', { name: '关联来源配置' })).toBeChecked();
  fireEvent.click(screen.getByRole('combobox', { name: '从已有配置创建模板' }));
  fireEvent.click(await screen.findByRole('option', { name: 'claude / openrouter-main' }));
  fireEvent.click(screen.getByRole('button', { name: '从已有配置创建模板' }));
  await waitFor(() => expect(actions.captureFavorite).toHaveLength(1));
  expect(actions.captureFavorite[0]).toEqual([
    'claude',
    'openrouter-main',
    'openrouter-main',
    false,
    true,
  ]);
  fireEvent.click(screen.getByRole('checkbox', { name: '关联来源配置' }));
  fireEvent.click(screen.getByRole('button', { name: '从已有配置创建模板' }));
  await waitFor(() => expect(actions.captureFavorite).toHaveLength(2));
  expect(actions.captureFavorite[1]).toEqual([
    'claude',
    'openrouter-main',
    'openrouter-main',
    false,
    false,
  ]);
});

test('a preset with a matching vault entry pre-fills the channel without any setup', async () => {
  renderList();
  fireEvent.click(screen.getByRole('button', { name: '新建模板' }));
  fireEvent.click(screen.getByRole('button', { name: /快速创建（推荐）/ }));
  fireEvent.click(screen.getByRole('button', { name: 'OpenRouter' }));
  expect(await screen.findByRole('combobox', { name: '服务商账号' })).toHaveTextContent(
    'OpenRouter · 主入口',
  );
  expect(screen.getByText('OpenAI 兼容（Chat Completions）')).toBeInTheDocument();
  expect(screen.queryByLabelText('API Key')).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: '模型能力' }));
  expect(screen.getByRole('spinbutton', { name: '上下文窗口' })).toHaveValue(262144);
  expect(screen.getByRole('spinbutton', { name: '最大输出 token' })).toHaveValue(65536);
});

test('a preset without a vault entry creates it inline and adopts curated model facts', async () => {
  setStoreState({ favorites: [], providers: [], harnesses: [] });
  stubStoreActions(['loadFavorites', 'loadProviders']);
  const deepseek = providerFixture({
    id: 'deepseek',
    name: 'DeepSeek',
    endpoints: [{ key: 'main', label: '', baseUrl: 'https://api.deepseek.com/v1' }],
  });
  const created: unknown[][] = [];
  setStoreState({
    createProvider: async (...args: unknown[]) => {
      created.push(args);
      setStoreState({ providers: [deepseek] });
      return deepseek;
    },
    loadFavoriteCatalog: async () => ({ ok: true, models: [] }),
  });
  renderWithI18n(<ModelFavorites />);
  fireEvent.click(screen.getByRole('button', { name: '新建模板' }));
  fireEvent.click(screen.getByRole('button', { name: /快速创建（推荐）/ }));
  fireEvent.click(screen.getByRole('button', { name: 'DeepSeek' }));
  expect(await screen.findByText(/api\.deepseek\.com/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-test' } });
  fireEvent.click(screen.getByRole('button', { name: '连接供应商' }));
  expect(created[0]).toEqual([
    {
      name: 'DeepSeek',
      apiKey: 'sk-test',
      endpoints: [{ key: 'main', baseUrl: 'https://api.deepseek.com/v1' }],
    },
  ]);
  // Curated candidates are offered without a live catalog, and choosing one adopts its facts.
  fireEvent.click(await screen.findByRole('combobox', { name: /^模型(?:（可多选）)?$/ }));
  fireEvent.click(await screen.findByRole('option', { name: 'deepseek-reasoner' }));
  fireEvent.click(screen.getByRole('tab', { name: '模型能力' }));
  const overrides = within(screen.getByRole('region', { name: '按连接单独设置' }));
  fireEvent.click(overrides.getByRole('button', { name: /deepseek-reasoner/ }));
  expect(overrides.getByRole('combobox', { name: '支持推理' })).toHaveTextContent('是');
  expect(overrides.getByRole('spinbutton', { name: '上下文窗口' })).toHaveValue(128000);
});

test('cloning a template copies every channel under a "copy" name as a fresh draft', async () => {
  const favorite = favoriteFixture('daily', 'model');
  const saved: ModelFavorite = {
    ...favorite,
    id: '00000000-0000-4000-8000-000000000009',
    name: 'daily 副本',
  };
  const saves: unknown[][] = [];
  setStoreState({
    favorites: [favorite],
    providers: [providerFixture()],
    harnesses: [],
    saveFavorite: async (...args: unknown[]) => {
      saves.push(args);
      return saved;
    },
    loadFavoriteCatalog: async () => ({ ok: true }),
  });
  stubStoreActions(['loadFavorites', 'loadProviders', 'loadFavoriteTargets']);
  renderWithI18n(<ModelFavorites />);
  fireEvent.click(screen.getByRole('button', { name: '复制模板' }));
  const nameInput = await screen.findByLabelText('模板名称');
  expect(nameInput).toHaveValue('daily 副本');
  fireEvent.click(screen.getByRole('button', { name: '保存模板' }));
  await waitFor(() => expect(saves).toHaveLength(1));
  const [input, existing] = saves[0]!;
  expect(existing).toBeUndefined();
  expect((input as ModelFavorite).name).toBe('daily 副本');
  const connection = (input as ModelFavorite).connections[0]!;
  expect(connection.requestModelId).toBe('model');
  expect(connection.id).not.toBe(favorite.connections[0]!.id);
});

test('a failed post-save probe warns without blocking the saved template', async () => {
  const favorite = favoriteFixture('daily', 'model');
  setStoreState({
    providers: [],
    saveFavorite: async () => favorite,
    loadFavoriteCatalog: async () => ({ ok: false }),
  });
  renderWithI18n(
    <>
      <Toaster />
      <FavoriteEditor favorite={favorite} onClose={() => undefined} />
    </>,
  );
  fireEvent.click(screen.getByRole('button', { name: '保存模板' }));
  expect(await screen.findByText('模板「daily」已保存。')).toBeInTheDocument();
  await waitFor(() =>
    expect(useAppStore.getState().notice).toEqual([
      { key: 'warning.favorite.probeFailed', params: { count: 1 } },
    ]),
  );
});
