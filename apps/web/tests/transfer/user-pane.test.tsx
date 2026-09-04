import { beforeEach, expect, test } from '@rstest/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UserPane } from '@/components/transfer/user-pane';
import { useAppStore } from '@/stores/app-store';
import { recordRequests, setStoreState, status, stubFetch } from '../support';

beforeEach(() => {
  setStoreState({
    currentUser: 'owner',
    users: [
      {
        username: 'owner',
        uid: 1000,
        gid: 1000,
        homeDir: '/home/owner',
        current: true,
        manageable: true,
      },
      {
        username: 'source',
        uid: 1001,
        gid: 1001,
        homeDir: '/home/source',
        current: false,
        manageable: true,
      },
    ],
    loadHarnesses: async () => {},
    loadProviders: async () => {},
  });
});

test('requires a final confirmation before migrating a source Codex login cache', async () => {
  const { handler, requests } = recordRequests((url) =>
    url === '/api/users/sync/preview'
      ? {
          sourceUser: 'source',
          targetUser: 'owner',
          profileCount: 1,
          providerCount: 0,
          conflicts: [],
          codexLoginCache: { available: true, targetExists: true, migrationNeeded: true },
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
        },
  );
  stubFetch(handler);

  render(<UserPane onDone={() => {}} />);
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
    overwriteHarnesses: [],
    migrateCodexLoginCache: true,
  });
});

test('does not offer migration when the Codex login caches already match', async () => {
  stubFetch((url) =>
    url === '/api/users/sync/preview'
      ? {
          sourceUser: 'source',
          targetUser: 'owner',
          profileCount: 0,
          providerCount: 0,
          conflicts: [],
          codexLoginCache: { available: true, targetExists: true, migrationNeeded: false },
        }
      : {
          ok: true,
          sourceUser: 'source',
          targetUser: 'owner',
          imported: 0,
          overwritten: 0,
          skipped: 0,
          providersCopied: 0,
          codexLoginCacheMigrated: false,
          warnings: [],
        },
  );

  render(<UserPane onDone={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: '检查可同步内容' }));
  await screen.findByText('配置 0');
  expect(screen.queryByText('迁移 Codex 官方登录缓存（auth.json）')).toBeNull();
});

test('lets the user overwrite conflicts for selected harnesses only', async () => {
  const { handler, requests } = recordRequests((url) =>
    url === '/api/users/sync/preview'
      ? {
          sourceUser: 'source',
          targetUser: 'owner',
          profileCount: 4,
          providerCount: 1,
          conflicts: [
            { harness: 'claude', name: 'main' },
            { harness: 'claude', name: 'backup' },
            { harness: 'kimi', name: 'main' },
          ],
          codexLoginCache: { available: false, targetExists: false, migrationNeeded: false },
        }
      : {
          ok: true,
          sourceUser: 'source',
          targetUser: 'owner',
          imported: 1,
          overwritten: 2,
          skipped: 1,
          providersCopied: 1,
          codexLoginCacheMigrated: false,
          warnings: [],
        },
  );
  stubFetch(handler);

  render(<UserPane onDone={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: '检查可同步内容' }));

  expect(await screen.findByLabelText(/覆盖 Claude Code/)).toBeInTheDocument();
  expect(screen.getByLabelText(/覆盖 Kimi Code/)).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText(/覆盖 Claude Code/));
  fireEvent.click(screen.getByRole('button', { name: '同步到 owner' }));

  await waitFor(() =>
    expect(requests.some((request) => request.path === '/api/users/sync')).toBe(true),
  );
  const syncRequest = requests.find((request) => request.path === '/api/users/sync');
  expect(JSON.parse(syncRequest?.body ?? '{}')).toEqual({
    sourceUser: 'source',
    conflictPolicy: 'skip',
    overwriteHarnesses: ['claude'],
    migrateCodexLoginCache: false,
  });
});

test('finishes on a successful sync and reports the result in the toast', async () => {
  stubFetch((url) =>
    url === '/api/users/sync/preview'
      ? {
          sourceUser: 'source',
          targetUser: 'owner',
          profileCount: 3,
          providerCount: 2,
          conflicts: [],
          codexLoginCache: { available: false, targetExists: false, migrationNeeded: false },
        }
      : {
          ok: true,
          sourceUser: 'source',
          targetUser: 'owner',
          imported: 3,
          overwritten: 0,
          skipped: 1,
          providersCopied: 2,
          codexLoginCacheMigrated: false,
          warnings: [{ code: 'warning.transfer.credentialMissing' }],
        },
  );

  let done = 0;
  render(<UserPane onDone={() => (done += 1)} />);
  fireEvent.click(screen.getByRole('button', { name: '检查可同步内容' }));
  fireEvent.click(await screen.findByRole('button', { name: '同步到 owner' }));

  // Leaving the dialog open made users think the sync had not finished, so they ran it twice.
  await waitFor(() => expect(done).toBe(1));
  const notice = useAppStore.getState().notice ?? [];
  expect(notice[0]).toMatchObject({
    key: 'sync.done',
    params: { imported: 3, overwritten: 0, skipped: 1, providersCopied: 2 },
  });
  expect(notice[1]?.key).toBe('sync.cacheNotMigrated');
  expect(notice[2]?.key).toBe('warning.transfer.credentialMissing');
  // The result now lives in the toast, so the pane no longer repeats it inline.
  expect(screen.queryByText(/同步完成：/)).toBeNull();
});

test('keeps a failed sync on screen with its reason instead of finishing', async () => {
  stubFetch((url) =>
    url === '/api/users/sync/preview'
      ? {
          sourceUser: 'source',
          targetUser: 'owner',
          profileCount: 1,
          providerCount: 0,
          conflicts: [],
          codexLoginCache: { available: false, targetExists: false, migrationNeeded: false },
        }
      : status(500, { msg: '来源用户目录不可读' }),
  );

  let done = 0;
  render(<UserPane onDone={() => (done += 1)} />);
  fireEvent.click(screen.getByRole('button', { name: '检查可同步内容' }));
  fireEvent.click(await screen.findByRole('button', { name: '同步到 owner' }));

  expect(await screen.findByText('来源用户目录不可读')).toBeInTheDocument();
  expect(done).toBe(0);
  expect(useAppStore.getState().notice).toBeNull();
});

test('says so when there is no other manageable account to copy from', () => {
  setStoreState({
    currentUser: 'owner',
    users: [
      {
        username: 'owner',
        uid: 1000,
        gid: 1000,
        homeDir: '/home/owner',
        current: true,
        manageable: true,
      },
      {
        username: 'locked',
        uid: 1002,
        gid: 1002,
        homeDir: '/home/locked',
        current: false,
        manageable: false,
      },
    ],
  });

  render(<UserPane onDone={() => {}} />);

  // Reading a source needs the same access as managing it, so an unmanageable account is
  // not a candidate either.
  expect(screen.getByText('没有其他可管理的本地登录用户。')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '检查可同步内容' })).toBeNull();
});
