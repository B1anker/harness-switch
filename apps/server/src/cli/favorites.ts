import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type FavoritePlan,
  HARNESS_IDS,
  type ModelFavorite,
} from '@seaveyon/harness-switch-shared';
import { z } from 'zod';
import { daemonDataDir } from '../daemon';
import { CliError, type CliFlags, flagValue, hasFlag } from './args';
import type { CliClient } from './client';
import { printJson } from './output';

const sessionSchema = z.object({ cookie: z.string().min(1), expiresAt: z.string() });
const planIdSchema = z.uuid();
const cacheDir = () => join(daemonDataDir(), 'favorite-cli-plans');

export async function runFavoriteCli(
  client: CliClient,
  positional: string[],
  flags: CliFlags,
): Promise<boolean> {
  const [action, id, name] = positional;
  if (action === 'capture') {
    const harness = z.enum(HARNESS_IDS).parse(id);
    if (!name) {
      throw new CliError('favorite capture <harness> <profile> --name NAME');
    }
    const source = (await client.get(
      `/api/model-favorites/source/${harness}/${encodeURIComponent(name)}`,
    )) as { data: { sourceFingerprint: string } };
    printJson(
      await client.post('/api/model-favorites/from-profile', {
        harness,
        name,
        favoriteName: flagValue(flags, 'name') || name,
        ...source.data,
        extractCredential: hasFlag(flags, 'extract-credential'),
        linkSource: hasFlag(flags, 'link-source'),
      }),
    );
    return false;
  }
  if (action === 'plan') {
    const favoriteId = planIdSchema.parse(id);
    const list = (await client.get('/api/model-favorites')) as { data: ModelFavorite[] };
    const favorite = list.data.find((item) => item.id === favoriteId);
    if (!favorite) {
      throw new CliError('favoriteNotFound');
    }
    const result = (await client.post('/api/model-favorite-plans', {
      favoriteId,
      expectedRevision: favorite.revision,
      items: [
        {
          harness: flagValue(flags, 'harness'),
          connectionId: flagValue(flags, 'connection'),
          profile: flagValue(flags, 'profile'),
          existing: hasFlag(flags, 'existing'),
          mode: hasFlag(flags, 'activate') ? 'activate' : 'save',
          ignorePreference: hasFlag(flags, 'ignore-preference'),
          overwriteDiverged: hasFlag(flags, 'overwrite-diverged'),
          allowAuthOverwrite: hasFlag(flags, 'overwrite-login-cache'),
        },
      ],
    })) as { data: FavoritePlan };
    mkdirSync(cacheDir(), { recursive: true, mode: 0o700 });
    writeFileSync(
      join(cacheDir(), `${result.data.id}.json`),
      JSON.stringify({ cookie: client.session(), expiresAt: result.data.expiresAt }),
      { mode: 0o600, flag: 'wx' },
    );
    printJson(result);
    return true;
  }
  if (action === 'apply') {
    const planId = planIdSchema.parse(id);
    if (!hasFlag(flags, 'yes')) {
      throw new CliError('favorite apply <plan-id> --request-id UUID --yes');
    }
    const requestId = planIdSchema.parse(flagValue(flags, 'request-id'));
    const cached = join(cacheDir(), `${planId}.json`);
    if (existsSync(cached)) {
      const session = sessionSchema.parse(JSON.parse(readFileSync(cached, 'utf8')));
      await client.logout();
      client.useSession(session.cookie);
    }
    const result = await client.post(`/api/model-favorite-plans/${planId}/apply`, { requestId });
    printJson(result);
    rmSync(cached, { force: true });
    return false;
  }
  throw new CliError('favorite capture|plan|apply');
}
