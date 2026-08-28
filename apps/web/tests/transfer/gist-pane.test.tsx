import { afterEach, beforeEach, expect, test } from '@rstest/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GistPane } from '@/components/transfer/gist-pane';
import { useAppStore } from '@/stores/app-store';

const realFetch = globalThis.fetch;

beforeEach(() => {
  useAppStore.setState({ loadHarnesses: async () => {} });
});

afterEach(() => {
  globalThis.fetch = realFetch;
  useAppStore.setState({ notice: null });
});

test('shows device code tab and token login tab when disconnected', async () => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url === '/api/github/status') {
      return new Response(JSON.stringify({ connected: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Not found', { status: 404 });
  }) as typeof globalThis.fetch;

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
  const requests: Array<{ url: string; body: string }> = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, body: String(init?.body ?? '') });

    if (url === '/api/github/status') {
      return new Response(
        JSON.stringify({
          connected: true,
          username: 'octocat',
          avatarUrl: 'https://github.com/images/octocat.png',
          lastSyncedAt: '2026-08-28T10:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (url === '/api/github/push') {
      return new Response(
        JSON.stringify({
          ok: true,
          gistId: 'gist_123',
          gistUpdatedAt: '2026-08-28T12:00:00Z',
          lastSyncedAt: '2026-08-28T12:00:00Z',
          exportedProfilesCount: 5,
          exportedVaultCount: 2,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    return new Response('Not found', { status: 404 });
  }) as typeof globalThis.fetch;

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
    expect(requests.some((r) => r.url === '/api/github/push')).toBe(true);
  });

  const pushReq = requests.find((r) => r.url === '/api/github/push');
  expect(JSON.parse(pushReq?.body ?? '{}')).toEqual({
    passphrase: 'my-sync-secret',
    includeCodexLoginCache: true,
  });
});

test('handles manual check device code flow', async () => {
  const requests: Array<{ url: string; body: string }> = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, body: String(init?.body ?? '') });

    if (url === '/api/github/status') {
      return new Response(JSON.stringify({ connected: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url === '/api/github/device/code') {
      return new Response(
        JSON.stringify({
          deviceCode: 'mock-device-code',
          userCode: '1234-ABCD',
          verificationUri: 'https://github.com/login/device',
          expiresIn: 900,
          interval: 5,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (url === '/api/github/device/poll') {
      return new Response(
        JSON.stringify({
          status: 'authorized',
          username: 'octocat',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    return new Response('Not found', { status: 404 });
  }) as typeof globalThis.fetch;

  render(<GistPane onDone={() => {}} />);

  const getCodeBtn = await screen.findByText('获取设备授权码');
  fireEvent.click(getCodeBtn);

  const checkBtn = await screen.findByText('立即检查');
  fireEvent.click(checkBtn);

  await waitFor(() => {
    expect(requests.some((r) => r.url === '/api/github/device/poll')).toBe(true);
  });
  expect(await screen.findByText(/GitHub 授权成功，欢迎 octocat/)).toBeInTheDocument();
});

test('pulling reviews the cloud backup with the shared import step', async () => {
  const requests: Array<{ url: string; body: string }> = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, body: String(init?.body ?? '') });

    if (url === '/api/github/status') {
      return new Response(
        JSON.stringify({ connected: true, username: 'octocat', gistId: 'gist_1234567890' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (url === '/api/github/pull/preview') {
      const request = JSON.parse(String(init?.body ?? '{}')) as {
        conflictPolicy?: 'skip' | 'overwrite';
        restoreActive?: boolean;
      };
      return new Response(
        JSON.stringify({
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
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (url === '/api/github/pull') {
      return new Response(
        JSON.stringify({
          ok: true,
          imported: 3,
          overwritten: 1,
          skipped: 0,
          providersCopied: 1,
          activeRestored: 0,
          codexLoginCacheMigrated: false,
          warnings: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    return new Response('Not found', { status: 404 });
  }) as typeof globalThis.fetch;

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

  await waitFor(() => expect(requests.some((r) => r.url === '/api/github/pull')).toBe(true));
  const pullReq = requests.find((r) => r.url === '/api/github/pull');
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
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/github/status') {
      return new Response(JSON.stringify({ connected: true, username: 'octocat' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url === '/api/github/pull/preview') {
      const request = JSON.parse(String(init?.body ?? '{}')) as {
        conflictPolicy?: 'skip' | 'overwrite';
        restoreActive?: boolean;
      };
      return new Response(
        JSON.stringify({
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
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response('Not found', { status: 404 });
  }) as typeof globalThis.fetch;

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
