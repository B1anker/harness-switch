import { expect, test } from '@rstest/core';
import type { DoctorReport, DriftSummary } from '@seaveyon/harness-switch-shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DoctorPanel } from '@/components/doctor-panel';
import { useAppStore } from '@/stores/app-store';
import {
  doctorReportFixture,
  driftFileFixture,
  driftSummaryFixture,
  harnessFixture,
} from './fixtures';

function setup({
  doctor = [doctorReportFixture()],
  drift = [driftSummaryFixture()],
  doctorLoads = [] as string[],
  driftLoads = [] as number[],
}: {
  doctor?: DoctorReport[] | null;
  drift?: DriftSummary[] | null;
  doctorLoads?: string[];
  driftLoads?: number[];
} = {}) {
  useAppStore.setState({
    doctor,
    doctorLoading: false,
    doctorError: null,
    doctorUpdatedAvailable: false,
    loadDoctor: async (harnessId) => {
      doctorLoads.push(harnessId);
    },
    drift,
    driftLoading: false,
    driftError: null,
    loadDrift: async () => {
      driftLoads.push(1);
    },
    reapplyDrift: async () => [],
    adoptDrift: async () => ({
      ok: true,
      summary: driftSummaryFixture(),
      warnings: [],
    }),
  } as Partial<ReturnType<typeof useAppStore.getState>> as never);
}

test('loads doctor and drift on mount when the store has none', async () => {
  const doctorLoads: string[] = [];
  const driftLoads: number[] = [];
  setup({ doctor: null, drift: null, doctorLoads, driftLoads });
  render(<DoctorPanel harness={harnessFixture()} />);
  await waitFor(() => expect(doctorLoads).toEqual(['claude']));
  await waitFor(() => expect(driftLoads).toHaveLength(1));
});

test('shows doctor summary badges and an in-sync drift badge', () => {
  setup();
  render(<DoctorPanel harness={harnessFixture()} />);

  expect(screen.getByText('诊断')).toBeInTheDocument();
  expect(screen.getByText('1 项正常')).toBeInTheDocument();
  expect(screen.getByText('1 项警告')).toBeInTheDocument();
  expect(screen.getByText('无漂移')).toBeInTheDocument();
});

test('shows the drifted count and the affected file basenames', () => {
  setup({
    drift: [
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
  });
  render(<DoctorPanel harness={harnessFixture()} />);

  expect(screen.getByText('2 个文件不一致')).toBeInTheDocument();
  expect(screen.getByText('settings.json')).toBeInTheDocument();
  expect(screen.getByText('auth.json')).toBeInTheDocument();
  expect(screen.getByText('缺失')).toBeInTheDocument();
});

test('an inactive harness hides the diff button', () => {
  setup({
    drift: [driftSummaryFixture({ active: false, status: 'unknown', files: [] })],
  });
  render(<DoctorPanel harness={harnessFixture()} />);

  expect(screen.getByText('未激活')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '查看差异' })).toBeNull();
});

test('hides the diff button when files are in sync', () => {
  setup();
  render(<DoctorPanel harness={harnessFixture()} />);

  expect(screen.getByText('无漂移')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '查看差异' })).toBeNull();
});

test('opens the doctor and drift dialogs from the panel', () => {
  setup({
    drift: [
      driftSummaryFixture({
        status: 'drifted',
        files: [driftFileFixture()],
      }),
    ],
  });
  render(<DoctorPanel harness={harnessFixture()} />);

  fireEvent.click(screen.getByRole('button', { name: '查看详情' }));
  expect(screen.getByRole('heading', { name: 'Claude Code 诊断' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));

  fireEvent.click(screen.getByRole('button', { name: '查看差异' }));
  expect(screen.getAllByText(/配置漂移/).length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: '重新应用' })).toBeInTheDocument();
});
