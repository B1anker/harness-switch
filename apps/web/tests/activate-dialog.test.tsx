import { afterEach, expect, test } from '@rstest/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { ActivateDialog } from '@/components/activate-dialog';
import { useAppStore } from '@/stores/app-store';
import { harnessFixture, profileFixture } from './fixtures';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  useAppStore.setState({
    harnesses: [],
    backups: [],
    notice: null,
    loadBackups: async () => {},
  });
});

function json(payload: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, json: async () => payload };
}

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
  globalThis.fetch = (async (path: string) => {
    if (path.includes('/preview')) {
      return json({ targets: previewTargets });
    }
    return json({});
  }) as unknown as typeof fetch;

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

test('confirm posts the activation and closes', async () => {
  const requests: string[] = [];
  globalThis.fetch = (async (path: string, init: RequestInit = {}) => {
    requests.push(`${init.method ?? 'GET'} ${path}`);
    if (path.includes('/preview')) {
      return json({ targets: previewTargets });
    }
    if (path === '/api/harnesses') {
      return json({ items: [harnessFixture()], envFile: '' });
    }
    return json({ ok: true, envFile: '', warnings: [] });
  }) as unknown as typeof fetch;

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
    if (
      requests.some(
        (request) => request === 'POST /api/harnesses/claude/profiles/openrouter-main/activate',
      )
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  expect(requests).toContain('POST /api/harnesses/claude/profiles/openrouter-main/activate');
  expect(closed).toBe(true);
});

test('cancel does not activate', async () => {
  const requests: string[] = [];
  globalThis.fetch = (async (path: string, init: RequestInit = {}) => {
    requests.push(`${init.method ?? 'GET'} ${path}`);
    if (path.includes('/preview')) {
      return json({ targets: previewTargets });
    }
    return json({});
  }) as unknown as typeof fetch;

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
  expect(requests).not.toContain('POST /api/harnesses/claude/profiles/openrouter-main/activate');
});
