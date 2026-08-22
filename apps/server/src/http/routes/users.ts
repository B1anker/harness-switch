import { type UsersResponse, userSyncRequestSchema } from '@seaveyon/harness-switch-shared';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { HttpError } from '../../common/errors';
import type { InstantiationService } from '../../di';
import { IAuthService } from '../../services/auth';
import { IEnvironmentService } from '../../services/environment';
import { IUserSyncService } from '../../services/user-sync';
import { IUserService } from '../../services/users';
import { readJsonBody } from '../validate';

export function createUserRoutes(services: InstantiationService): Hono {
  const app = new Hono();
  const auth = services.get(IAuthService);
  const environment = services.get(IEnvironmentService);
  const users = services.get(IUserService);
  const sync = services.get(IUserSyncService);

  app.get('/', (c) => {
    const current = environment.currentUser.username;
    return c.json({
      currentUser: current,
      items: users.list().map((user) => ({ ...user, current: user.username === current })),
    } satisfies UsersResponse);
  });

  app.post('/sync/preview', async (c) => {
    const body = await readJsonBody(c, userSyncRequestSchema);
    return c.json(sync.preview(body.sourceUser));
  });

  app.post('/sync', async (c) => {
    const body = await readJsonBody(c, userSyncRequestSchema);
    return c.json(
      sync.sync(
        body.sourceUser,
        body.conflictPolicy ?? 'skip',
        body.migrateCodexLoginCache === true,
        [...new Set(body.overwriteHarnesses ?? [])],
      ),
    );
  });

  app.post('/:username/select', (c) => {
    const user = users.require(decodeURIComponent(c.req.param('username')));
    const token = getCookie(c, environment.cookieName);
    if (!token) throw new HttpError(401, 'authentication required');
    auth.selectUser(token, user.username);
    return c.json({ currentUser: user.username });
  });

  return app;
}
