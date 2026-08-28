import { afterEach, beforeEach, expect, test } from '@rstest/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GitHubSyncDialog } from '@/components/github-sync-dialog';
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

  render(<GitHubSyncDialog open onOpenChange={() => {}} />);

  await waitFor(() => {
    expect(screen.getByText(/获取设备授权码/)).toBeInTheDocument();
  });

  // Switch to Token tab
  fireEvent.click(screen.getByText('Token 登录'));
  expect(screen.getByPlaceholderText(/输入具有 gist 权限的 GitHub Token/)).toBeInTheDocument();
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

  render(<GitHubSyncDialog open onOpenChange={() => {}} />);

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

  render(<GitHubSyncDialog open onOpenChange={() => {}} />);

  const getCodeBtn = await screen.findByText('获取设备授权码');
  fireEvent.click(getCodeBtn);

  const checkBtn = await screen.findByText('立即检查');
  fireEvent.click(checkBtn);

  await waitFor(() => {
    expect(requests.some((r) => r.url === '/api/github/device/poll')).toBe(true);
  });
});
