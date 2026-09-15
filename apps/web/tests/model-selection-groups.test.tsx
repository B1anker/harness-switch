import { expect, rs, test } from '@rstest/core';
import { fireEvent, screen } from '@testing-library/react';
import { HarnessCard } from '@/components/harness-card';
import { ModelSelectionGroups } from '@/components/model-favorites/editor/model-selection-groups';
import { profileGroups } from '@/lib/profile-groups';
import {
  favoriteFixture,
  harnessFixture,
  profileFixture,
  renderWithI18n,
  setStoreState,
} from './support';

test('group selection and inversion preserve models belonging to other connections', () => {
  const first = favoriteFixture('daily', 'model-one').connections[0]!;
  const connections = [
    { ...first, id: 'one', groupId: 'group-a', label: 'Group A' },
    { ...first, id: 'two', groupId: 'group-a', label: 'Group A', requestModelId: 'model-two' },
    { ...first, id: 'three', groupId: 'group-b', label: 'Group B', requestModelId: 'model-three' },
  ];
  const onChange = rs.fn();
  renderWithI18n(
    <ModelSelectionGroups
      connections={connections}
      selectedIds={['one', 'three']}
      onChange={onChange}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /Group A/ }));
  fireEvent.click(screen.getByRole('button', { name: '全选' }));
  expect(onChange).toHaveBeenLastCalledWith(['one', 'three', 'two']);
  fireEvent.click(screen.getByRole('button', { name: '反选' }));
  expect(onChange).toHaveBeenLastCalledWith(['three', 'two']);
  fireEvent.change(screen.getByRole('textbox', { name: '搜索连接或模型' }), {
    target: { value: 'model-two' },
  });
  fireEvent.click(screen.getByRole('button', { name: '全选' }));
  expect(onChange).toHaveBeenLastCalledWith(['one', 'three', 'two']);
  expect(screen.queryByRole('checkbox', { name: 'model-one' })).toBeNull();
});

test.each([{ id: 'kimi' as const }, { id: 'dsh' as const }])(
  '%s presents one template configuration with multiple selectable models',
  ({ id }) => {
    const favorite = favoriteFixture('Daily template', 'model-one');
    const profiles = ['model-one', 'model-two'].map((model, index) =>
      profileFixture({
        harness: id,
        name: `generated-${index}`,
        model,
        modelFavorite: {
          favoriteId: favorite.id,
          connectionId: favorite.connections[0]!.id,
          appliedRevision: 1,
          projectionVersion: 1,
          baseline: { harness: id, model, providerId: '', providerEndpoint: '', extras: {} },
          collectionOverrides: { factOverrides: {}, preferenceOverrides: {} },
        },
      }),
    );
    const harness = harnessFixture({ id, profiles, official: undefined });
    expect(profileGroups(harness)).toHaveLength(1);
    expect(profileGroups(harnessFixture({ profiles }))).toHaveLength(2);
    setStoreState({ favorites: [favorite] });
    renderWithI18n(
      <HarnessCard
        harness={harness}
        onAdd={() => undefined}
        onEdit={() => undefined}
        onOpenTemplate={() => undefined}
      />,
    );
    expect(screen.getByText('Daily template')).toBeVisible();
    expect(screen.getByText('多模型配置 · 2 个模型')).toBeVisible();
    expect(screen.queryByRole('button', { name: '编辑 generated-0' })).toBeNull();
    fireEvent.click(screen.getByRole('combobox', { name: '启动默认模型' }));
    expect(screen.getByRole('option', { name: /model-one/ })).toBeVisible();
    expect(screen.getByRole('option', { name: /model-two/ })).toBeVisible();
  },
);
