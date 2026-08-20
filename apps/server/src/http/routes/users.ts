import type { UserSyncRequest, UsersResponse } from '@seaveyon/harness-switch-shared';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { HttpError } from '../../common/errors';
import type { InstantiationService } from '../../di';
import { IAuthService } from '../../services/auth';
import { IEnvironmentService } from '../../services/environment';
import { IUserSyncService } from '../../services/user-sync';
import { IUserService } from '../../services/users';

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
    const body = await readBody(c.req.json.bind(c.req));
    return c.json(sync.preview(String(body.sourceUser ?? '')));
  });

  app.post('/sync', async (c) => {
    const body = await readBody(c.req.json.bind(c.req));
    return c.json(
      sync.sync(
        String(body.sourceUser ?? ''),
        body.conflictPolicy ?? 'skip',
        body.migrateCodexLoginCache === true,
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

async function readBody(read: () => Promise<UserSyncRequest>): Promise<UserSyncRequest> {
  return read().catch(() => {
    throw new HttpError(400, 'invalid json');
  });
}
