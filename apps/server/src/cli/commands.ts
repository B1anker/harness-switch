import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import type {
  ActivateResponse,
  DoctorResponse,
  HarnessesResponse,
  PreviewResponse,
  ProvidersResponse,
  UserSyncResponse,
  UsersResponse,
} from '@seaveyon/harness-switch-shared';
import { CliError, type CliFlags, flagValue, hasFlag, requirePositional } from './args';
import { CliClient, readWebPassword, resolveBaseUrl } from './client';
import {
  cliUsage,
  OutputMode,
  printActivateHuman,
  printDoctorHuman,
  printJson,
  printListHuman,
  printPlanHuman,
  printProvidersHuman,
} from './output';

/**
 * Runs one CLI command against the local Web API. The command logs in with the
 * stored web password and delegates every operation to the server, so no business
 * logic is duplicated in the CLI. Returns the process exit code.
 */
export async function runCli(
  command: string,
  positional: string[],
  flags: CliFlags,
): Promise<number> {
  const json: OutputMode = hasFlag(flags, 'json') ? 'json' : 'human';

  let client: CliClient;
  try {
    client = new CliClient(resolveBaseUrl(), readWebPassword());
    await client.login();
    const selectedUser = flagValue(flags, 'user');
    if (selectedUser) {
      await selectUser(client, selectedUser);
    }
  } catch (error) {
    return fail(error, json);
  }

  try {
    switch (command) {
      case 'list':
        return await cmdList(client, json);
      case 'providers':
        return await cmdProviders(client, json);
      case 'doctor':
        return await cmdDoctor(client, flags, json);
      case 'plan':
        return await cmdPlan(client, positional, json);
      case 'activate':
        return await cmdActivate(client, positional, flags, json);
      case 'users':
        return await cmdUsers(client, json);
      case 'sync':
        return await cmdSync(client, flags, json);
      default:
        console.error(cliUsage());
        throw new CliError(`unknown command: ${command}`);
    }
  } catch (error) {
    return fail(error, json);
  }
}

async function selectUser(client: CliClient, username: string): Promise<void> {
  await client.post(`/api/users/${encodeURIComponent(username)}/select`);
}

async function cmdUsers(client: CliClient, json: OutputMode): Promise<number> {
  const payload = (await client.get('/api/users')) as UsersResponse;
  if (json === 'json') {
    printJson(payload);
  } else {
    for (const user of payload.items) {
      console.log(`${user.current ? '*' : ' '} ${user.username.padEnd(20)} ${user.homeDir}`);
    }
  }
  return 0;
}

async function cmdSync(client: CliClient, flags: CliFlags, json: OutputMode): Promise<number> {
  const source = flagValue(flags, 'from');
  const target = flagValue(flags, 'to') || flagValue(flags, 'user');
  if (!source || !target) {
    throw new CliError('sync 需要 --from <来源用户> 和 --to <目标用户>');
  }
  await selectUser(client, target);
  const conflictPolicy = hasFlag(flags, 'overwrite') ? 'overwrite' : 'skip';
  const payload = (await client.post('/api/users/sync', {
    sourceUser: source,
    conflictPolicy,
  })) as UserSyncResponse;
  if (json === 'json') {
    printJson(payload);
  } else {
    console.log(`已从 ${source} 同步到 ${target}`);
    console.log(
      `新增=${payload.imported} 覆盖=${payload.overwritten} 跳过=${payload.skipped} 凭据=${payload.providersCopied}`,
    );
  }
  return 0;
}

async function cmdList(client: CliClient, json: OutputMode): Promise<number> {
  const payload = (await client.get('/api/harnesses')) as HarnessesResponse;
  if (json === 'json') {
    printJson(payload);
  } else {
    printListHuman(payload);
  }
  return 0;
}

async function cmdProviders(client: CliClient, json: OutputMode): Promise<number> {
  const payload = (await client.get('/api/providers')) as ProvidersResponse;
  if (json === 'json') {
    printJson(payload);
  } else {
    printProvidersHuman(payload.items);
  }
  return 0;
}

async function cmdDoctor(client: CliClient, flags: CliFlags, json: OutputMode): Promise<number> {
  const query = new URLSearchParams();
  if (hasFlag(flags, 'probe')) {
    query.set('probe', '1');
  }
  const harness = flagValue(flags, 'harness');
  if (harness) {
    query.set('harness', harness);
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  const payload = (await client.get(`/api/doctor${suffix}`)) as DoctorResponse;
  if (json === 'json') {
    printJson(payload);
  } else {
    printDoctorHuman(payload);
  }
  return 0;
}

async function cmdPlan(client: CliClient, positional: string[], json: OutputMode): Promise<number> {
  const harness = requirePositional(positional, 0, 'harness');
  const profile = requirePositional(positional, 1, 'profile');
  const payload = (await client.get(
    `/api/harnesses/${encodeURIComponent(harness)}/profiles/${encodeURIComponent(profile)}/preview`,
  )) as PreviewResponse;
  if (json === 'json') {
    printJson({ harness, profile, ...payload });
  } else {
    printPlanHuman(harness, profile, payload.targets);
  }
  return 0;
}

async function cmdActivate(
  client: CliClient,
  positional: string[],
  flags: CliFlags,
  json: OutputMode,
): Promise<number> {
  const harness = requirePositional(positional, 0, 'harness');
  const profile = requirePositional(positional, 1, 'profile');

  if (!hasFlag(flags, 'yes')) {
    if (!stdin.isTTY) {
      throw new CliError('非交互式终端需要 --yes 确认才能激活');
    }
    const preview = (await client.get(
      `/api/harnesses/${encodeURIComponent(harness)}/profiles/${encodeURIComponent(profile)}/preview`,
    )) as PreviewResponse;
    if (json === 'human') {
      printPlanHuman(harness, profile, preview.targets);
    }
    const readline = createInterface({ input: stdin, output: stdout });
    const answer = (await readline.question(`确认激活 ${harness}/${profile}？[y/N] `))
      .trim()
      .toLowerCase();
    readline.close();
    if (answer !== 'y' && answer !== 'yes') {
      if (json === 'json') {
        printJson({ cancelled: true });
      } else {
        console.log('已取消');
      }
      return 0;
    }
  }

  const payload = (await client.post(
    `/api/harnesses/${encodeURIComponent(harness)}/profiles/${encodeURIComponent(profile)}/activate`,
  )) as ActivateResponse;
  if (json === 'json') {
    printJson({ harness, profile, ...payload });
  } else {
    printActivateHuman(harness, profile, payload);
  }
  return 0;
}

function fail(error: unknown, json: OutputMode): number {
  const message = error instanceof Error ? error.message : String(error);
  if (json === 'json') {
    printJson({ error: { code: 1, message } });
  } else {
    console.error(`error: ${message}`);
  }
  return 1;
}
