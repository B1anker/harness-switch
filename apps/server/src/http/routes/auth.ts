import {
  changePasswordRequestSchema,
  ERROR_CODES,
  loginRequestSchema,
} from '@seaveyon/harness-switch-shared';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { HttpError } from '../../common/errors';
import type { InstantiationService } from '../../di';
import { AUDIT_EVENTS, IAuditService } from '../../services/audit';
import { IAuthService, MIN_PASSWORD_LENGTH } from '../../services/auth';
import { IEnvironmentService } from '../../services/environment';
import { readJsonBody } from '../validate';

export function createAuthRoutes(services: InstantiationService): Hono {
  const app = new Hono();
  const auth = services.get(IAuthService);
  const environment = services.get(IEnvironmentService);
  const audit = services.get(IAuditService);

  /**
   * `secure` is set whenever the request itself arrived over TLS.
   *
   * Hard-coding it would break the documented loopback and SSH-tunnel setups, where the
   * browser talks plain HTTP to 127.0.0.1 and would silently drop a `secure` cookie. Any
   * deployment that does terminate TLS gets the flag without configuration.
   */
  const issueCookie = (c: Context, token: string): void => {
    setCookie(c, environment.cookieName, token, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      secure: isSecureRequest(c.req.url, c.req.header('x-forwarded-proto')),
      maxAge: environment.sessionTtlMs / 1000,
    });
  };

  app.post('/login', async (c) => {
    const body = await readJsonBody(c, loginRequestSchema);
    const locked = auth.lockout();
    if (locked) {
      audit.record(AUDIT_EVENTS.loginLocked, { retryAfterSeconds: locked.retryAfterSeconds });
      throw new HttpError(429, 'too many attempts', {
        code: ERROR_CODES.tooManyAttempts,
        params: { seconds: locked.retryAfterSeconds },
      });
    }
    const token = auth.login(body.password);
    if (!token) {
      // A wrong guess that also tripped the limiter is reported as the lockout, so the
      // caller learns to wait rather than retrying immediately into a 429.
      const tripped = auth.lockout();
      audit.record(AUDIT_EVENTS.loginFailed);
      if (tripped) {
        throw new HttpError(429, 'too many attempts', {
          code: ERROR_CODES.tooManyAttempts,
          params: { seconds: tripped.retryAfterSeconds },
        });
      }
      throw new HttpError(401, 'invalid password', { code: ERROR_CODES.invalidPassword });
    }
    issueCookie(c, token);
    audit.record(AUDIT_EVENTS.loginSucceeded);
    return c.json({ authenticated: true, currentUser: environment.defaultUser.username });
  });

  app.post('/logout', (c) => {
    auth.logout(getCookie(c, environment.cookieName));
    deleteCookie(c, environment.cookieName, { path: '/' });
    audit.record(AUDIT_EVENTS.logout);
    return c.json({ ok: true });
  });

  app.get('/session', (c) => {
    const token = getCookie(c, environment.cookieName);
    if (!auth.isAuthenticated(token)) {
      throw new HttpError(401, 'authentication required', {
        code: ERROR_CODES.authenticationRequired,
      });
    }
    return c.json({ authenticated: true, currentUser: auth.userForToken(token)! });
  });

  /**
   * Rotates the shared web password.
   *
   * Guarded by the caller's own session *and* their current password: this route is
   * mounted ahead of the session guard like the rest of `/auth`, so it checks the session
   * itself rather than inheriting it.
   */
  app.post('/password', async (c) => {
    const token = getCookie(c, environment.cookieName);
    if (!auth.isAuthenticated(token)) {
      throw new HttpError(401, 'authentication required', {
        code: ERROR_CODES.authenticationRequired,
      });
    }
    const body = await readJsonBody(c, changePasswordRequestSchema);
    if (body.newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new HttpError(400, 'password too short', {
        code: ERROR_CODES.passwordTooShort,
        params: { count: MIN_PASSWORD_LENGTH },
      });
    }
    if (body.newPassword === body.currentPassword) {
      throw new HttpError(400, 'password unchanged', { code: ERROR_CODES.passwordUnchanged });
    }
    if (!auth.changePassword(body.currentPassword, body.newPassword, token)) {
      audit.record(AUDIT_EVENTS.passwordChangeRejected);
      throw new HttpError(403, 'current password rejected', {
        code: ERROR_CODES.passwordChangeRejected,
      });
    }
    audit.record(AUDIT_EVENTS.passwordChanged);
    // The rotation kept this session alive but re-issues the cookie so its TTL restarts
    // from the change rather than from the original login.
    issueCookie(c, token!);
    return c.json({ ok: true });
  });

  return app;
}

/** True when the browser's own hop was HTTPS, directly or through a trusted proxy. */
function isSecureRequest(url: string, forwardedProto: string | undefined): boolean {
  if (forwardedProto) {
    return forwardedProto.split(',')[0]!.trim().toLowerCase() === 'https';
  }
  return url.startsWith('https://');
}
