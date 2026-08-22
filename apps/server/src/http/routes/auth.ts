import { ERROR_CODES, loginRequestSchema } from '@seaveyon/harness-switch-shared';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { HttpError } from '../../common/errors';
import type { InstantiationService } from '../../di';
import { IAuthService } from '../../services/auth';
import { IEnvironmentService } from '../../services/environment';
import { readJsonBody } from '../validate';

export function createAuthRoutes(services: InstantiationService): Hono {
  const app = new Hono();
  const auth = services.get(IAuthService);
  const environment = services.get(IEnvironmentService);

  app.post('/login', async (c) => {
    const body = await readJsonBody(c, loginRequestSchema);
    const token = auth.login(body.password);
    if (!token) {
      throw new HttpError(401, 'invalid password', { code: ERROR_CODES.invalidPassword });
    }
    setCookie(c, environment.cookieName, token, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: environment.sessionTtlMs / 1000,
    });
    return c.json({ authenticated: true, currentUser: environment.defaultUser.username });
  });

  app.post('/logout', (c) => {
    auth.logout(getCookie(c, environment.cookieName));
    deleteCookie(c, environment.cookieName, { path: '/' });
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

  return app;
}
