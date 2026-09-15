import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { InstantiationService } from '../src/di';
import { compareVersions, IUpdateService } from '../src/services/update';
import { IVersionService } from '../src/services/version';
import {
  createSandbox,
  createTestApp,
  createTestServices,
  OFFLINE,
  respondJson,
  type Sandbox,
} from './support';

let sandbox: Sandbox;
let services: InstantiationService;

beforeEach(() => {
  sandbox = createSandbox('hsw-update', { env: (home) => ({ CODEX_HOME: home('.codex') }) });
  services = createTestServices();
});

afterEach(() => {
  sandbox.dispose();
});

/** A fresh container per call, so one test's cached registry answer cannot reach another. */
const checkForUpdate = (force = false) => createTestServices().get(IUpdateService).check(force);
const serverVersion = () => services.get(IVersionService).version();

describe('compareVersions', () => {
  test('orders plain releases numerically, not lexically', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('v2.0.0', '1.99.99')).toBe(1);
  });

  test('a pre-release is older than its release and never compares as NaN', () => {
    expect(compareVersions('1.2.0-beta.1', '1.2.0')).toBe(-1);
    expect(compareVersions('1.2.0', '1.2.0-rc.1')).toBe(1);
    // The old numeric split turned `0-beta` into NaN, which compared as "not newer" both ways.
    expect(compareVersions('1.2.0-beta.1', '1.1.9')).toBe(1);
    expect(compareVersions('1.1.9', '1.2.0-beta.1')).toBe(-1);
  });

  test('orders pre-release identifiers the way semver does', () => {
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1);
    expect(compareVersions('1.0.0-alpha.2', '1.0.0-alpha.10')).toBe(-1);
    expect(compareVersions('1.0.0-alpha.1', '1.0.0-beta')).toBe(-1);
    expect(compareVersions('1.0.0-beta.11', '1.0.0-rc.1')).toBe(-1);
    expect(compareVersions('1.0.0-rc.1', '1.0.0-rc.1')).toBe(0);
  });

  test('ignores build metadata', () => {
    expect(compareVersions('1.0.0+build.5', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.0-beta+exp', '1.0.0-beta')).toBe(0);
  });
});

describe('UpdateService.check', () => {
  test('reports an update when the registry has a newer version', async () => {
    sandbox.stubFetch(respondJson({ version: '99.0.1' }));
    const result = await checkForUpdate(true);
    expect(result.latest).toBe('99.0.1');
    expect(result.updateAvailable).toBe(true);
  });

  test('reports no update when running the latest version', async () => {
    sandbox.stubFetch(respondJson({ version: await serverVersion() }));
    const result = await checkForUpdate(true);
    expect(result.updateAvailable).toBe(false);
  });

  test('degrades to no update when the registry is unreachable', async () => {
    sandbox.stubFetch(OFFLINE);
    const result = await checkForUpdate(true);
    expect(result.latest).toBeNull();
    expect(result.updateAvailable).toBe(false);
  });

  test('skips the registry entirely when update checks are disabled', async () => {
    sandbox.setEnv('HSW_UPDATE_CHECK', '0');
    let fetched = false;
    sandbox.stubFetch(() => {
      fetched = true;
      throw new Error('fetch should not run');
    });

    const result = await checkForUpdate(true);

    expect(result).toEqual({
      current: await serverVersion(),
      latest: null,
      updateAvailable: false,
    });
    expect(fetched).toBe(false);
  });
});

describe('update api', () => {
  test('requires authentication', async () => {
    const { app } = await createTestApp();
    expect((await app.request('/api/update/check')).status).toBe(401);
    expect((await app.request('/api/update', { method: 'POST' })).status).toBe(401);
  });

  test('reports current and latest for an authenticated session', async () => {
    const context = await createTestApp();
    sandbox.stubFetch(respondJson({ version: '99.0.1' }));
    expect(await context.json('/api/update/check?force=1')).toMatchObject({
      current: await serverVersion(),
      latest: '99.0.1',
      updateAvailable: true,
    });
  });

  test('starts the update for an authenticated session', async () => {
    // The test hook keeps triggerUpdate from spawning a real `bun x` download.
    sandbox.setEnv('HSW_UPDATE_SPAWN', '0');
    const context = await createTestApp();
    const response = await context.post('/api/update');
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: 'updating' });
  });
});
