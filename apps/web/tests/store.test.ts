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
    currentUser: 'root',
    users: [],
    usersLoading: false,
    harnesses: [],
    backups: [],
    envFile: '',
    error: null,
    notice: null,
    providers: null,
    providersLoading: false,
    providersError: null,
    doctor: null,
    doctorUpdatedAvailable: false,
    doctorLoading: false,
    doctorError: null,
    drift: null,
    driftLoading: false,
    driftError: null,
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

function providersResponse() {
  return {
    items: [
      {
        id: 'openrouter',
        name: 'OpenRouter',
        apiKeyConfigured: true,
        endpoints: [],
        updatedAt: '2026-08-13T00:00:00.000Z',
      },
    ],
  };
}

function driftResponse() {
  return {
    items: [{ harness: 'claude', status: 'unknown', active: false, files: [] }],
  };
}

function doctorResponse() {
  return {
    items: [{ harness: 'claude', checks: [] }],
    updatedAvailable: true,
  };
}

test('loading harnesses stores the collection and the env file path', async () => {
  responder = () => ({ status: 200, body: harnessResponse() });
  await useAppStore.getState().loadHarnesses();

  expect(useAppStore.getState().harnesses).toHaveLength(1);
  expect(useAppStore.getState().envFile).toBe('/home/tester/.harness-switch/env.sh');
  expect(useAppStore.getState().loading).toBe(false);
});

test('switching Unix users refreshes every user-scoped collection', async () => {
  useAppStore.setState({
    users: [
      { username: 'root', uid: 0, gid: 0, homeDir: '/root', current: true },
      { username: 'alice', uid: 1000, gid: 1000, homeDir: '/home/alice', current: false },
    ],
  });
  responder = (path, method) => {
    if (path === '/api/users/alice/select' && method === 'POST') {
      return { status: 200, body: { currentUser: 'alice' } };
    }
    if (path === '/api/users') {
      return {
        status: 200,
        body: {
          currentUser: 'alice',
          items: [
            { username: 'root', uid: 0, gid: 0, homeDir: '/root', current: false },
            { username: 'alice', uid: 1000, gid: 1000, homeDir: '/home/alice', current: true },
          ],
        },
      };
    }
    if (path === '/api/harnesses') return { status: 200, body: harnessResponse() };
    if (path === '/api/backups') return { status: 200, body: { items: [] } };
    return { status: 200, body: driftResponse() };
  };

  await useAppStore.getState().switchUser('alice');

  expect(useAppStore.getState().currentUser).toBe('alice');
  expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
    'POST /api/users/alice/select',
    'GET /api/users',
    'GET /api/harnesses',
    'GET /api/backups',
    'GET /api/drift',
  ]);
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
  expect(useAppStore.getState().error).toMatchObject({
    key: 'error.unknown',
    fallback: 'disk full',
  });
});

test('loading the session also refreshes drift without blocking on its failure', async () => {
  responder = (path) =>
    path === '/api/auth/session'
      ? { status: 200, body: {} }
      : path === '/api/harnesses'
        ? { status: 200, body: harnessResponse() }
        : { status: 500, body: { error: 'drift broken' } };

  await useAppStore.getState().loadSession();

  expect(useAppStore.getState().authenticated).toBe(true);
  expect(requests.some((request) => request.path === '/api/drift')).toBe(true);
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

  const notice = useAppStore.getState().notice ?? [];
  expect(notice[0]).toMatchObject({
    key: 'notice.activated',
    params: { harness: 'Claude Code', profile: 'openrouter-main' },
  });
  expect(notice.some((line) => line.key === 'notice.activatedHint')).toBe(true);
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
          body: {
            ok: true,
            envFile: '/env.sh',
            warnings: [
              {
                code: 'warning.activation.backfillFailed',
                message: '未能把 main 的现有配置回填保存',
                params: { profile: 'main' },
              },
            ],
          },
        }
      : { status: 200, body: harnessResponse() };

  await useAppStore.getState().activateProfile('claude', 'spare');
  const notice = useAppStore.getState().notice ?? [];
  expect(notice).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        key: 'warning.activation.backfillFailed',
        fallback: '未能把 main 的现有配置回填保存',
      }),
    ]),
  );
});

test('creating and updating hit the right paths and refresh the list plus drift', async () => {
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
    'GET /api/drift',
    'PATCH /api/harnesses/kimi/profiles/prod%20key',
    'GET /api/harnesses',
    'GET /api/drift',
    'DELETE /api/harnesses/claude/profiles/main',
    'GET /api/harnesses',
    'GET /api/drift',
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
  expect(useAppStore.getState().notice).toEqual([{ key: 'backup.written' }]);
});

test('logging out clears everything the session loaded', async () => {
  useAppStore.setState({
    harnesses: [{ id: 'claude' }],
    backups: [{ id: 'b' }],
    envFile: '/env.sh',
    providers: [providersResponse().items[0]!],
    doctor: doctorResponse().items,
    drift: driftResponse().items,
  } as never);

  await useAppStore.getState().logout();

  const state = useAppStore.getState();
  expect(state.authenticated).toBe(false);
  expect(state.harnesses).toEqual([]);
  expect(state.backups).toEqual([]);
  expect(state.envFile).toBe('');
  expect(state.providers).toBeNull();
  expect(state.doctor).toBeNull();
  expect(state.drift).toBeNull();
});

test('dismissing the notice clears it', () => {
  useAppStore.setState({ notice: [{ key: 'notice.activatedHint' }] });
  useAppStore.getState().clearNotice();
  expect(useAppStore.getState().notice).toBeNull();
});

test('a dialog can hand its own success message to the toast', () => {
  // Dialogs that finish a job close themselves, so their result has to survive the unmount.
  useAppStore.getState().setNotice([{ key: 'notice.userSynced', fallback: '同步完成：新增 3。' }]);
  expect(useAppStore.getState().notice).toEqual([
    { key: 'notice.userSynced', fallback: '同步完成：新增 3。' },
  ]);
});

test('loading providers stores the list without ever exposing a key', async () => {
  responder = () => ({ status: 200, body: providersResponse() });

  await useAppStore.getState().loadProviders();

  expect(requests[0]?.path).toBe('/api/providers');
  expect(useAppStore.getState().providers).toHaveLength(1);
  expect(useAppStore.getState().providers?.[0]).not.toHaveProperty('apiKey');
});

test('an expired session clears the provider list back to empty', async () => {
  responder = () => ({ status: 401, body: { error: 'authentication required' } });
  await useAppStore.getState().loadProviders();
  expect(useAppStore.getState().authenticated).toBe(false);
  expect(useAppStore.getState().providers).toEqual([]);
});

test('creating a provider posts and reloads the list', async () => {
  responder = (path) =>
    path === '/api/providers'
      ? { status: 201, body: providersResponse().items[0] }
      : { status: 200, body: providersResponse() };

  await useAppStore.getState().createProvider({
    name: 'DeepSeek',
    apiKey: 'sk-test',
  });

  expect(requests[0]).toMatchObject({ path: '/api/providers', method: 'POST' });
  expect(JSON.parse(requests[0]?.body ?? '{}')).toEqual({ name: 'DeepSeek', apiKey: 'sk-test' });
  expect(requests.map((request) => request.path)).toEqual(['/api/providers', '/api/providers']);
});

test('updating a provider patches it and refreshes the harness list and drift', async () => {
  responder = (path) =>
    path === '/api/providers/openrouter'
      ? { status: 200, body: { provider: providersResponse().items[0], warnings: [] } }
      : path === '/api/harnesses'
        ? { status: 200, body: harnessResponse() }
        : path === '/api/drift'
          ? { status: 200, body: driftResponse() }
          : { status: 200, body: providersResponse() };

  const result = await useAppStore.getState().updateProvider('openrouter', {
    apiKey: 'sk-rotated',
  });

  expect(requests[0]).toMatchObject({ path: '/api/providers/openrouter', method: 'PATCH' });
  expect(result.provider.id).toBe('openrouter');
  expect(requests.some((request) => request.path === '/api/harnesses')).toBe(true);
  expect(requests.some((request) => request.path === '/api/drift')).toBe(true);
});

test('deleting a provider deletes and reloads', async () => {
  responder = (path) =>
    path === '/api/providers/openrouter'
      ? { status: 200, body: { ok: true } }
      : { status: 200, body: providersResponse() };

  await useAppStore.getState().deleteProvider('openrouter');

  expect(requests[0]).toMatchObject({ path: '/api/providers/openrouter', method: 'DELETE' });
  expect(requests.map((request) => request.path)).toEqual([
    '/api/providers/openrouter',
    '/api/providers',
  ]);
});

test('a referenced provider surfaces the 409 message', async () => {
  responder = () => ({ status: 409, body: { error: 'Provider 正被 2 个配置引用' } });
  await expect(useAppStore.getState().deleteProvider('openrouter')).rejects.toThrow(
    'Provider 正被 2 个配置引用',
  );
});

test('loading the doctor stores the reports and the update availability', async () => {
  responder = () => ({ status: 200, body: doctorResponse() });

  await useAppStore.getState().loadDoctor();

  expect(requests[0]?.path).toBe('/api/doctor');
  expect(useAppStore.getState().doctor).toHaveLength(1);
  expect(useAppStore.getState().doctor?.[0]?.harness).toBe('claude');
  expect(useAppStore.getState().doctorUpdatedAvailable).toBe(true);
});

test('loading drift stores one report per harness', async () => {
  responder = () => ({ status: 200, body: driftResponse() });

  await useAppStore.getState().loadDrift();

  expect(requests[0]?.path).toBe('/api/drift');
  expect(useAppStore.getState().drift).toHaveLength(1);
  expect(useAppStore.getState().drift?.[0]?.harness).toBe('claude');
});

test('reapplying drift posts to the harness and reloads the view', async () => {
  responder = (path) =>
    path === '/api/drift/claude/reapply'
      ? { status: 200, body: { ok: true, files: [] } }
      : { status: 200, body: driftResponse() };
  useAppStore.setState({ harnesses: [{ id: 'claude', label: 'Claude Code' }] } as Partial<
    ReturnType<typeof useAppStore.getState>
  > as never);

  const files = await useAppStore.getState().reapplyDrift('claude');

  expect(requests[0]?.path).toBe('/api/drift/claude/reapply');
  expect(files).toEqual([]);
  expect(useAppStore.getState().notice).toEqual([
    { key: 'drift.reapplied', params: { harness: 'Claude Code' } },
  ]);
});

test('adopting the live files reloads the harness list and drift', async () => {
  responder = (path) =>
    path === '/api/drift/claude/adopt'
      ? {
          status: 200,
          body: {
            ok: true,
            summary: { harness: 'claude', status: 'in-sync', active: true, files: [] },
          },
        }
      : path === '/api/harnesses'
        ? { status: 200, body: harnessResponse() }
        : { status: 200, body: driftResponse() };
  useAppStore.setState({ harnesses: [{ id: 'claude', label: 'Claude Code' }] } as Partial<
    ReturnType<typeof useAppStore.getState>
  > as never);

  const result = await useAppStore.getState().adoptDrift('claude');

  expect(requests[0]?.path).toBe('/api/drift/claude/adopt');
  expect(result.summary.harness).toBe('claude');
  expect(useAppStore.getState().notice).toEqual([
    { key: 'drift.adopted', params: { harness: 'Claude Code' } },
  ]);
  expect(requests.some((request) => request.path === '/api/harnesses')).toBe(true);
});
