import { afterEach, expect, test } from '@rstest/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { UpdateButton } from '@/components/update-button';

const realFetch = globalThis.fetch;
const realReload = window.location.reload;

afterEach(() => {
  globalThis.fetch = realFetch;
  window.location.reload = realReload;
});

function json(payload: unknown) {
  return { ok: true, json: async () => payload };
}

test('offers an update button when a newer version is available', async () => {
  globalThis.fetch = (async () =>
    json({ current: '0.9.0', latest: '99.0.0', updateAvailable: true })) as unknown as typeof fetch;

  render(<UpdateButton />);
  expect(await screen.findByRole('button', { name: '更新到 v99.0.0' })).toBeInTheDocument();
});

test('stays hidden when running the latest version', async () => {
  globalThis.fetch = (async () =>
    json({ current: '0.9.0', latest: '0.9.0', updateAvailable: false })) as unknown as typeof fetch;

  render(<UpdateButton />);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(screen.queryByRole('button', { name: /更新到/ })).toBeNull();
});

test('posts the update and reloads once the new version answers', async () => {
  let reloaded = false;
  window.location.reload = () => {
    reloaded = true;
  };

  globalThis.fetch = (async (path: string, init: RequestInit = {}) => {
    if (path === '/api/update/check') {
      return json({ current: '0.9.0', latest: '99.0.0', updateAvailable: true });
    }
    if (path === '/api/update' && init.method === 'POST') {
      return json({ status: 'updating' });
    }
    if (path === '/api/version') {
      return json({ name: 'harness-switch', version: '99.0.0' });
    }
    return json({});
  }) as unknown as typeof fetch;

  render(<UpdateButton />);
  fireEvent.click(await screen.findByRole('button', { name: '更新到 v99.0.0' }));
  expect(await screen.findByText('更新中…')).toBeInTheDocument();

  for (let i = 0; i < 80; i++) {
    if (reloaded) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  expect(reloaded).toBe(true);
});
