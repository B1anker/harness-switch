import { expect, test } from '@rstest/core';
import type { DoctorReport } from '@seaveyon/harness-switch-shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DoctorDialog } from '@/components/doctor-dialog';
import { doctorCheckFixture, doctorReportFixture, setStoreState } from './support';

type Recorded = {
  runs: string[];
};

function setup(reports: DoctorReport[] | null, updatedAvailable = false): Recorded {
  const recorded: Recorded = { runs: [] };
  setStoreState({
    doctor: reports,
    doctorUpdatedAvailable: updatedAvailable,
    doctorLoading: false,
    doctorError: null,
    loadDoctor: async (harnessId) => {
      recorded.runs.push(harnessId);
    },
  });
  return recorded;
}

test('renders the summary and check details for one harness', () => {
  setup([doctorReportFixture()]);
  render(<DoctorDialog harnessId="claude" open onOpenChange={() => {}} />);

  expect(screen.getByRole('heading', { name: 'Claude Code 诊断' })).toBeInTheDocument();
  expect(screen.getByText('1 项正常')).toBeInTheDocument();
  expect(screen.getByText('1 项警告')).toBeInTheDocument();
  expect(screen.getByText('已找到可执行文件 claude')).toBeInTheDocument();
  expect(screen.getByText('2 个文件与激活配置不一致（drifted）')).toBeInTheDocument();
});

test('labels every severity level with a status tag', () => {
  setup([
    doctorReportFixture({
      checks: [
        doctorCheckFixture({ id: 'ok' }),
        doctorCheckFixture({ id: 'warn', status: 'warn' }),
        doctorCheckFixture({ id: 'error', status: 'error' }),
        doctorCheckFixture({ id: 'unknown', status: 'unknown' }),
      ],
    }),
  ]);
  render(<DoctorDialog harnessId="claude" open onOpenChange={() => {}} />);

  expect(screen.getByText('正常')).toBeInTheDocument();
  expect(screen.getByText('警告')).toBeInTheDocument();
  expect(screen.getByText('错误')).toBeInTheDocument();
  expect(screen.getByText('未知')).toBeInTheDocument();
});

test('runs once on open when there is no report yet and re-runs on demand', async () => {
  const recorded = setup(null);
  render(<DoctorDialog harnessId="claude" open onOpenChange={() => {}} />);

  await waitFor(() => expect(recorded.runs).toEqual(['claude']));

  fireEvent.click(screen.getByRole('button', { name: '重新诊断' }));
  await waitFor(() => expect(recorded.runs).toEqual(['claude', 'claude']));
});

test('shows the update hint when a newer release exists', () => {
  setup([doctorReportFixture()], true);
  render(<DoctorDialog harnessId="claude" open onOpenChange={() => {}} />);

  expect(screen.getByText(/有新版本可用/)).toBeInTheDocument();
});

test('explains when no report has been produced yet', () => {
  setup(null);
  render(<DoctorDialog harnessId="claude" open onOpenChange={() => {}} />);

  expect(screen.getByText('尚未运行诊断')).toBeInTheDocument();
});
