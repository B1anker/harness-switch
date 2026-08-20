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

test('the header opens the vault and the doctor dialogs', () => {
  setDashboardState();

  render(<DashboardPage />);

  fireEvent.click(screen.getByRole('button', { name: '凭据库' }));
  expect(screen.getByRole('heading', { name: '凭据库' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));

  fireEvent.click(screen.getByRole('button', { name: '诊断' }));
  expect(screen.getByRole('heading', { name: '诊断' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
});

test('the right column shows the drift card for the selected harness', () => {
  setDashboardState();

  render(<DashboardPage />);

  expect(screen.getByText('配置漂移')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '查看差异' })).toBeDisabled();
});
