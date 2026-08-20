import { expect, test } from '@rstest/core';
import type { DriftSummary } from '@seaveyon/harness-switch-shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DriftPanel } from '@/components/drift-panel';
import { useAppStore } from '@/stores/app-store';
import { driftFileFixture, driftSummaryFixture, harnessFixture } from './fixtures';

function setup(reports: DriftSummary[] | null, loads: number[]) {
  useAppStore.setState({
    drift: reports,
    driftLoading: false,
    driftError: null,
    loadDrift: async () => {
      loads.push(1);
    },
    reapplyDrift: async () => [],
    adoptDrift: async () => ({
      ok: true,
      summary: driftSummaryFixture(),
      warnings: [],
    }),
  } as Partial<ReturnType<typeof useAppStore.getState>> as never);
}

test('loads the drift view on mount when the store has none', async () => {
  const loads: number[] = [];
  setup(null, loads);
  render(<DriftPanel harness={harnessFixture()} />);
  await waitFor(() => expect(loads).toHaveLength(1));
});

test('shows an in-sync report as drift-free', () => {
  const loads: number[] = [];
  setup([driftSummaryFixture()], loads);
  render(<DriftPanel harness={harnessFixture()} />);

  expect(screen.getByText('无漂移')).toBeInTheDocument();
  expect(loads).toEqual([]);
});

test('shows the drifted count and the affected file basenames', () => {
  setup(
    [
      driftSummaryFixture({
        status: 'drifted',
        files: [
          driftFileFixture(),
          driftFileFixture({
            key: 'auth',
            path: '/home/tester/.claude/auth.json',
            status: 'missing',
            currentContent: null,
          }),
        ],
      }),
    ],
    [],
  );
  render(<DriftPanel harness={harnessFixture()} />);

  expect(screen.getByText('2 个文件不一致')).toBeInTheDocument();
  expect(screen.getByText('settings.json')).toBeInTheDocument();
  expect(screen.getByText('auth.json')).toBeInTheDocument();
  expect(screen.getByText('缺失')).toBeInTheDocument();
});

test('an inactive harness disables the diff button', () => {
  setup([driftSummaryFixture({ active: false, status: 'unknown', files: [] })], []);
  render(<DriftPanel harness={harnessFixture()} />);

  expect(screen.getByText('未激活')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '查看差异' })).toBeDisabled();
});

test('opens the diff dialog from the panel', () => {
  setup(
    [
      driftSummaryFixture({
        status: 'drifted',
        files: [driftFileFixture()],
      }),
    ],
    [],
  );
  render(<DriftPanel harness={harnessFixture()} />);

  fireEvent.click(screen.getByRole('button', { name: '查看差异' }));
  expect(screen.getAllByText(/配置漂移/).length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: '重新应用' })).toBeInTheDocument();
});
