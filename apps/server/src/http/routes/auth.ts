import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { HttpError } from '../../common/errors';
import type { InstantiationService } from '../../di';
import { IAuthService } from '../../services/auth';
import { IEnvironmentService } from '../../services/environment';

export function createAuthRoutes(services: InstantiationService): Hono {
  const app = new Hono();
  const auth = services.get(IAuthService);
  const environment = services.get(IEnvironmentService);

  app.post('/login', async (c) => {
    const body: { password?: string } = await c.req.json<{ password?: string }>().catch(() => ({}));
    const token = auth.login(String(body.password ?? ''));
    if (!token) {
      throw new HttpError(401, 'invalid password');
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
      throw new HttpError(401, 'authentication required');
    }
    return c.json({ authenticated: true, currentUser: auth.userForToken(token)! });
  });

  return app;
}
