import { expect, test } from '@rstest/core';
import type { BackupDetail, BackupEntry } from '@seaveyon/harness-switch-shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BackupPanel } from '@/components/backup-panel';
import { useAppStore } from '@/stores/app-store';

function setup(backups: BackupEntry[]) {
  const restored: string[] = [];
  const loads: number[] = [];
  const details: string[] = [];
  const detail: BackupDetail = {
    id: codexEntry.id,
    createdAt: codexEntry.createdAt,
    harness: 'codex',
    profile: 'openrouter',
    files: [
      {
        path: '/home/tester/.codex/config.toml',
        existed: true,
        content: 'model = "old"\n',
        currentContent: 'model = "live"\n',
      },
      {
        path: '/home/tester/.codex/auth.json',
        existed: false,
        content: null,
        currentContent: '{"OPENAI_API_KEY":"sk-live"}',
      },
    ],
  };
  useAppStore.setState({
    backups,
    loadBackups: async () => {
      loads.push(1);
    },
    loadBackupDetail: async (id: string) => {
      details.push(id);
      return detail;
    },
    restoreBackup: async (id: string) => {
      restored.push(id);
    },
  } as Partial<ReturnType<typeof useAppStore.getState>> as never);
  return { restored, loads, details };
}

const codexEntry: BackupEntry = {
  id: '2026-08-13T09-30-00-000Z-codex-openrouter',
  createdAt: '2026-08-13T09:30:00.000Z',
  harness: 'codex',
  profile: 'openrouter',
  files: [
    { path: '/home/tester/.codex/config.toml', existed: true },
    { path: '/home/tester/.codex/auth.json', existed: false },
  ],
  current: false,
};

const currentEntry: BackupEntry = {
  id: '2026-08-13T08-00-00-000Z-codex-previous',
  createdAt: '2026-08-13T08:00:00.000Z',
  harness: 'codex',
  profile: 'previous',
  files: [{ path: '/home/tester/.codex/config.toml', existed: true }],
  current: true,
};

const claudeEntry: BackupEntry = {
  id: '2026-08-13T09-40-00-000Z-claude-relay',
  createdAt: '2026-08-13T09:40:00.000Z',
  harness: 'claude',
  profile: 'relay',
  files: [{ path: '/home/tester/.claude/settings.json', existed: true }],
  current: false,
};

function openHistory() {
  fireEvent.click(screen.getByRole('button', { name: /历史快照/ }));
}

test('loads history on mount but keeps the list hidden until the button is clicked', async () => {
  const { loads } = setup([]);
  render(<BackupPanel harnessId="codex" />);
  await waitFor(() => expect(loads).toHaveLength(1));
  expect(screen.queryByText('还没有历史快照')).toBeNull();

  openHistory();
  expect(screen.getByText('还没有历史快照')).toBeInTheDocument();
  expect(screen.queryByText('当前')).toBeNull();
});

test('only lists history for the selected harness', () => {
  setup([codexEntry, claudeEntry]);
  render(<BackupPanel harnessId="codex" />);

  expect(screen.queryByText('openrouter')).toBeNull();
  expect(screen.queryByText('relay')).toBeNull();

  openHistory();

  expect(screen.getByText('openrouter')).toBeInTheDocument();
  expect(screen.queryByText('relay')).toBeNull();
  expect(screen.getByText(/2 个文件/)).toBeInTheDocument();
  expect(screen.getByText(/含删除/)).toBeInTheDocument();
  expect(screen.queryByText('当前')).toBeNull();
  expect(screen.queryByText('/home/tester/.codex/config.toml')).toBeNull();
});

test('marks the history entry that already matches the live files', () => {
  setup([codexEntry, currentEntry]);
  render(<BackupPanel harnessId="codex" />);
  openHistory();

  expect(screen.getByText('当前')).toBeInTheDocument();
  expect(screen.getByText('previous')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '恢复' })).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: '恢复' })).toHaveLength(1);
});

test('restoring shows the live-vs-snapshot diff before writing files back', async () => {
  const { restored, details } = setup([codexEntry, claudeEntry]);
  render(<BackupPanel harnessId="codex" />);
  openHistory();

  fireEvent.click(screen.getByRole('button', { name: '恢复' }));
  expect(restored).toEqual([]);
  await waitFor(() => expect(details).toEqual([codexEntry.id]));
  expect(screen.getByText(/当前将丢失的内容/)).toBeInTheDocument();
  expect(screen.getByText('/home/tester/.codex/config.toml')).toBeInTheDocument();
  expect(screen.getByText('将覆盖')).toBeInTheDocument();
  expect(screen.getByText('将删除')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '确认恢复' }));
  await waitFor(() => expect(restored).toEqual([codexEntry.id]));
});
