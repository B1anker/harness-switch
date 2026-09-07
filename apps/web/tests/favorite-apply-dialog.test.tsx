import { expect, test } from '@rstest/core';
import { ERROR_CODES, type FavoritePlanRequest } from '@seaveyon/harness-switch-shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ModelFavoriteApplyDialog } from '@/components/model-favorite-apply-dialog';
import { favoriteApplyPath, favoritePlansPath } from '@/lib/api';
import { useAppStore } from '@/stores/app-store';
import {
  favoriteFixture,
  favoritePlanFixture,
  favoriteTargetFixture,
  harnessFixture,
  recordRequests,
  renderWithI18n,
  setStoreState,
  status,
  stubFetch,
  stubStoreActions,
} from './support';

test('partial success remains visible and retry previews only unfinished tools with a new request', async () => {
  const favorite = favoriteFixture('daily', 'model');
  const base = favoritePlanFixture(favorite);
  const plan = {
    ...base,
    items: [
      base.items[0]!,
      { ...base.items[0]!, harness: 'codex' as const },
      { ...base.items[0]!, harness: 'kimi' as const },
    ],
  };
  setStoreState({
    favoritePlan: plan,
    favoriteTargets: { [favorite.id]: [favoriteTargetFixture(favorite)] },
  });
  stubStoreActions(['loadFavorites', 'loadHarnesses', 'loadFavoriteTargets']);
  const capture = recordRequests((url, init) => {
    const body = JSON.parse(String(init.body));
    if (url === favoriteApplyPath(plan.id)) {
      return {
        data: {
          requestId: body.requestId,
          items: [
            { harness: 'pi', profile: 'daily', status: 'applied' },
            {
              harness: 'codex',
              profile: 'daily',
              status: 'failed',
              code: ERROR_CODES.requestFailed,
            },
          ],
        },
      };
    }
    if (url === favoritePlansPath()) {
      return {
        data: {
          ...plan,
          id: 'retry-plan',
          items: plan.items.filter((item) => item.harness !== 'pi'),
        },
      };
    }
    return {
      data: {
        requestId: body.requestId,
        items: [
          { harness: 'codex', profile: 'daily', status: 'applied' },
          { harness: 'kimi', profile: 'daily', status: 'applied' },
        ],
      },
    };
  });
  stubFetch(capture.handler);
  let closed = 0;
  renderWithI18n(
    <ModelFavoriteApplyDialog
      favorite={favorite}
      initialItems={plan.items}
      initialPreview
      onClose={() => {
        closed++;
      }}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '保存 3 份备用配置' }));
  await waitFor(() =>
    expect(screen.getByRole('heading', { name: '还有配置需要处理' })).toBeInTheDocument(),
  );
  const results = screen.getByRole('region', { name: '查看结果' });
  expect(within(results).getByText('已保存备用')).toBeInTheDocument();
  expect(within(results).getByText('未完成')).toBeInTheDocument();
  expect(within(results).getByText('未执行')).toBeInTheDocument();
  expect(closed).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: '重新预览未完成项' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '保存 2 份备用配置' })).toBeEnabled(),
  );
  const preview = capture.requests.find((request) => request.path === favoritePlansPath())!;
  expect(
    JSON.parse(preview.body).items.map(
      (item: FavoritePlanRequest['items'][number]) => item.harness,
    ),
  ).toEqual(['codex', 'kimi']);
  fireEvent.click(screen.getByRole('button', { name: '保存 2 份备用配置' }));
  await waitFor(() =>
    expect(screen.getByRole('heading', { name: '配置已完成' })).toBeInTheDocument(),
  );
  expect(screen.getAllByText('已保存备用')).toHaveLength(3);
  const applies = capture.requests.filter((request) => request.path.endsWith('/apply'));
  expect(JSON.parse(applies[0]!.body).requestId).not.toBe(JSON.parse(applies[1]!.body).requestId);
  expect(applies).toHaveLength(2);
  expect(closed).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: '完成' }));
  expect(closed).toBe(1);
});

test('quick save keeps save mode and produces a usable fresh preview after a failed result', async () => {
  const favorite = favoriteFixture('daily', 'model');
  const base = favoritePlanFixture(favorite);
  const harness = harnessFixture({ id: 'pi', label: 'Pi' });
  setStoreState({ favoriteTargets: { [favorite.id]: [favoriteTargetFixture(favorite)] } });
  stubStoreActions(['loadFavorites', 'loadHarnesses', 'loadFavoriteTargets']);
  let previews = 0;
  let applies = 0;
  const capture = recordRequests((url, init) => {
    const body = JSON.parse(String(init.body));
    if (url === favoritePlansPath()) {
      previews++;
      return {
        data: {
          ...base,
          id: 'plan-' + previews,
          items: body.items.map((item: FavoritePlanRequest['items'][number]) => ({
            ...base.items[0]!,
            ...item,
          })),
        },
      };
    }
    applies++;
    return {
      data: {
        requestId: body.requestId,
        items: [{ harness: 'pi', profile: 'daily', status: applies === 1 ? 'failed' : 'applied' }],
      },
    };
  });
  stubFetch(capture.handler);
  renderWithI18n(
    <ModelFavoriteApplyDialog
      favorite={favorite}
      quickHarness={harness}
      initialMode="save"
      onClose={() => undefined}
    />,
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '保存 1 份备用配置' })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: '保存 1 份备用配置' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '重新预览未完成项' })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: '重新预览未完成项' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '保存 1 份备用配置' })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: '保存 1 份备用配置' }));
  await waitFor(() => expect(screen.getByText('已保存备用')).toBeInTheDocument());
  expect(screen.getByText('已保存到工具的配置列表，当前使用的配置保持不变。')).toBeInTheDocument();
  const requests = capture.requests.filter((entry) => entry.path === favoritePlansPath());
  expect(requests).toHaveLength(2);
  expect(requests.every((entry) => JSON.parse(entry.body).items[0].mode === 'save')).toBe(true);
  const writes = capture.requests.filter((entry) => entry.path.endsWith('/apply'));
  expect(writes.map((entry) => entry.path)).toEqual([
    favoriteApplyPath('plan-1'),
    favoriteApplyPath('plan-2'),
  ]);
  expect(JSON.parse(writes[0]!.body).requestId).not.toBe(JSON.parse(writes[1]!.body).requestId);
});

test('an uncertain request is checked with the same id instead of replayed through a new plan', async () => {
  const favorite = favoriteFixture('daily', 'model');
  const plan = favoritePlanFixture(favorite);
  setStoreState({ favoritePlan: plan });
  stubStoreActions(['loadFavorites', 'loadHarnesses', 'loadFavoriteTargets']);
  const capture = recordRequests((_url, init) => {
    if (capture.requests.length === 1) {
      throw new Error('connection interrupted');
    }
    return {
      data: {
        requestId: JSON.parse(String(init.body)).requestId,
        items: [{ harness: 'pi', profile: 'daily', status: 'applied' }],
      },
    };
  });
  stubFetch(capture.handler);
  renderWithI18n(
    <ModelFavoriteApplyDialog
      favorite={favorite}
      initialItems={plan.items}
      initialPreview
      onClose={() => undefined}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '保存 1 份备用配置' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '重新检查结果并重试' })).toBeEnabled(),
  );
  expect(screen.getByRole('button', { name: '返回选择' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '重新检查结果并重试' }));
  await waitFor(() => expect(screen.getByText('已保存备用')).toBeInTheDocument());
  expect(capture.requests[0]).toEqual(capture.requests[1]);
});

test('an expired plan offers a fresh preview and does not report completion', async () => {
  const favorite = favoriteFixture('daily', 'model');
  const plan = favoritePlanFixture(favorite);
  setStoreState({ favoritePlan: plan });
  stubStoreActions(['loadFavoriteTargets']);
  const capture = recordRequests((url) =>
    url === favoritePlansPath()
      ? { data: { ...plan, id: 'fresh-plan' } }
      : status(409, { code: ERROR_CODES.favoritePlanExpired }),
  );
  stubFetch(capture.handler);
  renderWithI18n(
    <ModelFavoriteApplyDialog
      favorite={favorite}
      initialItems={plan.items}
      initialPreview
      onClose={() => undefined}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '保存 1 份备用配置' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '重新生成预览' })).toBeEnabled());
  expect(screen.queryByRole('heading', { name: '配置已完成' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新生成预览' }));
  await waitFor(() => expect(useAppStore.getState().favoritePlan?.id).toBe('fresh-plan'));
  expect(screen.getByRole('button', { name: '保存 1 份备用配置' })).toBeEnabled();
});
