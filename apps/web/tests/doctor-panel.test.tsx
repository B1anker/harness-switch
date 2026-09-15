import { expect, test } from '@rstest/core';
import type { DoctorReport, DriftSummary } from '@seaveyon/harness-switch-shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DoctorRow, HealthBanner } from '@/components/doctor-panel';
import {
  doctorReportFixture,
  driftFileFixture,
  driftSummaryFixture,
  harnessFixture,
  setStoreState,
} from './support';

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
  setStoreState({
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
  });
}

/** The fixture report carries one warning; this one is clean. */
function healthyReport(): DoctorReport {
  const report = doctorReportFixture();
  return { ...report, checks: report.checks.map((check) => ({ ...check, status: 'ok' })) };
}

test('the banner loads doctor and drift on mount when the store has none', async () => {
  const doctorLoads: string[] = [];
  const driftLoads: number[] = [];
  setup({ doctor: null, drift: null, doctorLoads, driftLoads });
  render(<HealthBanner harness={harnessFixture()} />);
  await waitFor(() => expect(doctorLoads).toEqual(['claude']));
  await waitFor(() => expect(driftLoads).toHaveLength(1));
});

test('a healthy, in-sync harness gets no banner at all', () => {
  setup({ doctor: [healthyReport()] });
  const { container } = render(<HealthBanner harness={harnessFixture()} />);
  expect(container).toBeEmptyDOMElement();
});

test('a doctor warning brings the banner up with the counts that matter', () => {
  setup();
  render(<HealthBanner harness={harnessFixture()} />);

  expect(screen.getByText('诊断')).toBeInTheDocument();
  expect(screen.getByText('1 项警告')).toBeInTheDocument();
  // In-sync drift is not news; the banner is about what is wrong.
  expect(screen.queryByText('无漂移')).toBeNull();
  expect(screen.queryByRole('button', { name: '查看差异' })).toBeNull();
});

test('drift alone is enough for the banner, with the affected file basenames', () => {
  setup({
    doctor: [healthyReport()],
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
  render(<HealthBanner harness={harnessFixture()} />);

  expect(screen.getByText('2 个文件不一致')).toBeInTheDocument();
  expect(screen.getByText('settings.json')).toBeInTheDocument();
  expect(screen.getByText('auth.json')).toBeInTheDocument();
  expect(screen.getByText('缺失')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '查看差异' })).toBeInTheDocument();
});

test('an inactive harness has no drift to report', () => {
  setup({
    doctor: [healthyReport()],
    drift: [driftSummaryFixture({ active: false, status: 'unknown', files: [] })],
  });
  const { container } = render(<HealthBanner harness={harnessFixture()} />);
  expect(container).toBeEmptyDOMElement();
});

test('opens the doctor and drift dialogs from the banner', () => {
  setup({
    drift: [
      driftSummaryFixture({
        status: 'drifted',
        files: [driftFileFixture()],
      }),
    ],
  });
  render(<HealthBanner harness={harnessFixture()} />);

  fireEvent.click(screen.getByRole('button', { name: '查看详情' }));
  expect(screen.getByRole('heading', { name: 'Claude Code 诊断' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '关闭对话框' }));

  fireEvent.click(screen.getByRole('button', { name: '查看差异' }));
  expect(screen.getAllByText(/配置漂移/).length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: '重新应用' })).toBeInTheDocument();
});

test('the details row always shows the report, healthy or not', () => {
  setup({ doctor: [healthyReport()] });
  render(<DoctorRow harness={harnessFixture()} />);

  expect(screen.getByText('诊断')).toBeInTheDocument();
  expect(screen.getByText('2 项正常')).toBeInTheDocument();
  expect(screen.getByText('无漂移')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '查看详情' }));
  expect(screen.getByRole('heading', { name: 'Claude Code 诊断' })).toBeInTheDocument();
});

test('the details row reruns both checks without loading on its own', async () => {
  const doctorLoads: string[] = [];
  const driftLoads: number[] = [];
  setup({ doctorLoads, driftLoads });
  render(<DoctorRow harness={harnessFixture()} />);
  expect(doctorLoads).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: '重新诊断' }));
  await waitFor(() => expect(doctorLoads).toEqual(['claude']));
  expect(driftLoads).toHaveLength(1);
});
