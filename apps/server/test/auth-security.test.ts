import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import type { AuditResponse } from '@seaveyon/harness-switch-shared';
import { ERROR_CODES } from '@seaveyon/harness-switch-shared';
import { createSandbox, createTestApp, type Sandbox, type TestApp } from './support';

let sandbox: Sandbox;

beforeEach(() => {
  sandbox = createSandbox('hsw-auth');
});

afterEach(() => {
  sandbox.dispose();
});

/** A raw login attempt, so the lockout tests can drive the endpoint without a session. */
async function attemptLogin(context: TestApp, password: string): Promise<Response> {
  return context.app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
}

async function auditEvents(context: TestApp): Promise<string[]> {
  const body = await context.json<AuditResponse>('/api/audit');
  return body.items.map((entry) => entry.event);
}

describe('login brute-force protection', () => {
  test('locks the endpoint after repeated wrong guesses, then reports 429', async () => {
    const context = await createTestApp();

    // The first four wrong guesses spend the budget and stay 401.
    for (let attempt = 0; attempt < 4; attempt++) {
      expect((await attemptLogin(context, 'wrong')).status).toBe(401);
    }

    // The fifth trips the lock, and every attempt after it is refused before the
    // password is even compared.
    const tripped = await attemptLogin(context, 'wrong');
    expect(tripped.status).toBe(429);
    expect(((await tripped.json()) as { code: string }).code).toBe(ERROR_CODES.tooManyAttempts);

    const stillLocked = await attemptLogin(context, 'wrong');
    expect(stillLocked.status).toBe(429);
  });

  test('a correct password during the lockout window is still refused', async () => {
    const context = await createTestApp();
    for (let attempt = 0; attempt < 5; attempt++) {
      await attemptLogin(context, 'wrong');
    }

    // The right password now returns 429, not a session: the lock is checked first.
    const refused = await attemptLogin(context, context.password);
    expect(refused.status).toBe(429);
  });

  test('a correct password before the budget is spent still logs in', async () => {
    const context = await createTestApp();
    await attemptLogin(context, 'wrong');
    await attemptLogin(context, 'wrong');

    const ok = await attemptLogin(context, context.password);
    expect(ok.status).toBe(200);
  });
});

describe('web password change', () => {
  test('rotates the password, keeps the caller signed in, and invalidates other sessions', async () => {
    const context = await createTestApp();
    const other = await createTestApp({ services: context.services });

    const changed = await context.post('/api/auth/password', {
      currentPassword: context.password,
      newPassword: 'a-brand-new-passphrase',
    });
    expect(changed.status).toBe(200);

    // The rotating session survives; the one that predates the change does not.
    expect((await context.get('/api/auth/session')).status).toBe(200);
    expect((await other.get('/api/auth/session')).status).toBe(401);

    // The file on disk holds the new password, not the old.
    const stored = (await readFile(sandbox.data('web_password'), 'utf8')).trim();
    expect(stored).toBe('a-brand-new-passphrase');
  });

  test('rejects a wrong current password without touching the stored one', async () => {
    const context = await createTestApp();
    const response = await context.post('/api/auth/password', {
      currentPassword: 'not-the-password',
      newPassword: 'a-brand-new-passphrase',
    });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe(
      ERROR_CODES.passwordChangeRejected,
    );
    expect((await readFile(sandbox.data('web_password'), 'utf8')).trim()).toBe(context.password);
  });

  test('rejects a new password shorter than the minimum', async () => {
    const context = await createTestApp();
    const response = await context.post('/api/auth/password', {
      currentPassword: context.password,
      newPassword: 'short',
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe(ERROR_CODES.passwordTooShort);
  });

  test('rejects a new password equal to the current one', async () => {
    const context = await createTestApp();
    const response = await context.post('/api/auth/password', {
      currentPassword: context.password,
      newPassword: context.password,
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe(ERROR_CODES.passwordUnchanged);
  });

  test('refuses an anonymous change even with the right current password', async () => {
    const context = await createTestApp();
    const anonymous = await context.app.request('/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: context.password,
        newPassword: 'a-brand-new-passphrase',
      }),
    });
    expect(anonymous.status).toBe(401);
  });
});

describe('audit trail', () => {
  test('records a successful login and the reveal of a credential, newest first', async () => {
    const context = await createTestApp();
    const provider = await context.postJson<{ provider: { id: string } }>('/api/providers', {
      name: 'Example',
      apiKey: 'sk-secret-value',
    });

    await context.get(`/api/providers/${provider.provider.id}/reveal`);

    const events = await auditEvents(context);
    expect(events).toContain('auth.login.succeeded');
    expect(events).toContain('provider.credential.revealed');
    // Newest first: the reveal happened after the login.
    expect(events.indexOf('provider.credential.revealed')).toBeLessThan(
      events.indexOf('auth.login.succeeded'),
    );
  });

  test('records failed logins and never writes the attempted password', async () => {
    const context = await createTestApp();
    await attemptLogin(context, 'sk-guessed-wrong');

    const raw = await readFile(sandbox.data('audit.jsonl'), 'utf8');
    expect(raw).toContain('auth.login.failed');
    expect(raw).not.toContain('sk-guessed-wrong');
  });

  test('never persists a revealed key even if a detail key smuggles it in', async () => {
    const context = await createTestApp();
    const provider = await context.postJson<{ provider: { id: string } }>('/api/providers', {
      name: 'Example',
      apiKey: 'sk-must-not-leak',
    });
    await context.get(`/api/providers/${provider.provider.id}/reveal`);

    const raw = await readFile(sandbox.data('audit.jsonl'), 'utf8');
    expect(raw).not.toContain('sk-must-not-leak');
  });
});
