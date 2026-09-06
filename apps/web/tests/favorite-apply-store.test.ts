import { expect, test } from '@rstest/core';
import { ERROR_CODES, type FavoriteOperation, HARNESS_IDS } from '@seaveyon/harness-switch-shared';
import { favoriteApplyPath } from '@/lib/api';
import { useAppStore } from '@/stores/app-store';
import {
  favoriteFixture,
  favoritePlanFixture,
  recordRequests,
  setStoreState,
  status,
  stubFetch,
  stubStoreActions,
} from './support';

test('apply notices count actual saved, switched, unchanged and unfinished results', async () => {
  const base = favoritePlanFixture(favoriteFixture('daily', 'model'));
  const plan = {
    ...base,
    items: HARNESS_IDS.map((harness, index) => ({
      ...base.items[0]!,
      harness,
      mode: index === 1 ? ('activate' as const) : ('save' as const),
    })),
  };
  setStoreState({ favoritePlan: plan, currentUser: 'owner' });
  stubStoreActions(['loadFavorites', 'loadHarnesses']);
  stubFetch(() => ({
    data: {
      requestId: 'request',
      items: [
        { harness: 'claude', profile: 'daily', status: 'applied' },
        { harness: 'codex', profile: 'daily', status: 'applied' },
        { harness: 'kimi', profile: 'daily', status: 'unchanged' },
        { harness: 'pi', profile: 'daily', status: 'failed', code: ERROR_CODES.requestFailed },
      ],
    },
  }));
  const operation = await useAppStore.getState().applyFavorite('request');
  expect(operation?.items.find((item) => item.harness === 'dsh')).toEqual({
    harness: 'dsh',
    profile: 'daily',
    status: 'skipped',
  });
  expect(useAppStore.getState().notice).toEqual([
    { key: 'favorites.resultNoticeSaved', params: { count: 1 } },
    { key: 'favorites.resultNoticeActivated', params: { count: 1 } },
    { key: 'favorites.resultNoticeUnchanged', params: { count: 1 } },
    { key: 'favorites.resultNoticeFailed', params: { count: 1 } },
    { key: 'favorites.resultNoticeSkipped', params: { count: 1 } },
  ]);
});

test('an entirely failed application has no success notice', async () => {
  const plan = favoritePlanFixture(favoriteFixture('daily', 'model'));
  setStoreState({ favoritePlan: plan });
  stubStoreActions(['loadFavorites', 'loadHarnesses']);
  stubFetch(() => ({
    data: { requestId: 'failed', items: [{ harness: 'pi', profile: 'daily', status: 'failed' }] },
  }));
  await useAppStore.getState().applyFavorite('failed');
  expect(useAppStore.getState().notice).toEqual([
    { key: 'favorites.resultNoticeFailed', params: { count: 1 } },
  ]);
});

test('late application results cannot repopulate a cleared dialog', async () => {
  const plan = favoritePlanFixture(favoriteFixture('daily', 'model'));
  setStoreState({ favoritePlan: plan, notice: [] });
  const refresh = stubStoreActions(['loadFavorites', 'loadHarnesses']);
  let finish!: (value: { data: FavoriteOperation }) => void;
  stubFetch(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const applying = useAppStore.getState().applyFavorite('request');
  useAppStore.getState().clearFavoritePlan();
  finish({
    data: { requestId: 'request', items: [{ harness: 'pi', profile: 'daily', status: 'applied' }] },
  });
  expect(await applying).toBeUndefined();
  expect(useAppStore.getState().favoriteOperation).toBeNull();
  expect(useAppStore.getState().favoriteOperationHistory).toEqual([]);
  expect(useAppStore.getState().notice).toEqual([]);
  expect(refresh.loadHarnesses).toEqual([]);
});

test('a stale error recovers the same request before offering a new preview', async () => {
  const plan = favoritePlanFixture(favoriteFixture('daily', 'model'));
  setStoreState({ favoritePlan: plan });
  stubStoreActions(['loadFavorites', 'loadHarnesses']);
  const capture = recordRequests((_url, init) =>
    capture.requests.length === 1
      ? status(409, { code: ERROR_CODES.favoritePlanStale })
      : {
          data: {
            requestId: JSON.parse(String(init.body)).requestId,
            items: [{ harness: 'pi', profile: 'daily', status: 'applied' }],
          },
        },
  );
  stubFetch(capture.handler);
  const result = await useAppStore.getState().applyFavorite('same-request');
  expect(result?.items[0]?.status).toBe('applied');
  expect(capture.requests).toEqual([
    {
      path: favoriteApplyPath(plan.id),
      method: 'POST',
      body: JSON.stringify({ requestId: 'same-request' }),
    },
    {
      path: favoriteApplyPath(plan.id),
      method: 'POST',
      body: JSON.stringify({ requestId: 'same-request' }),
    },
  ]);
});

test('a session change prevents stale-request recovery and result disclosure', async () => {
  const plan = favoritePlanFixture(favoriteFixture('daily', 'model'));
  setStoreState({ favoritePlan: plan, currentUser: 'first-user', notice: [] });
  let finish!: (value: Response) => void;
  const capture = recordRequests(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  stubFetch(capture.handler);
  const applying = useAppStore.getState().applyFavorite('request');
  setStoreState({ currentUser: 'second-user' });
  finish(status(409, { code: ERROR_CODES.favoritePlanStale }));
  expect(await applying).toBeUndefined();
  expect(capture.requests).toHaveLength(1);
  expect(useAppStore.getState().notice).toEqual([]);
  expect(useAppStore.getState().favoriteOperation).toBeNull();
});
