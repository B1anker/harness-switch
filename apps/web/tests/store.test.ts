import { afterEach, beforeEach, expect, test } from '@rstest/core';
import { useAppStore } from '@/stores/app-store';

type Recorded = { path: string; method: string; body?: string };

let requests: Recorded[] = [];
let responder: (path: string, method: string) => { status: number; body: unknown };
const realFetch = globalThis.fetch;

beforeEach(() => {
  requests = [];
  responder = () => ({ status: 200, body: {} });
  globalThis.fetch = (async (input: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    requests.push({ path: input, method, body: init.body as string | undefined });
    const { status, body } = responder(input, method);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof globalThis.fetch;

  useAppStore.setState({
    authenticated: true,
    harnesses: [],
    backups: [],
    envFile: '',
    error: null,
    notice: null,
  });
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function harnessResponse() {
  return {
    envFile: '/home/tester/.harness-switch/env.sh',
    items: [{ id: 'claude', label: 'Claude Code', mode: 'replace', profiles: [] }],
  };
}

test('loading harnesses stores the collection and the env file path', async () => {
  responder = () => ({ status: 200, body: harnessResponse() });
  await useAppStore.getState().loadHarnesses();

  expect(useAppStore.getState().harnesses).toHaveLength(1);
  expect(useAppStore.getState().envFile).toBe('/home/tester/.harness-switch/env.sh');
  expect(useAppStore.getState().loading).toBe(false);
});

test('an expired session drops the user back to the login screen without an error banner', async () => {
  responder = () => ({ status: 401, body: { error: 'authentication required' } });
  await useAppStore.getState().loadHarnesses();

  const state = useAppStore.getState();
  expect(state.authenticated).toBe(false);
  expect(state.harnesses).toEqual([]);
  expect(state.error).toBeNull();
});

test('a real failure surfaces the server message', async () => {
  responder = () => ({ status: 500, body: { error: 'disk full' } });
  await useAppStore.getState().loadHarnesses();
  expect(useAppStore.getState().error).toBe('disk full');
});

test('activating explains what took effect and when', async () => {
  useAppStore.setState({
    harnesses: [{ id: 'claude', label: 'Claude Code' }],
  } as Partial<ReturnType<typeof useAppStore.getState>> as never);
  responder = (path) =>
    path.endsWith('/activate')
      ? { status: 200, body: { ok: true, envFile: '/env.sh', warnings: [] } }
      : { status: 200, body: harnessResponse() };

  await useAppStore.getState().activateProfile('claude', 'openrouter-main');

  const notice = useAppStore.getState().notice ?? '';
  expect(notice).toContain('Claude Code 已切换到「openrouter-main」');
  // The old copy told people to source env.sh, which is no longer how a switch works.
  expect(notice).not.toContain('source');
  expect(requests[0]).toMatchObject({
    path: '/api/harnesses/claude/profiles/openrouter-main/activate',
    method: 'POST',
  });
});

test('warnings from steps after the switch committed are shown, not swallowed', async () => {
  responder = (path) =>
    path.endsWith('/activate')
      ? {
          status: 200,
          body: { ok: true, envFile: '/env.sh', warnings: ['未能把 main 的现有配置回填保存'] },
        }
      : { status: 200, body: harnessResponse() };

  await useAppStore.getState().activateProfile('claude', 'spare');
  expect(useAppStore.getState().notice).toContain('注意：未能把 main 的现有配置回填保存');
});

test('creating and updating hit the right paths and refresh the list', async () => {
  responder = () => ({ status: 200, body: harnessResponse() });

  await useAppStore.getState().createProfile('claude', {
    name: 'main',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-test',
  });
  await useAppStore.getState().updateProfile('kimi', 'prod key', { model: 'kimi-k2' });
  await useAppStore.getState().deleteProfile('claude', 'main');

  expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
    'POST /api/harnesses/claude/profiles',
    'GET /api/harnesses',
    'PATCH /api/harnesses/kimi/profiles/prod%20key',
    'GET /api/harnesses',
    'DELETE /api/harnesses/claude/profiles/main',
    'GET /api/harnesses',
  ]);
});

test('a rejected write is raised so the dialog can keep the form open', async () => {
  responder = () => ({ status: 409, body: { error: 'profile already exists' } });
  await expect(
    useAppStore.getState().createProfile('claude', { name: 'main', baseUrl: 'https://a' }),
  ).rejects.toThrow('profile already exists');
});

test('previewing returns the rendered targets without storing them', async () => {
  responder = () => ({
    status: 200,
    body: { targets: [{ key: 'settings', path: '/s.json', content: '{}', overridden: false }] },
  });

  const targets = await useAppStore.getState().previewProfile('claude', 'main');
  expect(targets).toHaveLength(1);
  expect(requests[0]?.path).toBe('/api/harnesses/claude/profiles/main/preview');
});

test('loading backup detail fetches the snapshot against live files', async () => {
  responder = () => ({
    status: 200,
    body: {
      id: '2026-08-13T00-00-00-000Z-claude-main',
      files: [{ path: '/s.json', existed: true, content: '{}', currentContent: '{"a":1}' }],
    },
  });

  const detail = await useAppStore
    .getState()
    .loadBackupDetail('2026-08-13T00-00-00-000Z-claude-main');
  expect(requests[0]?.path).toBe('/api/backups/2026-08-13T00-00-00-000Z-claude-main');
  expect(detail.files[0]?.currentContent).toBe('{"a":1}');
});

test('restoring a backup reports it and reloads the harnesses', async () => {
  responder = (path) =>
    path === '/api/harnesses'
      ? { status: 200, body: harnessResponse() }
      : { status: 200, body: { ok: true } };

  await useAppStore.getState().restoreBackup('2026-08-13T00-00-00-000Z-claude-main');

  expect(requests[0]?.path).toBe('/api/backups/2026-08-13T00-00-00-000Z-claude-main/restore');
  expect(useAppStore.getState().notice).toContain('历史');
});

test('logging out clears everything the session loaded', async () => {
  useAppStore.setState({
    harnesses: [{ id: 'claude' }],
    backups: [{ id: 'b' }],
    envFile: '/env.sh',
  } as Partial<ReturnType<typeof useAppStore.getState>> as never);

  await useAppStore.getState().logout();

  const state = useAppStore.getState();
  expect(state.authenticated).toBe(false);
  expect(state.harnesses).toEqual([]);
  expect(state.backups).toEqual([]);
  expect(state.envFile).toBe('');
});

test('dismissing the notice clears it', () => {
  useAppStore.setState({ notice: 'something happened' });
  useAppStore.getState().clearNotice();
  expect(useAppStore.getState().notice).toBeNull();
});
