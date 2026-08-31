import {
  ERROR_CODES,
  type LocalUserPublic,
  type UsersResponse,
  userSyncRequestSchema,
} from '@seaveyon/harness-switch-shared';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { HttpError } from '../../common/errors';
import type { InstantiationService } from '../../di';
import { IAuthService } from '../../services/auth';
import { IEnvironmentService } from '../../services/environment';
import { IUserAccessService } from '../../services/user-access';
import { IUserSyncService } from '../../services/user-sync';
import { IUserService } from '../../services/users';
import { readJsonBody } from '../validate';

export function createUserRoutes(services: InstantiationService): Hono {
  const app = new Hono();
  const auth = services.get(IAuthService);
  const environment = services.get(IEnvironmentService);
  const users = services.get(IUserService);
  const access = services.get(IUserAccessService);
  const sync = services.get(IUserSyncService);

  app.get('/', (c) => {
    const current = environment.currentUser.username;
    return c.json({
      currentUser: current,
      items: users.list().map((user) => {
        const verdict = access.inspect(user);
        const base: LocalUserPublic = {
          ...user,
          current: user.username === current,
          manageable: verdict.ok,
        };
        return verdict.ok
          ? base
          : {
              ...base,
              blockCode: verdict.code,
              blockParams: verdict.params,
              blockReason: verdict.reason,
            };
      }),
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
    if (!token) {
      throw new HttpError(401, 'authentication required', {
        code: ERROR_CODES.authenticationRequired,
      });
    }
    // Refuse here rather than letting the session pin to an account whose files this
    // process cannot touch: every later request would fail somewhere deep in a write,
    // and the CLI's `--user` gets the same protection for free. The check is deliberately
    // not in `users.require` — the auth guard calls that on every request, so a blocked
    // account would lock an already-pinned session out of even reading this list.
    const verdict = access.inspect(user);
    if (!verdict.ok) {
      throw new HttpError(403, verdict.reason, {
        code: ERROR_CODES.userNotSwitchable,
        params: { username: user.username, ...verdict.params },
      });
    }
    auth.selectUser(token, user.username);
    return c.json({ currentUser: user.username });
  });

  return app;
}
