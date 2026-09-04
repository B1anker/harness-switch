import { beforeEach, expect, test } from '@rstest/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GistPane } from '@/components/transfer/gist-pane';
import { useAppStore } from '@/stores/app-store';
import { recordRequests, routes, setStoreState, stubFetch } from '../support';

beforeEach(() => {
  setStoreState({ loadHarnesses: async () => {} });
});

test('shows device code tab and token login tab when disconnected', async () => {
  stubFetch(routes({ '/api/github/status': { connected: false } }));

  render(<GistPane onDone={() => {}} />);

  await waitFor(() => {
    expect(screen.getByText(/获取设备授权码/)).toBeInTheDocument();
  });

  // Switch to Token tab
  fireEvent.click(screen.getByText('Token 登录'));
  expect(screen.getByPlaceholderText(/输入具有 gist 权限的 GitHub Token/)).toBeInTheDocument();
  // The label used to be hardcoded Chinese; it is a catalog key now.
  expect(screen.getByLabelText('Personal Access Token')).toBeInTheDocument();
});

test('shows connected account and pushes config to cloud', async () => {
  const { handler, requests } = recordRequests(
    routes({
      '/api/github/status': {
        connected: true,
        username: 'octocat',
        avatarUrl: 'https://github.com/images/octocat.png',
        lastSyncedAt: '2026-08-28T10:00:00Z',
      },
      '/api/github/push': {
        ok: true,
        gistId: 'gist_123',
        gistUpdatedAt: '2026-08-28T12:00:00Z',
        lastSyncedAt: '2026-08-28T12:00:00Z',
        exportedProfilesCount: 5,
        exportedVaultCount: 2,
      },
    }),
  );
  stubFetch(handler);

  render(<GistPane onDone={() => {}} />);

  await waitFor(() => {
    expect(screen.getByText('octocat')).toBeInTheDocument();
  });

  // Enter push passphrase
  const passphraseInput = screen.getByPlaceholderText('用于端到端加密与解密的密码');
  fireEvent.change(passphraseInput, { target: { value: 'my-sync-secret' } });

  const pushButtons = screen.getAllByRole('button', { name: '上传到云端' });
  const pushSubmitBtn = pushButtons[pushButtons.length - 1]!;
  fireEvent.click(pushSubmitBtn);

  await waitFor(() => {
    expect(requests.some((r) => r.path === '/api/github/push')).toBe(true);
  });

  const pushReq = requests.find((r) => r.path === '/api/github/push');
  expect(JSON.parse(pushReq?.body ?? '{}')).toEqual({
    passphrase: 'my-sync-secret',
    includeCodexLoginCache: true,
  });
});

test('handles manual check device code flow', async () => {
  const { handler, requests } = recordRequests(
    routes({
      '/api/github/status': { connected: false },
      '/api/github/device/code': {
        deviceCode: 'mock-device-code',
        userCode: '1234-ABCD',
        verificationUri: 'https://github.com/login/device',
        expiresIn: 900,
        interval: 5,
      },
      '/api/github/device/poll': { status: 'authorized', username: 'octocat' },
    }),
  );
  stubFetch(handler);

  render(<GistPane onDone={() => {}} />);

  const getCodeBtn = await screen.findByText('获取设备授权码');
  fireEvent.click(getCodeBtn);

  const checkBtn = await screen.findByText('立即检查');
  fireEvent.click(checkBtn);

  await waitFor(() => {
    expect(requests.some((r) => r.path === '/api/github/device/poll')).toBe(true);
  });
  expect(await screen.findByText(/GitHub 授权成功，欢迎 octocat/)).toBeInTheDocument();
});

test('pulling reviews the cloud backup with the shared import step', async () => {
  const { handler, requests } = recordRequests(
    routes({
      '/api/github/status': { connected: true, username: 'octocat', gistId: 'gist_1234567890' },
      '/api/github/pull/preview': (_url: string, init: RequestInit) => {
        const request = JSON.parse(String(init.body ?? '{}')) as {
          conflictPolicy?: 'skip' | 'overwrite';
          restoreActive?: boolean;
        };
        return {
          gistUpdatedAt: '2026-08-28T12:00:00Z',
          preview: {
            exportedAt: '2026-08-28T11:59:00Z',
            profileCount: 3,
            providerCount: 1,
            harnesses: [{ harness: 'claude', profiles: 3 }],
            conflicts: [{ harness: 'claude', name: 'main' }],
            activeCount: 0,
            conflictPolicy: request.conflictPolicy ?? 'skip',
            restoreActive: request.restoreActive === true,
            codexActivationAuthEffect: 'none',
            codexLoginCache: { available: false, targetExists: false, migrationNeeded: false },
          },
        };
      },
      '/api/github/pull': {
        ok: true,
        imported: 3,
        overwritten: 1,
        skipped: 0,
        providersCopied: 1,
        activeRestored: 0,
        codexLoginCacheMigrated: false,
        warnings: [],
      },
    }),
  );
  stubFetch(handler);

  let done = 0;
  render(<GistPane onDone={() => (done += 1)} />);
  fireEvent.click(await screen.findByText('从云端拉取'));

  fireEvent.change(screen.getByPlaceholderText('上传时设置的同步主密码'), {
    target: { value: 'my-sync-secret' },
  });
  fireEvent.click(screen.getByRole('button', { name: /检查云端备份/ }));

  expect(await screen.findByText('云端备份检查结果')).toBeInTheDocument();
  expect(screen.getByText('3 个配置')).toBeInTheDocument();
  expect(screen.getByText(/同名项：Claude Code \/ main/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '确认导入' }));
  fireEvent.click(await screen.findByRole('button', { name: '安全导入' }));

  await waitFor(() => expect(requests.some((r) => r.path === '/api/github/pull')).toBe(true));
  const pullReq = requests.find((r) => r.path === '/api/github/pull');
  expect(JSON.parse(pullReq?.body ?? '{}')).toEqual({
    passphrase: 'my-sync-secret',
    conflictPolicy: 'skip',
    restoreActive: true,
    migrateCodexLoginCache: true,
  });
  await waitFor(() => expect(done).toBe(1));
  // Both sources report through the same builder, so the counts read the same way.
  const notice = useAppStore.getState().notice ?? [];
  expect(notice[0]?.key).toBe('transfer.importedSummary');
  expect(String(notice[0]?.params?.parts)).toContain('新增 3 项');
  expect(String(notice[0]?.params?.parts)).toContain('覆盖 1 项');
});

test('changing the conflict policy keeps the preview and asks for a re-check', async () => {
  stubFetch(
    routes({
      '/api/github/status': { connected: true, username: 'octocat' },
      '/api/github/pull/preview': (_url: string, init: RequestInit) => {
        const request = JSON.parse(String(init.body ?? '{}')) as {
          conflictPolicy?: 'skip' | 'overwrite';
          restoreActive?: boolean;
        };
        return {
          gistUpdatedAt: '2026-08-28T12:00:00Z',
          preview: {
            exportedAt: '2026-08-28T11:59:00Z',
            profileCount: 1,
            providerCount: 0,
            harnesses: [],
            conflicts: [{ harness: 'claude', name: 'main' }],
            activeCount: 0,
            conflictPolicy: request.conflictPolicy ?? 'skip',
            restoreActive: request.restoreActive === true,
            codexActivationAuthEffect: 'none',
            codexLoginCache: { available: false, targetExists: false, migrationNeeded: false },
          },
        };
      },
    }),
  );

  render(<GistPane onDone={() => {}} />);
  fireEvent.click(await screen.findByText('从云端拉取'));
  fireEvent.change(screen.getByPlaceholderText('上传时设置的同步主密码'), {
    target: { value: 'my-sync-secret' },
  });
  fireEvent.click(screen.getByRole('button', { name: /检查云端备份/ }));
  await screen.findByText('云端备份检查结果');

  // This used to drop the preview entirely, sending the user back to the passphrase field.
  fireEvent.click(screen.getByLabelText('恢复导出时的激活状态'));
  expect(screen.getByText('已修改导入选项，请重新检查内容后再确认导入。')).toBeInTheDocument();
  expect(screen.getByText('云端备份检查结果')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '请重新检查导入内容' })).toBeDisabled();
});
