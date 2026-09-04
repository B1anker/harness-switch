import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { createApp } from '../src/app';
import { parseArgs } from '../src/cli/args';
import { runCli } from '../src/cli/commands';
import type { InstantiationService } from '../src/di';
import { IAuthService } from '../src/services/auth';
import { IProfileService } from '../src/services/profiles';
import { IVaultService } from '../src/services/vault';
import { createSandbox, createTestServices, loopbackOnly, type Sandbox } from './support';

let sandbox: Sandbox;
let services: InstantiationService;
let server: ReturnType<typeof Bun.serve>;
let baseUrl = '';

beforeEach(() => {
  sandbox = createSandbox('hsw-cli', {
    env: (home) => ({ CODEX_HOME: home('.codex'), HSW_UPDATE_CHECK: '0', PORT: undefined }),
  });
  services = createTestServices();
  // The CLI logs in with the same password file the daemon would have written.
  services.get(IAuthService).ensurePassword();

  server = Bun.serve({ port: 0, fetch: createApp(services).fetch });
  baseUrl = `http://127.0.0.1:${server.port}`;
  sandbox.setEnv('HSW_URL', baseUrl);

  // The doctor update check must never hit the real network, but the CLI itself talks to
  // the local test server over fetch, so only non-loopback requests are refused.
  sandbox.stubFetch(loopbackOnly());
});

afterEach(() => {
  server.stop();
  sandbox.dispose();
});

async function run(command: string, argv: string[]): Promise<{ code: number; logs: string[] }> {
  const logs: string[] = [];
  const original = console.log;
  console.log = (message?: unknown) => logs.push(String(message));
  try {
    const { flags, positional } = parseArgs(argv);
    const code = await runCli(command, positional, flags);
    return { code, logs };
  } finally {
    console.log = original;
  }
}

function createClaudeProfile(name = 'main', apiKey = 'sk-test') {
  services.get(IProfileService).upsert(
    'claude',
    {
      name,
      baseUrl: 'https://api.example.com/v1',
      apiKey,
      model: 'claude-sonnet-4-5',
    },
    true,
  );
}

describe('cli', () => {
  test('argument parser supports documented value flags, aliases and --', () => {
    expect(
      parseArgs([
        '--name',
        'main',
        '--api-key=secret',
        '--base-url',
        'https://example.com',
        '-j',
        '--',
        '--literal',
      ]),
    ).toEqual({
      flags: {
        name: 'main',
        'api-key': 'secret',
        'base-url': 'https://example.com',
        json: true,
      },
      positional: ['--literal'],
    });
    expect(() => parseArgs(['--name'])).toThrow('需要一个值');
  });

  test('commands reject misspelled options and extra arguments', async () => {
    const typo = await run('list', ['--jsno', '--json']);
    expect(typo.code).toBe(1);
    expect(JSON.parse(typo.logs.join('\n')).error.message).toContain('--jsno');

    const extra = await run('profiles', ['claude', 'extra', '--json']);
    expect(extra.code).toBe(1);
    expect(JSON.parse(extra.logs.join('\n')).error.message).toContain('用法');
  });

  test('list --json mirrors the harnesses API response shape', async () => {
    const { code, logs } = await run('list', ['--json']);
    expect(code).toBe(0);
    const payload = JSON.parse(logs.join('\n')) as {
      envFile: string;
      items: Array<{ id: string; profiles: unknown[] }>;
    };
    expect(typeof payload.envFile).toBe('string');
    expect(payload.items.map((item) => item.id)).toEqual(['claude', 'codex', 'kimi', 'pi', 'dsh']);
    expect(JSON.stringify(payload)).not.toContain('apiKey');
  });

  test('each command logs out its temporary API session', async () => {
    const { code } = await run('list', ['--json']);
    expect(code).toBe(0);
    const store = JSON.parse(await Bun.file(sandbox.data('sessions.json')).text()) as {
      sessions: Record<string, unknown>;
    };
    expect(Object.keys(store.sessions)).toHaveLength(0);
  });

  test('json errors preserve the HTTP status and stable server code', async () => {
    const { code, logs } = await run('official', ['pi', '--yes', '--json']);
    expect(code).toBe(1);
    const payload = JSON.parse(logs.join('\n')) as {
      error: { code: string; status: number; message: string };
    };
    expect(payload.error.status).toBe(400);
    expect(payload.error.code).toBe('activation.officialLoginUnsupported');
    expect(payload.error.message.length).toBeGreaterThan(0);
  });

  test('providers --json lists vault entries without secrets', async () => {
    services.get(IVaultService).create({
      name: 'acme',
      apiKey: 'sk-acme',
      endpoints: [{ key: 'default', label: 'Default', baseUrl: 'https://api.acme.example/v1' }],
    });
    const { code, logs } = await run('providers', ['--json']);
    expect(code).toBe(0);
    const payload = JSON.parse(logs.join('\n')) as {
      items: Array<{ id: string; apiKeyConfigured: boolean }>;
    };
    const acme = payload.items.find((item) => item.id === 'acme');
    expect(acme?.apiKeyConfigured).toBe(true);
    expect(JSON.stringify(payload)).not.toContain('sk-acme');
  });

  test('create and profiles support safe credentials from the environment', async () => {
    sandbox.setEnv('HSW_TEST_API_KEY', 'sk-from-env');
    const created = await run('create', [
      'claude',
      'automation',
      '--base-url',
      'https://api.example.com/v1',
      '--model',
      'claude-sonnet-4-5',
      '--api-key-env',
      'HSW_TEST_API_KEY',
      '--json',
    ]);
    expect(created.code).toBe(0);
    expect(JSON.parse(created.logs.join('\n')).name).toBe('automation');

    const listed = await run('profiles', ['claude', '--json']);
    const payload = JSON.parse(listed.logs.join('\n')) as { items: Array<{ name: string }> };
    expect(payload.items.map((item) => item.name)).toEqual(['automation']);
    expect(JSON.stringify(payload)).not.toContain('sk-from-env');
  });

  test('delete --yes removes an inactive profile', async () => {
    createClaudeProfile('temporary');
    const removed = await run('delete', ['claude', 'temporary', '--yes', '--json']);
    expect(removed.code).toBe(0);
    expect(services.get(IProfileService).get('claude', 'temporary')).toBeUndefined();
  });

  test('plan <harness> <profile> --json returns the exact content activation would write', async () => {
    createClaudeProfile();
    const { code, logs } = await run('plan', ['claude', 'main', '--json']);
    expect(code).toBe(0);
    const payload = JSON.parse(logs.join('\n')) as {
      harness: string;
      profile: string;
      targets: Array<{ content: string; currentContent: string | null }>;
    };
    expect(payload.harness).toBe('claude');
    expect(payload.targets[0]?.content).toContain('sk-test');
    expect(payload.targets[0]?.currentContent).toBeNull();
  });

  test('activate --yes --json writes the live file', async () => {
    createClaudeProfile();
    const { code, logs } = await run('activate', ['claude', 'main', '--yes', '--json']);
    expect(code).toBe(0);
    const payload = JSON.parse(logs.join('\n')) as { harness: string; warnings: string[] };
    expect(payload.harness).toBe('claude');
    expect(payload.warnings).toEqual([]);
    const settings = JSON.parse(
      await Bun.file(sandbox.home('.claude', 'settings.json')).text(),
    ) as { env: Record<string, string> };
    expect(settings.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-test');
  });

  test('activate without --yes is refused on a non-interactive terminal', async () => {
    createClaudeProfile();
    const { code, logs } = await run('activate', ['claude', 'main', '--json']);
    expect(code).toBe(1);
    const payload = JSON.parse(logs.join('\n')) as { error: { code: number; message: string } };
    expect(payload.error.code).toBe(1);
    expect(payload.error.message).toContain('--yes');
  });

  test('doctor --json returns a stable report shape', async () => {
    const { code, logs } = await run('doctor', ['--json']);
    expect(code).toBe(0);
    const payload = JSON.parse(logs.join('\n')) as {
      updatedAvailable: boolean;
      items: Array<{ harness: string; checks: Array<{ id: string; status: string }> }>;
    };
    expect(payload.updatedAvailable).toBe(false);
    expect(payload.items.map((item) => item.harness)).toEqual([
      'claude',
      'codex',
      'kimi',
      'pi',
      'dsh',
    ]);
    expect(payload.items[0]?.checks.length).toBeGreaterThan(0);
    expect(payload.items[0]?.checks[0]?.status).toBeOneOf(['ok', 'warn', 'error', 'unknown']);
  });

  test('unknown commands exit non-zero', async () => {
    const { code } = await run('bogus', ['--json']);
    expect(code).toBe(1);
  });

  test('the bundled entry dispatches new commands', async () => {
    // Async spawn: a synchronous spawn would block this process's event loop and
    // starve the in-process server the child talks to.
    const child = Bun.spawn({
      cmd: [process.execPath, 'src/main.ts', 'list', '--json'],
      cwd: join(import.meta.dir, '..'),
      env: {
        ...process.env,
        HSW_URL: baseUrl,
        HSW_DATA_DIR: sandbox.dataDir,
        HSW_HOME_DIR: sandbox.homeDir,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stdout = await new Response(child.stdout).text();
    const exitCode = await child.exited;
    expect(exitCode).toBe(0);
    const payload = JSON.parse(stdout) as { items: unknown[] };
    expect(Array.isArray(payload.items)).toBe(true);
  });
});
