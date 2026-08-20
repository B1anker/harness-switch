import { expect, test } from '@rstest/core';
import type { DriftSummary } from '@seaveyon/harness-switch-shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DriftDialog } from '@/components/drift-dialog';
import { useAppStore } from '@/stores/app-store';
import { driftFileFixture, driftSummaryFixture, harnessFixture } from './fixtures';

type Recorded = {
  reapplied: string[];
  adopted: string[];
};

function setup(reports: DriftSummary[]): Recorded {
  const recorded: Recorded = { reapplied: [], adopted: [] };
  useAppStore.setState({
    drift: reports,
    driftLoading: false,
    driftError: null,
    reapplyDrift: async (harness: string) => {
      recorded.reapplied.push(harness);
      return [];
    },
    adoptDrift: async (harness: string) => {
      recorded.adopted.push(harness);
      return {
        ok: true,
        summary: reports.find((report) => report.harness === harness) ?? driftSummaryFixture(),
        warnings: [],
      };
    },
  } as Partial<ReturnType<typeof useAppStore.getState>> as never);
  return recorded;
}

function renderDialog() {
  render(<DriftDialog harness={harnessFixture()} open onOpenChange={() => {}} />);
}

test('shows the per-file diff against the live files', async () => {
  setup([
    driftSummaryFixture({
      status: 'drifted',
      files: [driftFileFixture()],
    }),
  ]);
  renderDialog();

  expect(screen.getByText('已修改')).toBeInTheDocument();
  // The path appears both in the status row and in the ConfigDiffs header.
  expect(screen.getAllByText('/home/tester/.claude/settings.json').length).toBeGreaterThan(0);
  // ConfigDiffs reuses the existing diff pipeline: live on the left, expected on the right.
  expect(await screen.findByText(/sk-live/)).toBeInTheDocument();
  expect(await screen.findByText(/sk-expected/)).toBeInTheDocument();
  expect(screen.getByText('将覆盖')).toBeInTheDocument();
});

test('reapplying requires confirmation and then writes the expected content', async () => {
  const recorded = setup([
    driftSummaryFixture({
      status: 'drifted',
      files: [driftFileFixture()],
    }),
  ]);
  const closes: boolean[] = [];
  render(
    <DriftDialog harness={harnessFixture()} open onOpenChange={(open) => closes.push(open)} />,
  );

  fireEvent.click(screen.getByRole('button', { name: '重新应用' }));
  expect(recorded.reapplied).toEqual([]);
  expect(screen.getByText('重新应用激活配置？')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '确认重新应用' }));
  await waitFor(() => expect(recorded.reapplied).toEqual(['claude']));
  expect(closes).toEqual([false]);
});

test('adopting the live files asks for confirmation too', async () => {
  const recorded = setup([
    driftSummaryFixture({
      status: 'drifted',
      files: [driftFileFixture()],
    }),
  ]);
  renderDialog();

  fireEvent.click(screen.getByRole('button', { name: '采纳现场配置' }));
  expect(recorded.adopted).toEqual([]);

  fireEvent.click(screen.getByRole('button', { name: '确认采纳' }));
  await waitFor(() => expect(recorded.adopted).toEqual(['claude']));
});

test('an inactive harness offers nothing to reapply or adopt', () => {
  setup([driftSummaryFixture({ active: false, status: 'unknown', files: [] })]);
  renderDialog();

  expect(screen.getAllByText(/未激活任何配置/).length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: '重新应用' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '采纳现场配置' })).toBeDisabled();
});

test('an adopt failure surfaces the server message', async () => {
  useAppStore.setState({
    drift: [driftSummaryFixture({ status: 'drifted', files: [driftFileFixture()] })],
    driftLoading: false,
    driftError: null,
    reapplyDrift: async () => [],
    adoptDrift: async () => {
      throw new Error('存在手动 override 的文件，无法采纳');
    },
  } as Partial<ReturnType<typeof useAppStore.getState>> as never);
  renderDialog();

  fireEvent.click(screen.getByRole('button', { name: '采纳现场配置' }));
  fireEvent.click(screen.getByRole('button', { name: '确认采纳' }));

  expect(await screen.findByText(/存在手动 override 的文件，无法采纳/)).toBeInTheDocument();
});
