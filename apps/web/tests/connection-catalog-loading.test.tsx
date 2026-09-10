import { expect, rs, test } from '@rstest/core';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { ConnectionCard } from '@/components/model-favorites/connection-card';
import { useAppStore } from '@/stores/app-store';
import {
  favoriteFixture,
  providerFixture,
  renderWithI18n,
  setStoreState,
  stubFetch,
} from './support';

function setup() {
  const connection = favoriteFixture('test', 'manual/model').connections[0]!;
  connection.providerId = 'openrouter';
  connection.endpointKey = 'main';
  setStoreState({ providers: [providerFixture()] });
  return connection;
}

test('multi-model picker refreshes a cached remote catalog without replacing selected models', async () => {
  const connection = setup();
  const onModelsChange = rs.fn();
  setStoreState({
    favoriteCatalogs: { 'openrouter/main': { ok: true, models: ['cached/model'] } },
  });
  const requests: unknown[] = [];
  stubFetch((_url, init) => {
    requests.push(JSON.parse(init.body as string));
    return { result: { ok: true, models: ['remote/one', 'remote/two'] } };
  });
  renderWithI18n(
    <ConnectionCard
      connection={connection}
      models={[connection]}
      index={0}
      disabled={false}
      onChange={() => undefined}
      onModelsChange={onModelsChange}
      onRemove={() => undefined}
    />,
  );
  expect(requests).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '刷新模型列表' }));
  await screen.findByText(/目录中有 2 个模型/);
  expect(requests).toEqual([{ endpoint: 'main', completion: false }]);
  expect(onModelsChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('combobox', { name: '模型（可多选）' }));
  expect(await screen.findByRole('option', { name: 'remote/one' })).toBeVisible();
  expect(screen.getByRole('option', { name: 'remote/two' })).toBeVisible();
  expect(screen.getByRole('option', { name: connection.requestModelId })).toBeVisible();
  expect(screen.queryByRole('option', { name: 'cached/model' })).toBeNull();
  fireEvent.click(screen.getByRole('option', { name: 'remote/two' }));
  expect(onModelsChange).toHaveBeenCalledWith([connection.requestModelId, 'remote/two']);
});

test('StrictMode cleanup does not leave the catalog loading after the next request succeeds', async () => {
  const connection = setup();
  const signals: AbortSignal[] = [];
  stubFetch((_url, init) => {
    const signal = init.signal!;
    signals.push(signal);
    if (signals.length === 1) {
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
          once: true,
        }),
      );
    }
    return { result: { ok: true, models: ['loaded/model'] } };
  });
  renderWithI18n(
    <ConnectionCard
      connection={connection}
      index={0}
      disabled={false}
      onChange={() => undefined}
      onRemove={() => undefined}
    />,
    { reactStrictMode: true },
  );
  await screen.findByText(/目录中有 1 个模型/);
  expect(signals).toHaveLength(2);
  expect(signals[0]!.aborted).toBe(true);
  expect(screen.queryByText('正在获取模型列表…')).toBeNull();
});

test('a stalled catalog times out and can be retried while manual model input remains available', async () => {
  rs.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const connection = setup();
    let attempts = 0;
    stubFetch((_url, init) => {
      if (++attempts === 1) {
        return new Promise((_resolve, reject) =>
          init.signal!.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          ),
        );
      }
      return { result: { ok: true, models: ['retry/model'] } };
    });
    renderWithI18n(
      <ConnectionCard
        connection={connection}
        index={0}
        disabled={false}
        onChange={() => undefined}
        onRemove={() => undefined}
      />,
    );
    expect(screen.getByText('正在获取模型列表…')).toBeInTheDocument();
    await act(async () => {
      await rs.advanceTimersByTimeAsync(25_000);
    });
    expect(screen.queryByText('正在获取模型列表…')).toBeNull();
    expect(screen.getByText('暂时无法获取列表，可手动输入模型 ID。')).toBeVisible();
    expect(screen.getByRole('combobox', { name: /^模型(?:（可多选）)?$/ })).toBeEnabled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '重试' }));
    });
    expect(screen.getByText(/目录中有 1 个模型/)).toBeVisible();
    expect(attempts).toBe(2);
  } finally {
    rs.useRealTimers();
  }
});

test('switching to a cached route cancels the pending request and ignores its late response', async () => {
  const connection = setup();
  let finish!: (value: unknown) => void;
  let signal: AbortSignal | undefined;
  stubFetch((_url, init) => {
    signal = init.signal!;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  setStoreState({
    favoriteCatalogs: { 'openrouter/second': { ok: true, models: ['cached/model'] } },
  });
  const { rerender } = renderWithI18n(
    <ConnectionCard
      connection={connection}
      index={0}
      disabled={false}
      onChange={() => undefined}
      onRemove={() => undefined}
    />,
  );
  rerender(
    <ConnectionCard
      connection={{ ...connection, endpointKey: 'second' }}
      index={0}
      disabled={false}
      onChange={() => undefined}
      onRemove={() => undefined}
    />,
  );
  await waitFor(() => expect(screen.queryByText('正在获取模型列表…')).toBeNull());
  expect(signal!.aborted).toBe(true);
  await act(async () => finish({ result: { ok: true, models: ['stale/model'] } }));
  expect(useAppStore.getState().favoriteCatalogs['openrouter/main']).toBeUndefined();
  expect(screen.getByText(/目录中有 1 个模型/)).toBeVisible();
});
