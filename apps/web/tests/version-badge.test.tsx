import { afterEach, expect, test } from '@rstest/core';
import { render, screen, waitFor } from '@testing-library/react';
import { VersionBadge } from '@/components/version-badge';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
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
