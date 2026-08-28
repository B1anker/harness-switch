import { afterEach, beforeEach, expect, test } from '@rstest/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfigTransferDialog } from '@/components/config-transfer-dialog';
import { useAppStore } from '@/stores/app-store';

const realFetch = globalThis.fetch;

beforeEach(() => {
  useAppStore.setState({
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
    scan: [],
    scanLoading: false,
    scanError: null,
    providers: [],
    loadScan: async () => {},
    loadProviders: async () => {},
    loadHarnesses: async () => {},
  });
  globalThis.fetch = (async (_input: string | URL | Request) =>
    new Response(JSON.stringify({ connected: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  useAppStore.setState({ currentUser: '', users: [], scan: null, notice: null });
});

const SOURCE_NAMES = ['本机现有配置', '其他本地用户', '加密文件', 'GitHub Gist'];

/** The rail item the panel is currently showing. */
function selectedTab() {
  return screen.getAllByRole('tab').find((tab) => tab.getAttribute('aria-selected') === 'true');
}

test('the rail names every source and starts on the local scan', () => {
  render(<ConfigTransferDialog open onOpenChange={() => {}} />);

  expect(screen.getByRole('heading', { name: '配置迁移' })).toBeInTheDocument();
  const tabs = screen.getAllByRole('tab');
  expect(tabs.map((tab) => tab.textContent)).toEqual(SOURCE_NAMES);
  expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('button', { name: '重新扫描' })).toBeInTheDocument();
});

test('each rail item opens its own pane', async () => {
  render(<ConfigTransferDialog open onOpenChange={() => {}} />);

  fireEvent.click(screen.getByRole('tab', { name: '其他本地用户' }));
  expect(screen.getByRole('button', { name: '检查可同步内容' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('tab', { name: '加密文件' }));
  expect(screen.getByRole('button', { name: /选择 .hsw-backup/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '检查导入内容' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('tab', { name: 'GitHub Gist' }));
  await waitFor(() => expect(screen.getByText(/获取设备授权码/)).toBeInTheDocument());

  fireEvent.click(screen.getByRole('tab', { name: '本机现有配置' }));
  expect(screen.getByRole('button', { name: '重新扫描' })).toBeInTheDocument();
});

test('the rail is a vertical tablist that arrow keys, Home and End move through', () => {
  render(<ConfigTransferDialog open onOpenChange={() => {}} />);

  const rail = screen.getByRole('tablist', { name: '选择来源' });
  expect(rail).toHaveAttribute('aria-orientation', 'vertical');

  fireEvent.keyDown(selectedTab()!, { key: 'ArrowDown' });
  expect(selectedTab()).toHaveAccessibleName('其他本地用户');

  fireEvent.keyDown(selectedTab()!, { key: 'End' });
  expect(selectedTab()).toHaveAccessibleName('GitHub Gist');

  // Wraps, rather than stopping at the end where the panel would stay put.
  fireEvent.keyDown(selectedTab()!, { key: 'ArrowDown' });
  expect(selectedTab()).toHaveAccessibleName('本机现有配置');

  fireEvent.keyDown(selectedTab()!, { key: 'ArrowUp' });
  expect(selectedTab()).toHaveAccessibleName('GitHub Gist');

  fireEvent.keyDown(selectedTab()!, { key: 'Home' });
  expect(selectedTab()).toHaveAccessibleName('本机现有配置');
});

test('only the selected tab is in the tab order', () => {
  render(<ConfigTransferDialog open onOpenChange={() => {}} />);

  fireEvent.click(screen.getByRole('tab', { name: '加密文件' }));
  const tabs = screen.getAllByRole('tab');
  expect(tabs.map((tab) => tab.getAttribute('tabindex'))).toEqual(['-1', '-1', '0', '-1']);
});
