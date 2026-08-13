import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { HttpError } from '../common/errors';
import type { InstantiationService } from '../di';
import { IAuthService } from '../services/auth';
import { IEnvironmentService } from '../services/environment';

export function createServiceMiddleware(services: InstantiationService): MiddlewareHandler {
  return async (c, next) => {
    c.set('services', services);
    await next();
  };
}

export function createOriginGuard(): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.method !== 'OPTIONS') {
      const origin = c.req.header('origin');
      if (origin) {
        const host = c.req.header('host');
        const allowed = [`http://${host}`, `https://${host}`];
        if (!allowed.includes(origin)) {
          throw new HttpError(403, 'cross-origin request denied');
        }
      }
    }
    await next();
  };
}

export function createAuthGuard(services: InstantiationService): MiddlewareHandler {
  const auth = services.get(IAuthService);
  const environment = services.get(IEnvironmentService);
  return async (c, next) => {
    const token = getCookie(c, environment.cookieName);
    if (!auth.isAuthenticated(token)) {
      throw new HttpError(401, 'authentication required');
    }
    await next();
  };
}
