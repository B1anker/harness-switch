import { expect, test } from '@rstest/core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DashboardPage } from '@/pages/dashboard-page';
import { useAppStore } from '@/stores/app-store';
import { harnessFixture, profileFixture } from './fixtures';

function setDashboardState() {
  const claudeProfile = profileFixture({ name: 'claude-main' });
  const codexProfile = profileFixture({
    harness: 'codex',
    name: 'codex-main',
    model: 'gpt-5.4',
  });
  useAppStore.setState({
    harnesses: [
      harnessFixture({
        active: { name: 'claude-main', baseUrl: claudeProfile.baseUrl, model: claudeProfile.model },
        profiles: [claudeProfile],
      }),
      harnessFixture({
        id: 'codex',
        label: 'Codex',
        active: { name: 'codex-main', baseUrl: codexProfile.baseUrl, model: codexProfile.model },
        profiles: [codexProfile],
      }),
    ],
    backups: [],
    currentUser: 'root',
    users: [
      { username: 'root', uid: 0, gid: 0, homeDir: '/root', current: true, manageable: true },
      {
        username: 'alice',
        uid: 1000,
        gid: 1000,
        homeDir: '/home/alice',
        current: false,
        manageable: true,
      },
    ],
    usersLoading: false,
    notice: null,
    providers: [],
    drift: [],
    doctor: [],
    doctorUpdatedAvailable: false,
    loadBackups: async () => {},
    loadProviders: async () => {},
    loadDrift: async () => {},
    loadDoctor: async () => {},
  });
}

test('switches the visible harness with the app tabs', () => {
  setDashboardState();

  render(<DashboardPage />);

  fireEvent.click(screen.getByRole('button', { name: '导入 / 导出' }));
  expect(screen.getByRole('heading', { name: '全局配置迁移' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));

  const claudeTab = screen.getByRole('tab', { name: /Claude Code/ });
  const codexTab = screen.getByRole('tab', { name: /Codex/ });
  expect(claudeTab).toHaveAttribute('aria-selected', 'true');
  expect(within(screen.getByRole('tabpanel')).getByText('claude-main')).toBeInTheDocument();

  fireEvent.click(codexTab);

  expect(codexTab).toHaveAttribute('aria-selected', 'true');
  expect(within(screen.getByRole('tabpanel')).getByText('codex-main')).toBeInTheDocument();
  expect(within(screen.getByRole('tabpanel')).queryByText('claude-main')).toBeNull();
});

test('the header opens the vault dialog', () => {
  setDashboardState();

  render(<DashboardPage />);

  fireEvent.click(screen.getByRole('button', { name: '凭据库' }));
  expect(screen.getByRole('heading', { name: '凭据库' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));

  const userMenuButton = screen.getByRole('button', { name: '当前本地用户' });
  expect(userMenuButton).toHaveTextContent('root');
  fireEvent.click(userMenuButton);
  expect(screen.getByRole('menuitemradio', { name: 'alice' })).toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: '退出' })).toBeInTheDocument();
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '同步用户配置' }));
  expect(screen.getByRole('heading', { name: '从其他用户同步' })).toBeInTheDocument();
  expect(screen.getByText(/复制到 root/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
});

test('an unmanageable user cannot be selected and says why', () => {
  setDashboardState();
  let selected = '';
  useAppStore.setState({
    users: [
      { username: 'root', uid: 0, gid: 0, homeDir: '/root', current: true, manageable: true },
      {
        username: 'alice',
        uid: 1000,
        gid: 1000,
        homeDir: '/home/alice',
        current: false,
        manageable: false,
        blockCode: 'user.block.homeUnsearchable',
        blockParams: { username: 'alice', home: '/home/alice' },
        blockReason: 'server prose',
      },
    ],
    switchUser: async (username: string) => {
      selected = username;
    },
  });

  render(<DashboardPage />);
  fireEvent.click(screen.getByRole('button', { name: '当前本地用户' }));

  const entry = screen.getByRole('menuitemradio', { name: /alice/ });
  expect(entry).toBeDisabled();
  // Short and path-free so the narrow menu cannot wrap; the full server prose with the
  // directory stays available as the tooltip.
  expect(entry).toHaveTextContent('没有权限访问');
  expect(entry.textContent ?? '').not.toContain('/home/alice');
  expect(entry).toHaveAttribute('title', 'server prose');
  // A row that cannot be picked must not light up under the cursor.
  expect(entry.className).not.toContain('hover:bg-accent');
  expect(entry.className).toContain('cursor-default');

  fireEvent.click(entry);
  expect(selected).toBe('');
});

test('a selectable user keeps a pointer and hover state', () => {
  setDashboardState();

  render(<DashboardPage />);
  fireEvent.click(screen.getByRole('button', { name: '当前本地用户' }));

  const entry = screen.getByRole('menuitemradio', { name: 'alice' });
  expect((entry as HTMLButtonElement).disabled).toBe(false);
  expect(entry.className).toContain('cursor-pointer');
  expect(entry.className).toContain('hover:bg-accent');
  // The current user is not a target, so it gets neither.
  const current = screen.getByRole('menuitemradio', { name: 'root' });
  expect(current).toBeDisabled();
  expect(current.className).not.toContain('hover:bg-accent');
});

test('a user whose block code this build does not know falls back to server prose', () => {
  setDashboardState();
  useAppStore.setState({
    users: [
      { username: 'root', uid: 0, gid: 0, homeDir: '/root', current: true, manageable: true },
      {
        username: 'alice',
        uid: 1000,
        gid: 1000,
        homeDir: '/home/alice',
        current: false,
        manageable: false,
        blockCode: 'user.block.inventedLater',
        blockReason: '来自服务端的原因',
      },
    ],
  });

  render(<DashboardPage />);
  fireEvent.click(screen.getByRole('button', { name: '当前本地用户' }));

  const entry = screen.getByRole('menuitemradio', { name: /alice/ });
  expect(entry).toBeDisabled();
  expect(entry).toHaveTextContent('来自服务端的原因');
});

test('the right column shows the doctor and operations cards for the selected harness', () => {
  setDashboardState();

  render(<DashboardPage />);

  expect(screen.getByText('诊断')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '查看差异' })).toBeNull();
  expect(screen.getByText('操作记录')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: '查看详情' })).toHaveLength(2);
});
