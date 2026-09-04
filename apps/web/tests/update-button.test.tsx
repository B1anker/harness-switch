import { afterEach, expect, test } from '@rstest/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { UpdateButton } from '@/components/update-button';
import { stubFetch } from './support';

const realReload = window.location.reload;

afterEach(() => {
  window.location.reload = realReload;
});

test('offers an update button when a newer version is available', async () => {
  stubFetch(() => ({ current: '0.9.0', latest: '99.0.0', updateAvailable: true }));

  render(<UpdateButton />);
  expect(await screen.findByRole('button', { name: '更新到 v99.0.0' })).toBeInTheDocument();
});

test('stays hidden when running the latest version', async () => {
  stubFetch(() => ({ current: '0.9.0', latest: '0.9.0', updateAvailable: false }));

  render(<UpdateButton />);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(screen.queryByRole('button', { name: /更新到/ })).toBeNull();
});

test('posts the update and reloads once the new version answers', async () => {
  let reloaded = false;
  window.location.reload = () => {
    reloaded = true;
  };

  stubFetch((url, init) => {
    if (url === '/api/update/check') {
      return { current: '0.9.0', latest: '99.0.0', updateAvailable: true };
    }
    if (url === '/api/update' && init.method === 'POST') {
      return { status: 'updating' };
    }
    if (url === '/api/version') {
      return { name: 'harness-switch', version: '99.0.0' };
    }
    return {};
  });

  render(<UpdateButton />);
  fireEvent.click(await screen.findByRole('button', { name: '更新到 v99.0.0' }));
  expect(await screen.findByText('更新中…')).toBeInTheDocument();

  for (let i = 0; i < 80; i++) {
    if (reloaded) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  expect(reloaded).toBe(true);
});
