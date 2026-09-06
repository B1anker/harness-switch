import { expect, test } from '@rstest/core';
import type { FavoriteConnection } from '@seaveyon/harness-switch-shared';
import { fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { ChannelOverrides } from '@/components/model-favorites/channel-overrides';
import { favoriteFixture, renderWithI18n } from './support';

function setup(custom = false) {
  const favorite = favoriteFixture('daily', 'model');
  favorite.defaults = { contextWindow: 32000, reasoningSupported: true };
  let saved: FavoriteConnection = {
    ...favorite.connections[0]!,
    factOverrides: custom ? { contextWindow: null, reasoningSupported: false } : {},
    preferenceOverrides: custom ? { reasoningEffort: 'high' as const } : {},
  };
  function Editor() {
    const [connection, setConnection] = useState(saved);
    return (
      <ChannelOverrides
        favorite={favorite}
        connection={connection}
        onChange={(patch) => {
          saved = { ...connection, ...patch };
          setConnection(saved);
        }}
      />
    );
  }
  renderWithI18n(<Editor />);
  fireEvent.click(screen.getByRole('button', { name: '此渠道的特殊设置（可选）' }));
  return () => saved;
}

test('following the template hides optional controls and enabling customization does not change values', () => {
  const current = setup();
  expect(screen.queryByRole('spinbutton')).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: '为此渠道单独设置' }));
  expect(screen.getByRole('spinbutton', { name: '上下文窗口' })).toHaveAttribute(
    'placeholder',
    '跟随模板：32000',
  );
  expect(current().factOverrides).toEqual({});
  expect(current().preferenceOverrides).toEqual({});
});

test('editing and restoring a numeric override preserves other channel overrides', () => {
  const current = setup(true);
  const field = screen.getByRole('spinbutton', { name: '上下文窗口' });
  expect(field).toHaveAttribute('placeholder', '此渠道不设置（不使用模板值）');
  fireEvent.change(field, { target: { value: '64000' } });
  expect(current().factOverrides).toMatchObject({
    contextWindow: 64000,
    reasoningSupported: false,
  });
  fireEvent.click(screen.getAllByRole('button', { name: '跟随模板' })[0]!);
  expect(current().factOverrides.contextWindow).toBeUndefined();
  expect(current().factOverrides.reasoningSupported).toBe(false);
  expect(current().preferenceOverrides.reasoningEffort).toBe('high');
});

test('existing overrides are visible and disabling customization restores all template defaults', () => {
  const current = setup(true);
  const toggle = screen.getByRole('checkbox', { name: '为此渠道单独设置' });
  expect(toggle).toBeChecked();
  fireEvent.click(toggle);
  expect(current().factOverrides).toEqual({});
  expect(current().preferenceOverrides).toEqual({});
  expect(screen.queryByRole('spinbutton')).toBeNull();
});
