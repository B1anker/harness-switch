import { expect, test } from '@rstest/core';
import type { BackupEntry } from '@seaveyon/harness-switch-shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BackupPanel } from '@/components/backup-panel';
import { useAppStore } from '@/stores/app-store';

function setup(backups: BackupEntry[]) {
  const restored: string[] = [];
  const loads: number[] = [];
  useAppStore.setState({
    backups,
    loadBackups: async () => {
      loads.push(1);
    },
    restoreBackup: async (id: string) => {
      restored.push(id);
    },
  } as Partial<ReturnType<typeof useAppStore.getState>> as never);
  return { restored, loads };
}

const entry: BackupEntry = {
  id: '2026-08-13T09-30-00-000Z-codex-openrouter',
  createdAt: '2026-08-13T09:30:00.000Z',
  harness: 'codex',
  profile: 'openrouter',
  files: [
    { path: '/home/tester/.codex/config.toml', existed: true },
    { path: '/home/tester/.codex/auth.json', existed: false },
  ],
};

test('loads the list on mount', async () => {
  const { loads } = setup([]);
  render(<BackupPanel />);
  await waitFor(() => expect(loads).toHaveLength(1));
  expect(screen.getByText('还没有备份')).toBeInTheDocument();
});

test('lists which files a snapshot holds and flags the ones that were absent', () => {
  setup([entry]);
  render(<BackupPanel />);

  expect(screen.getByText('codex / openrouter')).toBeInTheDocument();
  expect(screen.getByText('/home/tester/.codex/config.toml')).toBeInTheDocument();
  // Restoring a file that did not exist means deleting it, which is worth saying out loud.
  expect(screen.getByText(/当时不存在，恢复会删除/)).toBeInTheDocument();
});

test('restoring asks for confirmation first', async () => {
  const { restored } = setup([entry]);
  render(<BackupPanel />);

  fireEvent.click(screen.getByRole('button', { name: '恢复' }));
  expect(restored).toEqual([]);
  expect(screen.getByText(/当前内容将丢失/)).toBeInTheDocument();

  const confirms = screen.getAllByRole('button', { name: '恢复' });
  fireEvent.click(confirms[confirms.length - 1]!);
  await waitFor(() => expect(restored).toEqual([entry.id]));
});
