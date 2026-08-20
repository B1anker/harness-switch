import { expect, test } from '@rstest/core';
import type { DoctorReport } from '@seaveyon/harness-switch-shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DoctorDialog } from '@/components/doctor-dialog';
import { useAppStore } from '@/stores/app-store';
import { doctorCheckFixture, doctorReportFixture } from './fixtures';

type Recorded = {
  runs: number[];
};

function setup(reports: DoctorReport[] | null, updatedAvailable = false): Recorded {
  const recorded: Recorded = { runs: [] };
  useAppStore.setState({
    doctor: reports,
    doctorUpdatedAvailable: updatedAvailable,
    doctorLoading: false,
    doctorError: null,
    loadDoctor: async () => {
      recorded.runs.push(1);
    },
  } as Partial<ReturnType<typeof useAppStore.getState>> as never);
  return recorded;
}

test('renders the summary, harness groups and check details', () => {
  setup([doctorReportFixture()]);
  render(<DoctorDialog open onOpenChange={() => {}} />);

  expect(screen.getByText('1 项正常')).toBeInTheDocument();
  expect(screen.getByText('1 项警告')).toBeInTheDocument();
  expect(screen.getByText('Claude Code')).toBeInTheDocument();
  expect(screen.getByText('claude.install')).toBeInTheDocument();
  expect(screen.getByText('已找到可执行文件 claude')).toBeInTheDocument();
  expect(screen.getByText('2 个文件与激活配置不一致（drifted）')).toBeInTheDocument();
});

test('labels every severity level with a status tag', () => {
  setup([
    doctorReportFixture({
      checks: [
        doctorCheckFixture({ id: 'ok', label: 'ok check' }),
        doctorCheckFixture({ id: 'warn', label: 'warn check', status: 'warn' }),
        doctorCheckFixture({ id: 'error', label: 'error check', status: 'error' }),
        doctorCheckFixture({ id: 'unknown', label: 'unknown check', status: 'unknown' }),
      ],
    }),
  ]);
  render(<DoctorDialog open onOpenChange={() => {}} />);

  expect(screen.getByText('正常')).toBeInTheDocument();
  expect(screen.getByText('警告')).toBeInTheDocument();
  expect(screen.getByText('错误')).toBeInTheDocument();
  expect(screen.getByText('未知')).toBeInTheDocument();
});

test('runs once on open when there is no report yet and re-runs on demand', async () => {
  const recorded = setup(null);
  render(<DoctorDialog open onOpenChange={() => {}} />);

  // Opening with no report triggers one run.
  await waitFor(() => expect(recorded.runs).toHaveLength(1));

  fireEvent.click(screen.getByRole('button', { name: '重新诊断' }));
  await waitFor(() => expect(recorded.runs).toHaveLength(2));
});

test('shows the update hint when a newer release exists', () => {
  setup([doctorReportFixture()], true);
  render(<DoctorDialog open onOpenChange={() => {}} />);

  expect(screen.getByText(/有新版本可用/)).toBeInTheDocument();
});

test('explains when no report has been produced yet', () => {
  setup(null);
  render(<DoctorDialog open onOpenChange={() => {}} />);

  expect(screen.getByText('尚未运行诊断')).toBeInTheDocument();
});
