import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OperationReceipt, OperationState } from '@seaveyon/harness-switch-shared';
import { createApp } from '../src/app';
import { createServices } from '../src/bootstrap';
import { IAuthService } from '../src/services/auth';
import { IEnvironmentService } from '../src/services/environment';
import { IJournalService } from '../src/services/journal';

let homeDir = '';
let dataDir = '';
let claudeSettings = '';

type Context = {
  app: ReturnType<typeof createApp>;
  cookie: string;
};

async function boot(): Promise<Context> {
  const services = createServices();
  services.get(IEnvironmentService).ensureDataDir();
  const password = services.get(IAuthService).ensurePassword();
  const app = createApp(services);
  const login = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  expect(login.status).toBe(200);
  return { app, cookie: login.headers.get('set-cookie') ?? '' };
}

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), 'hsw-journal-'));
  dataDir = join(homeDir, '.harness-switch');
  process.env.HSW_HOME_DIR = homeDir;
  process.env.HSW_DATA_DIR = dataDir;
  claudeSettings = join(homeDir, '.claude', 'settings.json');
});

afterEach(() => {
  delete process.env.HSW_HOME_DIR;
  delete process.env.HSW_DATA_DIR;
  delete process.env.HSW_JOURNAL_RETAIN;
  rmSync(homeDir, { recursive: true, force: true });
});

async function activateProfile(
  { app, cookie }: Context,
  name: string,
  baseUrl: string,
): Promise<void> {
  const created = await app.request('/api/harnesses/claude/profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ name, baseUrl, apiKey: `sk-${name}` }),
  });
  expect(created.status).toBe(201);
  const activated = await app.request(`/api/harnesses/claude/profiles/${name}/activate`, {
    method: 'POST',
    headers: { Cookie: cookie },
  });
  expect(activated.status).toBe(200);
}

function journalDirs(): string[] {
  return readdirSync(join(dataDir, 'journal')).toSorted();
}

function receiptPath(id: string): string {
  return join(dataDir, 'journal', id, 'receipt.json');
}

function readReceipt(id: string): OperationReceipt {
  return JSON.parse(readFileSync(receiptPath(id), 'utf8')) as OperationReceipt;
}

/** Rewinds a finished record, standing in for a process killed mid-operation. */
function rewind(id: string, state: OperationState): void {
  const receipt = readReceipt(id);
  writeFileSync(
    receiptPath(id),
    JSON.stringify({ ...receipt, state, finishedAt: undefined }, null, 2),
  );
}

function activeName(): string | undefined {
  const active = JSON.parse(readFileSync(join(dataDir, 'active.json'), 'utf8')) as Record<
    string,
    { name?: string }
  >;
  return active.claude?.name;
}

describe('operation journal', () => {
  test('an activation leaves a committed receipt pointing at its backup', async () => {
    const context = await boot();
    await activateProfile(context, 'first', 'https://one.example.com');

    const ids = journalDirs();
    expect(ids).toHaveLength(1);
    const receipt = readReceipt(ids[0]!);
    expect(receipt.state).toBe('committed');
    expect(receipt.kind).toBe('activate');
    expect(receipt.harness).toBe('claude');
    expect(receipt.profile).toBe('first');
    expect(receipt.metadata).toEqual(['active']);
    expect(receipt.files.map((file) => file.key)).toEqual(['settings']);
    expect(receipt.finishedAt).toBeTruthy();
  });

  test('the receipt is listed over the api with its undo still available', async () => {
    const context = await boot();
    await activateProfile(context, 'first', 'https://one.example.com');

    const response = await context.app.request('/api/operations', {
      headers: { Cookie: context.cookie },
    });
    expect(response.status).toBe(200);
    const { items } = (await response.json()) as { items: OperationReceipt[] };
    expect(items).toHaveLength(1);
    expect(items[0]?.undoable).toBe(true);
    expect(items[0]?.user).toBeTruthy();
  });

  test('the receipt list can be filtered by harness', async () => {
    const context = await boot();
    await activateProfile(context, 'first', 'https://one.example.com');

    const response = await context.app.request('/api/operations?harness=claude', {
      headers: { Cookie: context.cookie },
    });
    expect(response.status).toBe(200);
    const { items } = (await response.json()) as { items: OperationReceipt[] };
    expect(items).toHaveLength(1);
    expect(items[0]?.harness).toBe('claude');

    const empty = await context.app.request('/api/operations?harness=codex', {
      headers: { Cookie: context.cookie },
    });
    expect(((await empty.json()) as { items: OperationReceipt[] }).items).toHaveLength(0);
  });

  test('undo puts the live file and the active pointer back together', async () => {
    const context = await boot();
    await activateProfile(context, 'first', 'https://one.example.com');
    await activateProfile(context, 'second', 'https://two.example.com');

    expect(activeName()).toBe('second');
    expect(readFileSync(claudeSettings, 'utf8')).toContain('two.example.com');

    const target = journalDirs().at(-1)!;
    const response = await context.app.request(
      `/api/operations/${encodeURIComponent(target)}/undo`,
      { method: 'POST', headers: { Cookie: context.cookie } },
    );
    expect(response.status).toBe(200);

    // Undoing the switch is not just a file restore: the recorded active profile has to
    // agree with what the live file now says.
    expect(readFileSync(claudeSettings, 'utf8')).toContain('one.example.com');
    expect(activeName()).toBe('first');
    expect(readReceipt(target).state).toBe('rolled-back');
  });

  test('undoing twice is refused rather than replaying a stale snapshot', async () => {
    const context = await boot();
    await activateProfile(context, 'first', 'https://one.example.com');
    await activateProfile(context, 'second', 'https://two.example.com');

    const target = journalDirs().at(-1)!;
    const undo = () =>
      context.app.request(`/api/operations/${encodeURIComponent(target)}/undo`, {
        method: 'POST',
        headers: { Cookie: context.cookie },
      });
    expect((await undo()).status).toBe(200);
    expect((await undo()).status).toBe(409);
  });

  test('a restart rolls back an operation that never got past applying', async () => {
    const context = await boot();
    await activateProfile(context, 'first', 'https://one.example.com');
    await activateProfile(context, 'second', 'https://two.example.com');

    const target = journalDirs().at(-1)!;
    rewind(target, 'applying');

    // Nothing in the process knows about the half-finished switch any more; only the
    // record on disk does.
    const restarted = createServices();
    restarted.get(IEnvironmentService).ensureDataDir();
    restarted.get(IJournalService).recoverAll();

    expect(readFileSync(claudeSettings, 'utf8')).toContain('one.example.com');
    expect(activeName()).toBe('first');
    const receipt = readReceipt(target);
    expect(receipt.state).toBe('rolled-back');
    expect(receipt.note).toContain('自动回滚');
  });

  test('a restart rolls forward an operation that had already committed its metadata', async () => {
    const context = await boot();
    await activateProfile(context, 'first', 'https://one.example.com');
    await activateProfile(context, 'second', 'https://two.example.com');

    const target = journalDirs().at(-1)!;
    rewind(target, 'metadata-committed');

    const restarted = createServices();
    restarted.get(IEnvironmentService).ensureDataDir();
    restarted.get(IJournalService).recoverAll();

    // Everything the operation set out to change already landed, so undoing it here
    // would silently revert a switch the user saw succeed.
    expect(readFileSync(claudeSettings, 'utf8')).toContain('two.example.com');
    expect(activeName()).toBe('second');
    expect(readReceipt(target).state).toBe('committed');
  });

  test('a record whose metadata key is unknown is refused instead of followed', async () => {
    const context = await boot();
    await activateProfile(context, 'first', 'https://one.example.com');
    await activateProfile(context, 'second', 'https://two.example.com');

    const target = journalDirs().at(-1)!;
    const receipt = readReceipt(target);
    writeFileSync(
      receiptPath(target),
      JSON.stringify({ ...receipt, metadata: ['../../etc/passwd'] }, null, 2),
    );

    const response = await context.app.request(
      `/api/operations/${encodeURIComponent(target)}/undo`,
      { method: 'POST', headers: { Cookie: context.cookie } },
    );
    // An unparsable record is not a usable record.
    expect(response.status).toBe(404);
  });

  test('an id that is not a plain directory name is refused', async () => {
    const context = await boot();
    const response = await context.app.request('/api/operations/..%2F..%2Fbackups/undo', {
      method: 'POST',
      headers: { Cookie: context.cookie },
    });
    expect(response.status).toBe(400);
  });

  test('an operation whose backup was rotated away is no longer offered as undoable', async () => {
    process.env.HSW_BACKUP_RETAIN = '1';
    const context = await boot();
    await activateProfile(context, 'first', 'https://one.example.com');
    await activateProfile(context, 'second', 'https://two.example.com');
    delete process.env.HSW_BACKUP_RETAIN;

    const stale = journalDirs()[0]!;
    const response = await context.app.request('/api/operations', {
      headers: { Cookie: context.cookie },
    });
    const { items } = (await response.json()) as { items: OperationReceipt[] };
    expect(items.find((item) => item.id === stale)?.undoable).toBe(false);

    const undo = await context.app.request(`/api/operations/${encodeURIComponent(stale)}/undo`, {
      method: 'POST',
      headers: { Cookie: context.cookie },
    });
    expect(undo.status).toBe(409);
  });

  test('records rotate away instead of growing without bound', async () => {
    process.env.HSW_JOURNAL_RETAIN = '2';
    const context = await boot();
    await activateProfile(context, 'first', 'https://one.example.com');
    await activateProfile(context, 'second', 'https://two.example.com');
    await activateProfile(context, 'third', 'https://three.example.com');

    const ids = journalDirs();
    expect(ids.length).toBeLessThanOrEqual(2);
    // The newest record must survive the rotation its own write triggers.
    expect(existsSync(receiptPath(ids.at(-1)!))).toBe(true);
    expect(readReceipt(ids.at(-1)!).profile).toBe('third');
  });
});
