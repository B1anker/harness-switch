import { expect, test } from '@rstest/core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DashboardPage } from '@/pages/dashboard-page';
import { harnessFixture, profileFixture, setStoreState, stubStoreActions } from './support';

test('global backups are available from the main tool view', () => {
  setDashboardState();
  const actions = stubStoreActions(['loadFavoriteBackups']);
  render(<DashboardPage />);
  fireEvent.click(screen.getByRole('button', { name: '备份与恢复' }));
  expect(screen.getByRole('heading', { name: '备份与恢复' })).toBeInTheDocument();
  expect(actions.loadFavoriteBackups).toHaveLength(1);
});

function setDashboardState() {
  const claudeProfile = profileFixture({ name: 'claude-main' });
  const codexProfile = profileFixture({
    harness: 'codex',
    name: 'codex-main',
    model: 'gpt-5.4',
  });
  setStoreState({
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
    scan: [],
    scanLoading: false,
    scanError: null,
    loadBackups: async () => {},
    loadProviders: async () => {},
    loadDrift: async () => {},
    loadDoctor: async () => {},
    loadScan: async () => {},
  });
}

test('switches the visible harness with the app tabs', () => {
  setDashboardState();

  render(<DashboardPage />);

  fireEvent.click(screen.getByRole('button', { name: '配置迁移' }));
  expect(screen.getByRole('heading', { name: '配置迁移' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '关闭对话框' }));

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
  fireEvent.click(screen.getByRole('button', { name: '关闭对话框' }));

  const userMenuButton = screen.getByRole('button', { name: '当前本地用户' });
  expect(userMenuButton).toHaveTextContent('root');
  fireEvent.click(userMenuButton);
  expect(screen.getByRole('menuitemradio', { name: 'alice' })).toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: '退出' })).toBeInTheDocument();
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('menu')).toBeNull();

  // Syncing from another local user is no longer its own header button — it is one source
  // inside the transfer dialog.
  fireEvent.click(screen.getByRole('button', { name: '配置迁移' }));
  fireEvent.click(screen.getByRole('tab', { name: '其他本地用户' }));
  expect(screen.getByText(/复制到 root/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '关闭对话框' }));
});

test('an unmanageable user cannot be selected and says why', () => {
  setDashboardState();
  let selected = '';
  setStoreState({
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
        blockData: { username: 'alice', home: '/home/alice' },
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
  // Short and path-free so the narrow menu cannot wrap; the directory arrives as data
  // and is appended in the tooltip.
  expect(entry).toHaveTextContent('没有权限访问');
  expect(entry.textContent ?? '').not.toContain('/home/alice');
  expect(entry).toHaveAttribute('title', '没有权限访问 — /home/alice');
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

test('a user whose block code this build does not know still reads as a sentence', () => {
  setDashboardState();
  setStoreState({
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
      },
    ],
  });

  render(<DashboardPage />);
  fireEvent.click(screen.getByRole('button', { name: '当前本地用户' }));

  const entry = screen.getByRole('menuitemradio', { name: /alice/ });
  expect(entry).toBeDisabled();
  expect(entry).toHaveTextContent('未知错误');
});

test('the right column shows the doctor and operations cards for the selected harness', () => {
  setDashboardState();

  render(<DashboardPage />);

  expect(screen.getByText('诊断')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '查看差异' })).toBeNull();
  expect(screen.getByText('操作记录')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: '查看详情' })).toHaveLength(2);
});
