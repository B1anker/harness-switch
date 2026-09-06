import { expect, test } from '@rstest/core';
import type { FavoriteConnection } from '@seaveyon/harness-switch-shared';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ConnectionCard } from '@/components/model-favorites/connection-card';
import { FavoriteEditor } from '@/components/model-favorites/editor';
import {
  favoriteFixture,
  providerFixture,
  renderWithI18n,
  setStoreState,
  stubStoreActions,
} from './support';

test('an existing account still offers adding a provider without losing the template draft', async () => {
  const favorite = favoriteFixture('existing draft', 'model');
  favorite.connections[0]!.providerId = 'openrouter';
  favorite.connections[0]!.endpointKey = 'main';
  setStoreState({
    providers: [providerFixture()],
    favoriteCatalogs: { 'openrouter/main': { ok: true, models: [] } },
  });
  stubStoreActions(['loadProviders']);
  renderWithI18n(<FavoriteEditor favorite={favorite} onClose={() => undefined} />);
  fireEvent.change(screen.getByLabelText('模板名称'), { target: { value: 'keep my draft' } });
  fireEvent.click(screen.getByRole('button', { name: '添加供应商' }));
  const vault = await screen.findByRole('dialog', { name: '凭据库' });
  fireEvent.keyDown(vault, { key: 'Escape', code: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '凭据库' })).toBeNull());
  expect(screen.getByLabelText('模板名称')).toHaveValue('keep my draft');
  expect(screen.getByRole('combobox', { name: '模型' })).toHaveTextContent('model');
});

test('selecting a known endpoint changes its protocol together and keeps the exact model ID', async () => {
  const connection = favoriteFixture('model', 'Vendor/Exact:ID').connections[0]!;
  const patches: Partial<FavoriteConnection>[] = [];
  setStoreState({
    providers: [
      providerFixture({
        id: 'kimi',
        name: 'Kimi',
        endpoints: [
          { key: 'messages', label: 'Messages', baseUrl: 'https://api.moonshot.cn/anthropic' },
        ],
      }),
    ],
  });
  renderWithI18n(
    <ConnectionCard
      connection={connection}
      index={0}
      disabled={false}
      onChange={(patch) => patches.push(patch)}
      onRemove={() => undefined}
    />,
  );
  fireEvent.click(screen.getByRole('combobox', { name: '服务商账号' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Kimi · Messages' }));
  expect(patches).toEqual([
    { providerId: 'kimi', endpointKey: 'messages', protocol: 'anthropic-messages' },
  ]);
  expect(screen.getByRole('combobox', { name: '模型' })).toHaveTextContent('Vendor/Exact:ID');
});

test('invalid per-connection capability remains editable and exposes its field error', async () => {
  const favorite = favoriteFixture('daily', 'model');
  favorite.connections[0]!.factOverrides = { contextWindow: 0 };
  setStoreState({ providers: [] });
  const actions = stubStoreActions(['saveFavorite']);
  renderWithI18n(<FavoriteEditor favorite={favorite} onClose={() => undefined} />);
  fireEvent.click(screen.getByRole('button', { name: '保存模板' }));
  const context = await screen.findByRole('spinbutton', { name: '上下文窗口' });
  expect(context).toHaveValue(0);
  expect(context).toHaveAttribute('aria-invalid', 'true');
  expect(actions.saveFavorite).toHaveLength(0);
});

test('a failed catalog explains that preset candidates and manual IDs are still available', async () => {
  const connection = favoriteFixture('daily', 'model').connections[0]!;
  connection.providerId = 'openrouter';
  connection.endpointKey = 'main';
  setStoreState({
    providers: [providerFixture()],
    favoriteCatalogs: { 'openrouter/main': { ok: false, models: [] } },
  });
  renderWithI18n(
    <ConnectionCard
      connection={connection}
      index={0}
      disabled={false}
      modelHints={['preset/model']}
      onChange={() => undefined}
      onRemove={() => undefined}
    />,
  );
  expect(
    screen.getByText('模型目录加载失败，仍可选择预设候选、手动填写模型 ID 或重试。'),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('combobox', { name: '模型' }));
  expect(await screen.findByRole('option', { name: 'preset/model' })).toBeInTheDocument();
});
