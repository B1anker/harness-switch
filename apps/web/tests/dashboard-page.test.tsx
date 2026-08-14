import { expect, test } from '@rstest/core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DashboardPage } from '@/pages/dashboard-page';
import { useAppStore } from '@/stores/app-store';
import { harnessFixture, profileFixture } from './fixtures';

test('switches the visible harness with the app tabs', () => {
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
    loadBackups: async () => {},
  });

  render(<DashboardPage />);

  const claudeTab = screen.getByRole('tab', { name: /Claude Code/ });
  const codexTab = screen.getByRole('tab', { name: /Codex/ });
  expect(claudeTab).toHaveAttribute('aria-selected', 'true');
  expect(within(screen.getByRole('tabpanel')).getByText('claude-main')).toBeInTheDocument();

  fireEvent.click(codexTab);

  expect(codexTab).toHaveAttribute('aria-selected', 'true');
  expect(within(screen.getByRole('tabpanel')).getByText('codex-main')).toBeInTheDocument();
  expect(within(screen.getByRole('tabpanel')).queryByText('claude-main')).toBeNull();
});
