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
  useAppStore.setState({ currentUser: '', users: [], notice: null });
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
    overwriteHarnesses: [],
    migrateCodexLoginCache: true,
  });
});

test('lets the user overwrite conflicts for selected harnesses only', async () => {
  const requests: Array<{ path: string; body: string }> = [];
  globalThis.fetch = (async (path: string, init: RequestInit = {}) => {
    requests.push({ path, body: String(init.body ?? '') });
    const body =
      path === '/api/users/sync/preview'
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
            codexLoginCache: { available: false, targetExists: false },
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
          };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof globalThis.fetch;

  render(<UserSyncDialog open onOpenChange={() => {}} />);
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

test('closes on a successful sync and reports the result in the toast', async () => {
  globalThis.fetch = (async (path: string) => {
    const body =
      path === '/api/users/sync/preview'
        ? {
            sourceUser: 'source',
            targetUser: 'owner',
            profileCount: 3,
            providerCount: 2,
            conflicts: [],
            codexLoginCache: { available: false, targetExists: false },
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
            warnings: ['kimi 的凭据缺少密钥'],
          };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof globalThis.fetch;

  const closes: boolean[] = [];
  render(<UserSyncDialog open onOpenChange={(open) => closes.push(open)} />);
  fireEvent.click(screen.getByRole('button', { name: '检查可同步内容' }));
  fireEvent.click(await screen.findByRole('button', { name: '同步到 owner' }));

  // Leaving the dialog open made users think the sync had not finished, so they ran it twice.
  await waitFor(() => expect(closes).toEqual([false]));
  const notice = useAppStore.getState().notice;
  expect(notice).toContain('同步完成：新增 3，覆盖 0，跳过 1，复制凭据 2');
  expect(notice).toContain('Codex 登录缓存未迁移');
  expect(notice).toContain('kimi 的凭据缺少密钥');
  // The result now lives in the toast, so the dialog no longer repeats it inline.
  expect(screen.queryByText(/同步完成：/)).toBeNull();
});

test('keeps a failed sync on screen with its reason instead of closing', async () => {
  globalThis.fetch = (async (path: string) =>
    path === '/api/users/sync/preview'
      ? new Response(
          JSON.stringify({
            sourceUser: 'source',
            targetUser: 'owner',
            profileCount: 1,
            providerCount: 0,
            conflicts: [],
            codexLoginCache: { available: false, targetExists: false },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      : new Response(JSON.stringify({ error: '来源用户目录不可读' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })) as typeof globalThis.fetch;

  const closes: boolean[] = [];
  render(<UserSyncDialog open onOpenChange={(open) => closes.push(open)} />);
  fireEvent.click(screen.getByRole('button', { name: '检查可同步内容' }));
  fireEvent.click(await screen.findByRole('button', { name: '同步到 owner' }));

  expect(await screen.findByText('来源用户目录不可读')).toBeInTheDocument();
  expect(closes).toEqual([]);
  expect(useAppStore.getState().notice).toBeNull();
});
