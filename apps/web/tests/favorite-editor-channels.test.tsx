import { expect, test } from '@rstest/core';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { FavoriteEditor } from '@/components/model-favorites/editor';
import { providerFixture, renderWithI18n, setStoreState, stubStoreActions } from './support';

test('a blank template starts with an add-channel empty state, not an empty card', () => {
  setStoreState({ providers: [providerFixture()] });
  renderWithI18n(<FavoriteEditor onClose={() => undefined} />);
  expect(screen.queryByRole('combobox', { name: '供应商 / 入口' })).toBeNull();
  expect(
    screen.getByText('还没有渠道。添加一个供应商渠道，或先保存为待连接模板。'),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '+ 添加渠道' }));
  expect(screen.getByRole('combobox', { name: '供应商 / 入口' })).toBeInTheDocument();
});

test('an empty vault offers inline provider creation and selects the new entry', async () => {
  setStoreState({ providers: [] });
  stubStoreActions(['loadProviders', 'deleteProvider', 'revealProvider']);
  renderWithI18n(<FavoriteEditor onClose={() => undefined} />);
  fireEvent.click(screen.getByRole('button', { name: '添加供应商' }));
  expect(await screen.findByRole('dialog', { name: '凭据库' })).toBeInTheDocument();
  // The user creates the entry inside the vault dialog; the store reload picks it up.
  setStoreState({ providers: [providerFixture()] });
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: '供应商 / 入口' })).toHaveTextContent(
      'OpenRouter · 主入口',
    ),
  );
});

test('a channel card with an empty vault embeds the add-provider entry', () => {
  setStoreState({ providers: [] });
  stubStoreActions(['loadProviders']);
  renderWithI18n(<FavoriteEditor onClose={() => undefined} />);
  // No vault entries: the empty state shows both paths; adding a channel first keeps the
  // add-provider entry inside the card itself.
  fireEvent.click(screen.getByRole('button', { name: '+ 添加渠道' }));
  expect(screen.getByRole('combobox', { name: '供应商 / 入口' })).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: '添加供应商' }).length).toBeGreaterThanOrEqual(1);
});
