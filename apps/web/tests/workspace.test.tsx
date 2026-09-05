import { expect, test } from '@rstest/core';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { RecoveryTimeline } from '@/components/recovery-timeline';
import { Workspace } from '@/components/workspace';
import { ConfigurationSwitcher } from '@/components/workspace/configuration-switcher';
import { useAppStore } from '@/stores/app-store';
import {
  favoriteFixture,
  favoritePlanFixture,
  favoriteTargetFixture,
  harnessFixture,
  profileFixture,
  renderWithI18n,
  setStoreState,
  stubFetch,
  stubStoreActions,
} from './support';

test('home shows only the active route and opens the unified configuration workspace', () => {
  const profile = profileFixture({ harness: 'pi', name: 'current-profile' });
  setStoreState({
    favorites: [],
    providers: [],
    harnesses: [
      harnessFixture({
        id: 'pi',
        label: 'Pi',
        profiles: [profile],
        active: { name: profile.name, model: profile.model, baseUrl: profile.baseUrl },
      }),
    ],
  });
  let configured = '';
  renderWithI18n(
    <Workspace
      selectedHarnessId="pi"
      onSelectHarness={() => {}}
      onConfigure={(id) => {
        configured = id;
      }}
      onHistory={() => {}}
    />,
  );
  expect(screen.getByText('当前链路')).toBeInTheDocument();
  expect(screen.getByText('current-profile')).toBeInTheDocument();
  expect(screen.getByText(profile.model)).toBeInTheDocument();
  expect(screen.queryByLabelText('选择收藏模型')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '配置与切换' }));
  expect(configured).toBe('pi');
});

test('unified configuration workspace previews a selected favorite as an uncommitted branch', async () => {
  const favorite = favoriteFixture('daily', 'exact/request-id');
  const plan = favoritePlanFixture(favorite);
  setStoreState({
    favorites: [favorite],
    providers: [],
    harnesses: [
      harnessFixture({
        id: 'pi',
        label: 'Pi',
        active: { name: 'pi-current', model: 'gpt-5.6-terra', baseUrl: 'https://example.test' },
      }),
    ],
    favoriteTargets: { [favorite.id]: [favoriteTargetFixture(favorite)] },
    planFavorite: async () => {
      setStoreState({
        favoritePlan: { ...plan, items: plan.items.map((item) => ({ ...item, mode: 'activate' })) },
      });
    },
  });
  const actions = stubStoreActions([
    'loadFavorites',
    'loadProviders',
    'loadFavoriteBackups',
    'loadFavoriteTargets',
    'applyFavorite',
  ]);
  renderWithI18n(
    <ConfigurationSwitcher
      harness={useAppStore.getState().harnesses[0]!}
      onNewProfile={() => {}}
      onOpenTemplate={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '从模板创建配置' }));
  expect(screen.queryByRole('button', { name: '预览切换' })).toBeNull();
  fireEvent.click(screen.getByRole('combobox', { name: '选择模板' }));
  fireEvent.click(await screen.findByRole('option', { name: 'daily' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '预览切换' })).toBeEnabled());
  expect(screen.getByText('当前与候选链路')).toBeInTheDocument();
  expect(screen.getByText('Pi 的候选旁路')).toBeInTheDocument();
  expect(
    screen.getByText('这是 Pi 的预览目标，尚未写入；其他工具保持各自当前配置。'),
  ).toBeInTheDocument();
  expect(screen.getByText('gpt-5.6-terra')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '预览切换' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '确认保存并切换 1 个工具' })).toBeEnabled(),
  );
  expect(screen.queryByRole('checkbox', { name: 'Pi' })).toBeNull();
  expect(actions.applyFavorite).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '确认保存并切换 1 个工具' }));
  await waitFor(() => expect(actions.applyFavorite).toHaveLength(1));
});

test('ambiguous channels require an explicit choice instead of silently switching credentials', async () => {
  const favorite = favoriteFixture('daily', 'model');
  favorite.connections.push({
    ...favorite.connections[0]!,
    id: '00000000-0000-4000-8000-000000000005',
    label: 'alternate',
  });
  const target = favoriteTargetFixture(favorite);
  target.connections.push({ ...target.connections[0]!, id: favorite.connections[1]!.id });
  setStoreState({
    favorites: [favorite],
    providers: [],
    harnesses: [harnessFixture({ id: 'pi', label: 'Pi' })],
    favoriteTargets: { [favorite.id]: [target] },
  });
  const actions = stubStoreActions([
    'loadFavorites',
    'loadProviders',
    'loadFavoriteBackups',
    'loadFavoriteTargets',
    'planFavorite',
  ]);
  renderWithI18n(
    <ConfigurationSwitcher
      harness={useAppStore.getState().harnesses[0]!}
      onNewProfile={() => {}}
      onOpenTemplate={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '从模板创建配置' }));
  fireEvent.click(screen.getByRole('combobox', { name: '选择模板' }));
  fireEvent.click(await screen.findByRole('option', { name: 'daily' }));
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: '选择渠道' })).toBeInTheDocument(),
  );
  expect(screen.getByRole('button', { name: '预览切换' })).toBeDisabled();
  fireEvent.click(screen.getByRole('combobox', { name: '选择渠道' }));
  fireEvent.click(screen.getByRole('option', { name: 'alternate · model' }));
  fireEvent.click(screen.getByRole('button', { name: '预览切换' }));
  await waitFor(() => expect(actions.planFavorite).toHaveLength(1));
  expect(actions.planFavorite[0]![0]).toMatchObject({
    items: [{ harness: 'pi', connectionId: favorite.connections[1]!.id, mode: 'activate' }],
  });
});

test('rapid timeline selection keeps the latest preview and restores that exact fingerprint', async () => {
  const pending = new Map<string, (value: unknown) => void>();
  stubFetch(
    (url) =>
      new Promise((resolve) => {
        pending.set(url, resolve);
      }),
  );
  setStoreState({
    harnesses: [],
    favoriteBackups: [
      {
        id: 'first',
        createdAt: '2026-09-05T01:00:00Z',
        reason: 'change',
        context: { action: 'update', name: 'first' },
      },
      {
        id: 'second',
        createdAt: '2026-09-05T00:00:00Z',
        reason: 'change',
        context: { action: 'update', name: 'second' },
      },
    ],
  });
  const actions = stubStoreActions(['loadFavoriteBackups', 'restoreFavoriteBackup']);
  renderWithI18n(<RecoveryTimeline />);
  fireEvent.click(screen.getByRole('button', { name: /first/ }));
  fireEvent.click(screen.getByRole('button', { name: /second/ }));
  await act(async () => {
    pending.get('/api/model-favorites/backups/second/preview')!(response('second'));
  });
  await waitFor(() => expect(screen.getByText('/second.json')).toBeInTheDocument());
  await act(async () => {
    pending.get('/api/model-favorites/backups/first/preview')!(response('first'));
  });
  expect(screen.queryByText('/first.json')).toBeNull();
  expect(useAppStore.getState().favoriteBackupPreview?.id).toBe('second');
  expect(actions.restoreFavoriteBackup).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '全局恢复到此时' }));
  await waitFor(() =>
    expect(actions.restoreFavoriteBackup).toEqual([['second', 'second-fingerprint']]),
  );
});

test('a cleared or superseded switch preview cannot reappear after navigation', async () => {
  const favorite = favoriteFixture('daily', 'model');
  let respond!: (value: unknown) => void;
  stubFetch(
    () =>
      new Promise((resolve) => {
        respond = resolve;
      }),
  );
  const work = useAppStore
    .getState()
    .planFavorite({ favoriteId: favorite.id, expectedRevision: 1, items: [] });
  useAppStore.getState().clearFavoritePlan();
  respond({ data: favoritePlanFixture(favorite) });
  await work;
  expect(useAppStore.getState().favoritePlan).toBeNull();
});

const response = (id: string) => ({
  data: {
    id,
    fingerprint: id + '-fingerprint',
    files: [{ key: 'store/favorites', path: '/' + id + '.json', action: 'replace' }],
  },
});
