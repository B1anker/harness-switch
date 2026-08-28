import {
  gitHubDeviceCodeRequestSchema,
  gitHubDevicePollRequestSchema,
  gitHubPullPreviewRequestSchema,
  gitHubPullRequestSchema,
  gitHubPushRequestSchema,
  gitHubTokenAuthRequestSchema,
} from '@seaveyon/harness-switch-shared';
import { Hono } from 'hono';
import type { InstantiationService } from '../../di';
import { IGitHubSyncService } from '../../services/github-sync';
import { readJsonBody } from '../validate';

export function createGitHubRoutes(services: InstantiationService): Hono {
  const app = new Hono();
  const github = services.get(IGitHubSyncService);

  app.get('/status', async (c) => {
    return c.json(await github.getStatus());
  });

  app.post('/device/code', async (c) => {
    const body = await readJsonBody(c, gitHubDeviceCodeRequestSchema);
    return c.json(await github.getDeviceCode(body.clientId));
  });

  app.post('/device/poll', async (c) => {
    const body = await readJsonBody(c, gitHubDevicePollRequestSchema);
    return c.json(await github.pollDeviceCode(body.deviceCode, body.clientId));
  });

  app.post('/token', async (c) => {
    const body = await readJsonBody(c, gitHubTokenAuthRequestSchema);
    return c.json(await github.authenticateWithToken(body.token));
  });

  app.post('/disconnect', (c) => {
    github.disconnect();
    return c.json({ ok: true });
  });

  app.post('/push', async (c) => {
    const body = await readJsonBody(c, gitHubPushRequestSchema);
    return c.json(await github.push(body.passphrase, body.includeCodexLoginCache !== false));
  });

  app.post('/pull/preview', async (c) => {
    const body = await readJsonBody(c, gitHubPullPreviewRequestSchema);
    return c.json(
      await github.pullPreview(
        body.passphrase,
        body.conflictPolicy ?? 'skip',
        body.restoreActive === true,
      ),
    );
  });

  app.post('/pull', async (c) => {
    const body = await readJsonBody(c, gitHubPullRequestSchema);
    return c.json(
      await github.pull(
        body.passphrase,
        body.conflictPolicy ?? 'skip',
        body.restoreActive === true,
        body.migrateCodexLoginCache !== false,
      ),
    );
  });

  return app;
}
