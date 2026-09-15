import { expect, test } from '@rstest/core';
import type { FavoriteConnection } from '@seaveyon/harness-switch-shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ConnectionCard } from '@/components/model-favorites/connection-card';
import { ConnectionSettings } from '@/components/model-favorites/connection-settings';
import { FavoriteEditor } from '@/components/model-favorites/editor';
import {
  favoriteFixture,
  providerFixture,
  renderWithI18n,
  setStoreState,
  stubStoreActions,
} from './support';

test('custom routes show address and protocol directly and allow optional editing', () => {
  const connection = favoriteFixture('custom', 'model').connections[0]!;
  renderWithI18n(
    <ConnectionSettings
      connection={connection}
      endpoint={{ baseUrl: 'https://custom.example/v1' }}
      fieldErrors={{ [connection.id + '-contextWindow']: 'invalid' }}
      onChange={() => undefined}
    />,
  );
  const toggle = screen.getByRole('button', { name: '更改协议' });
  expect(screen.getByText('https://custom.example/v1')).toBeVisible();
  expect(screen.queryByRole('combobox', { name: '协议' })).toBeNull();
  fireEvent.click(toggle);
  expect(screen.getByText('https://custom.example/v1')).toBeVisible();
  expect(screen.getByRole('combobox', { name: '协议' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '完成' }));
  expect(screen.queryByRole('combobox', { name: '协议' })).toBeNull();
  fireEvent.click(toggle);
  expect(screen.getByRole('combobox', { name: '协议' })).toBeVisible();
});

test('opening an existing template preserves explicit capacities, false reasoning and per-connection unknowns', () => {
  const favorite = favoriteFixture('existing', 'model');
  favorite.defaults = { contextWindow: 128000, reasoningSupported: false };
  favorite.connections[0]!.factOverrides = { maxOutputTokens: null };
  setStoreState({ providers: [] });
  const actions = stubStoreActions(['saveFavorite']);
  renderWithI18n(<FavoriteEditor favorite={favorite} onClose={() => undefined} />);
  fireEvent.click(screen.getByRole('tab', { name: '模型能力' }));
  expect(screen.getByRole('spinbutton', { name: '上下文窗口' })).toHaveValue(128000);
  expect(screen.getByRole('spinbutton', { name: '最大输出 token' })).toHaveValue(65536);
  expect(screen.getByRole('combobox', { name: '支持推理' })).toHaveTextContent('否');
  fireEvent.click(screen.getByRole('button', { name: /route/ }));
  const overrides = within(screen.getByRole('region', { name: '按连接单独设置' }));
  expect(overrides.getByRole('spinbutton', { name: '最大输出 token' })).toHaveValue(null);
  expect(actions.saveFavorite).toHaveLength(0);
  expect(favorite.defaults).toEqual({ contextWindow: 128000, reasoningSupported: false });
});

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
  expect(screen.getByRole('checkbox', { name: 'model' })).toBeChecked();
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
  expect(screen.getByRole('combobox', { name: /^模型(?:（可多选）)?$/ })).toHaveTextContent(
    'Vendor/Exact:ID',
  );
});

test('invalid per-connection capability remains editable and exposes its field error', async () => {
  const favorite = favoriteFixture('daily', 'model');
  favorite.connections[0]!.factOverrides = { contextWindow: 0 };
  setStoreState({ providers: [] });
  const actions = stubStoreActions(['saveFavorite']);
  renderWithI18n(<FavoriteEditor favorite={favorite} onClose={() => undefined} />);
  fireEvent.click(screen.getByRole('button', { name: '保存模板' }));
  const context = within(await screen.findByRole('region', { name: '按连接单独设置' })).getByRole(
    'spinbutton',
    { name: '上下文窗口' },
  );
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
  expect(screen.getByText('暂时无法获取列表，可使用预设或手动输入。')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('combobox', { name: /^模型(?:（可多选）)?$/ }));
  expect(await screen.findByRole('option', { name: 'preset/model' })).toBeInTheDocument();
});

test('an endpoint with one preset protocol shows its address and protocol without extra controls', () => {
  const connection = favoriteFixture('official', 'model').connections[0]!;
  connection.protocol = 'anthropic-messages';
  renderWithI18n(
    <ConnectionSettings
      connection={connection}
      endpoint={{ baseUrl: 'https://api.anthropic.com' }}
      fieldErrors={{}}
      onChange={() => undefined}
    />,
  );
  expect(screen.getByText('Anthropic Messages')).toBeVisible();
  expect(screen.getByText('https://api.anthropic.com')).toBeVisible();
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.queryByRole('combobox')).toBeNull();
});
