import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createSandbox, createTestApp, type Sandbox } from './support';

let sandbox: Sandbox;
beforeEach(() => {
  sandbox = createSandbox('hsw-assets', { env: (home) => ({ HSW_PUBLIC_DIR: home('web') }) });
  mkdirSync(sandbox.home('web', 'assets'), { recursive: true });
  writeFileSync(sandbox.home('web', 'index.html'), '<!doctype html><title>App</title>');
  writeFileSync(sandbox.home('web', 'assets', 'diff.js'), 'export const ready = true;');
});
afterEach(() => sandbox.dispose());

test('missing lazy chunks return an uncached 404 instead of SPA HTML', async () => {
  const app = await createTestApp();
  for (const path of ['/assets/missing.js', '/assets/missing.css', '/assets/missing.js.map']) {
    const response = await app.get(path);
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).not.toContain('text/html');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).not.toContain('<!doctype');
  }
});

test('real assets keep their MIME type and client-side routes still receive the SPA', async () => {
  const app = await createTestApp();
  const script = await app.get('/assets/diff.js');
  expect(script.status).toBe(200);
  expect(script.headers.get('content-type')).toContain('text/javascript');
  expect(await script.text()).toBe('export const ready = true;');
  const page = await app.get('/settings');
  expect(page.status).toBe(200);
  expect(page.headers.get('content-type')).toContain('text/html');
  expect(await page.text()).toContain('<!doctype');
});
