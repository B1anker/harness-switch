import { afterEach, expect, test } from '@rstest/core';
import { render, screen, waitFor } from '@testing-library/react';
import { DevModeBadge, VersionBadge } from '@/components/version-badge';

const realFetch = globalThis.fetch;
const realNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  globalThis.fetch = realFetch;
  process.env.NODE_ENV = realNodeEnv;
});

test('shows the server version from the api', async () => {
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({ name: 'harness-switch', version: '9.9.9' }),
  })) as unknown as typeof globalThis.fetch;

  render(<VersionBadge />);
  expect(await screen.findByText('v9.9.9')).toBeInTheDocument();
});

test('stays hidden when the version cannot be fetched', async () => {
  globalThis.fetch = (async () => ({
    ok: false,
    json: async () => ({ error: 'boom' }),
  })) as unknown as typeof globalThis.fetch;

  render(<VersionBadge />);
  await waitFor(() => expect(screen.queryByText(/^v/)).toBeNull());
});

test('marks a locally served bundle as dev mode', () => {
  process.env.NODE_ENV = 'development';

  render(<DevModeBadge />);

  const badge = screen.getByText('DEV');
  expect(badge).toHaveAttribute('data-slot', 'dev-mode-badge');
  expect(badge).toHaveAttribute('title', '本地开发模式：当前页面由本地 dev server 提供');
});

test('says nothing about dev mode in a production bundle', () => {
  process.env.NODE_ENV = 'production';

  render(<DevModeBadge />);

  expect(screen.queryByText('DEV')).toBeNull();
});
