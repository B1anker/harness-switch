import { beforeEach, expect, test } from '@rstest/core';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { FavoriteEditor } from '@/components/model-favorites/editor';
import { Toaster } from '@/components/ui/sonner';
import {
  favoriteFixture,
  OFFLINE,
  providerFixture,
  renderWithI18n,
  setStoreState,
  stubFetch,
  stubStoreActions,
} from './support';

beforeEach(() => stubFetch(OFFLINE));

test('validation errors land on the channel fields instead of one generic line', async () => {
  setStoreState({ providers: [providerFixture()] });
  const actions = stubStoreActions(['saveFavorite', 'loadFavoriteCatalog']);
  renderWithI18n(<FavoriteEditor onClose={() => undefined} />);
  fireEvent.click(screen.getByRole('button', { name: '添加模型连接' }));
  fireEvent.click(screen.getByRole('button', { name: '保存模板' }));
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: '服务商账号' })).toHaveAttribute(
      'aria-invalid',
      'true',
    ),
  );
  expect(screen.getByRole('combobox', { name: '模型' })).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getAllByText('请填写此项。').length).toBeGreaterThanOrEqual(2);
  expect(screen.queryByText('请检查名称、渠道和能力声明是否完整且一致。')).toBeNull();
  expect(actions.saveFavorite).toHaveLength(0);
});

test('disabling reasoning clears hidden effort conflicts so the template can be saved', async () => {
  const favorite = favoriteFixture('daily', 'model');
  favorite.defaults = { reasoningSupported: true, supportedReasoningEfforts: ['low', 'high'] };
  favorite.preferences = { reasoningEffort: 'high' };
  setStoreState({ providers: [] });
  const actions = stubStoreActions(['saveFavorite']);
  renderWithI18n(<FavoriteEditor favorite={favorite} onClose={() => undefined} />);
  expect(screen.queryByText('思考能力声明与已声明档位或偏好档位冲突。')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /能力与备注/ }));
  fireEvent.click(screen.getByRole('combobox', { name: '支持推理' }));
  fireEvent.click(screen.getByRole('option', { name: '否' }));
  expect(screen.queryByText('思考能力声明与已声明档位或偏好档位冲突。')).toBeNull();
  expect(screen.getByRole('combobox', { name: '支持推理' }).getAttribute('aria-invalid')).not.toBe(
    'true',
  );
  expect(screen.queryByRole('combobox', { name: '偏好思考档位' })).toBeNull();
  expect(actions.saveFavorite).toHaveLength(0);
});

test('selecting a provider endpoint loads the model catalog automatically', async () => {
  const favorite = favoriteFixture('daily', 'manual/model');
  favorite.connections[0]!.providerId = 'openrouter';
  favorite.connections[0]!.endpointKey = 'main';
  const loads: string[][] = [];
  setStoreState({
    providers: [providerFixture()],
    loadFavoriteCatalog: async (providerId: string, endpointKey: string) => {
      loads.push([providerId, endpointKey]);
      setStoreState({
        favoriteCatalogs: { 'openrouter/main': { ok: true, models: ['a/b'] } },
      });
      return { ok: true, models: ['a/b'] };
    },
  });
  renderWithI18n(<FavoriteEditor favorite={favorite} onClose={() => undefined} />);
  await waitFor(() => expect(loads).toEqual([['openrouter', 'main']]));
  expect(await screen.findByText(/目录中有 1 个模型/)).toBeInTheDocument();
});

test('a failed catalog load degrades to manual entry with a non-blocking hint', async () => {
  const favorite = favoriteFixture('daily', 'manual/model');
  favorite.connections[0]!.providerId = 'openrouter';
  favorite.connections[0]!.endpointKey = 'main';
  setStoreState({
    providers: [providerFixture()],
    loadFavoriteCatalog: async () => {
      throw new Error('offline');
    },
  });
  renderWithI18n(<FavoriteEditor favorite={favorite} onClose={() => undefined} />);
  expect(await screen.findByText('模型目录加载失败，仍可手动输入模型 ID。')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  expect((screen.getByRole('combobox', { name: '模型' }) as HTMLButtonElement).disabled).toBe(
    false,
  );
  fireEvent.click(screen.getByRole('combobox', { name: '模型' }));
  fireEvent.change(screen.getByRole('combobox', { name: '搜索或输入模型 ID' }), {
    target: { value: 'Private/Model' },
  });
  fireEvent.click(await screen.findByRole('option', { name: '使用「Private/Model」' }));
  expect(screen.getByRole('combobox', { name: '模型' })).toHaveTextContent('Private/Model');
});

test('saving a new template toasts a primary action that opens the next step', async () => {
  const saved = favoriteFixture('Vendor/Model:Exact', 'Vendor/Model:Exact');
  const onSaved: Array<[unknown, unknown]> = [];
  setStoreState({
    providers: [providerFixture()],
    saveFavorite: async () => saved,
    loadFavoriteCatalog: async () => ({ ok: true, models: [] }),
  });
  renderWithI18n(
    <>
      <Toaster />
      <FavoriteEditor
        onClose={() => undefined}
        onSaved={(favorite, next) => onSaved.push([favorite, next])}
      />
    </>,
  );
  fireEvent.click(screen.getByRole('button', { name: '添加模型连接' }));
  fireEvent.click(screen.getByRole('combobox', { name: '服务商账号' }));
  fireEvent.click(await screen.findByRole('option', { name: 'OpenRouter · 主入口' }));
  fireEvent.click(screen.getByRole('combobox', { name: '模型' }));
  fireEvent.change(screen.getByRole('combobox', { name: '搜索或输入模型 ID' }), {
    target: { value: 'Vendor/Model:Exact' },
  });
  fireEvent.click(await screen.findByRole('option', { name: '使用「Vendor/Model:Exact」' }));
  fireEvent.click(screen.getByRole('button', { name: '保存模板' }));
  await waitFor(() => expect(onSaved).toEqual([[saved, null]]));
  const action = await screen.findByRole('button', { name: '配置到工具' });
  expect(screen.getByText('模板「Vendor/Model:Exact」已保存。')).toBeInTheDocument();
  fireEvent.click(action);
  expect(onSaved).toEqual([
    [saved, null],
    [saved, 'configure'],
  ]);
});

test('editing a template with affected profiles offers the relationship view instead', async () => {
  const favorite = favoriteFixture('daily', 'model');
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
  const onSaved: Array<[unknown, unknown]> = [];
  setStoreState({
    providers: [],
    saveFavorite: async () => {
      setStoreState({
        favorites: [
          {
            ...favorite,
            references: favorite.references.map((ref) => ({ ...ref, needsUpdate: true })),
          },
        ],
      });
      return favorite;
    },
  });
  renderWithI18n(
    <>
      <Toaster />
      <FavoriteEditor
        favorite={favorite}
        onClose={() => undefined}
        onSaved={(saved, next) => onSaved.push([saved, next])}
      />
    </>,
  );
  fireEvent.click(screen.getByRole('button', { name: '保存模板' }));
  const action = await screen.findByRole('button', { name: '查看受影响配置' });
  fireEvent.click(action);
  expect(onSaved).toEqual([
    [favorite, null],
    [favorite, 'review'],
  ]);
});
