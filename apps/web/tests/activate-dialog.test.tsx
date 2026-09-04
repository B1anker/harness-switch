import { expect, test } from '@rstest/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ActivateDialog } from '@/components/activate-dialog';
import { useAppStore } from '@/stores/app-store';
import { harnessFixture, profileFixture, recordRequests, status, stubFetch } from './support';

const previewTargets = [
  {
    key: 'settings',
    label: 'settings.json',
    path: '/home/test/.claude/settings.json',
    format: 'json',
    content: '{"env":{"ANTHROPIC_BASE_URL":"https://api.example.com/v1"}}\n',
    overridden: false,
    currentContent: null,
  },
  {
    key: 'auth',
    label: 'auth.json',
    path: '/home/test/.claude/auth.json',
    format: 'json',
    content: '{"tokens":"new"}\n',
    overridden: false,
    currentContent: '{"tokens":"old"}\n',
  },
  {
    key: 'same',
    label: 'unchanged.json',
    path: '/home/test/.claude/unchanged.json',
    format: 'json',
    content: '{"keep":1}\n',
    overridden: false,
    currentContent: '{"keep":1}\n',
  },
];

test('shows the diff against live files before activating', async () => {
  stubFetch((url) => (url.includes('/preview') ? { targets: previewTargets } : {}));

  render(
    <ActivateDialog
      harness={harnessFixture()}
      profile={profileFixture({ name: 'openrouter-main' })}
      open
      onOpenChange={() => {}}
    />,
  );

  expect(await screen.findByText(/将把 Claude Code 切换到「openrouter-main」/)).toBeInTheDocument();
  expect(await screen.findByText('将新建')).toBeInTheDocument();
  expect(screen.getByText('将覆盖')).toBeInTheDocument();
  expect(screen.getByText('无变更')).toBeInTheDocument();
  expect(screen.getByText('/home/test/.claude/settings.json')).toBeInTheDocument();
});

test('confirm closes the dialog once the write completes', async () => {
  const { handler, requests } = recordRequests((url) => {
    if (url.includes('/preview')) {
      return { targets: previewTargets };
    }
    if (url === '/api/harnesses') {
      return { items: [harnessFixture()], envFile: '' };
    }
    return { ok: true, envFile: '', warnings: [] };
  });
  stubFetch(handler);
  const calls = () => requests.map((request) => `${request.method} ${request.path}`);

  let closed = false;
  render(
    <ActivateDialog
      harness={harnessFixture()}
      profile={profileFixture({ name: 'openrouter-main' })}
      open
      onOpenChange={(open) => !open && (closed = true)}
    />,
  );

  fireEvent.click(await screen.findByRole('button', { name: '确认激活' }));
  for (let i = 0; i < 100; i++) {
    if (calls().includes('POST /api/harnesses/claude/profiles/openrouter-main/activate')) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  expect(calls()).toContain('POST /api/harnesses/claude/profiles/openrouter-main/activate');
  await waitFor(() => expect(closed).toBe(true));
  expect(useAppStore.getState().notice?.[0]?.key).toBe('notice.switchDone');
});

test('keeps the preview open and offers retry when activation fails', async () => {
  stubFetch((url) =>
    url.includes('/preview')
      ? { targets: previewTargets }
      : status(500, { code: 'http.requestFailed', msg: 'disk full' }),
  );

  render(
    <ActivateDialog
      harness={harnessFixture()}
      profile={profileFixture({ name: 'openrouter-main' })}
      open
      onOpenChange={() => {}}
    />,
  );

  fireEvent.click(await screen.findByRole('button', { name: '确认激活' }));
  expect(await screen.findByText(/写入失败/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '重试激活' })).toBeInTheDocument();
  expect(screen.getByText('/home/test/.claude/settings.json')).toBeInTheDocument();
});

test('cancel does not activate', async () => {
  const { handler, requests } = recordRequests((url) =>
    url.includes('/preview') ? { targets: previewTargets } : {},
  );
  stubFetch(handler);

  render(
    <ActivateDialog
      harness={harnessFixture()}
      profile={profileFixture({ name: 'openrouter-main' })}
      open
      onOpenChange={() => {}}
    />,
  );

  fireEvent.click(await screen.findByRole('button', { name: '取消' }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(requests.map((request) => `${request.method} ${request.path}`)).not.toContain(
    'POST /api/harnesses/claude/profiles/openrouter-main/activate',
  );
});
