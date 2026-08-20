import { afterEach, beforeEach, expect, test } from '@rstest/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UserSyncDialog } from '@/components/user-sync-dialog';
import { useAppStore } from '@/stores/app-store';

const realFetch = globalThis.fetch;

beforeEach(() => {
  useAppStore.setState({
    currentUser: 'owner',
    users: [
      { username: 'owner', uid: 1000, gid: 1000, homeDir: '/home/owner', current: true },
      { username: 'source', uid: 1001, gid: 1001, homeDir: '/home/source', current: false },
    ],
    loadHarnesses: async () => {},
    loadProviders: async () => {},
  });
});

afterEach(() => {
  globalThis.fetch = realFetch;
  useAppStore.setState({ currentUser: '', users: [] });
});

test('requires a final confirmation before migrating a source Codex login cache', async () => {
  const requests: Array<{ path: string; body: string }> = [];
  globalThis.fetch = (async (path: string, init: RequestInit = {}) => {
    requests.push({ path, body: String(init.body ?? '') });
    const body =
      path === '/api/users/sync/preview'
        ? {
            sourceUser: 'source',
            targetUser: 'owner',
            profileCount: 1,
            providerCount: 0,
            conflicts: [],
            codexLoginCache: { available: true, targetExists: true },
          }
        : {
            ok: true,
            sourceUser: 'source',
            targetUser: 'owner',
            imported: 1,
            overwritten: 0,
            skipped: 0,
            providersCopied: 0,
            codexLoginCacheMigrated: true,
            warnings: [],
          };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof globalThis.fetch;

  render(<UserSyncDialog open onOpenChange={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: '检查可同步内容' }));
  expect(await screen.findByText('迁移 Codex 官方登录缓存（auth.json）')).toBeInTheDocument();

  fireEvent.click(screen.getByLabelText(/迁移 Codex 官方登录缓存/));
  fireEvent.click(screen.getByRole('button', { name: '同步到 owner' }));
  expect(await screen.findByText('确认迁移 Codex 登录缓存？')).toBeInTheDocument();
  expect(requests.filter((request) => request.path === '/api/users/sync')).toHaveLength(0);

  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(requests.filter((request) => request.path === '/api/users/sync')).toHaveLength(0);

  fireEvent.click(screen.getByRole('button', { name: '同步到 owner' }));
  fireEvent.click(await screen.findByRole('button', { name: '迁移登录缓存并同步' }));
  await waitFor(() =>
    expect(requests.some((request) => request.path === '/api/users/sync')).toBe(true),
  );
  const syncRequest = requests.find((request) => request.path === '/api/users/sync');
  expect(JSON.parse(syncRequest?.body ?? '{}')).toEqual({
    sourceUser: 'source',
    conflictPolicy: 'skip',
    migrateCodexLoginCache: true,
  });
});
