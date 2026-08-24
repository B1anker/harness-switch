import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import type {
  ActivateResponse,
  DoctorResponse,
  HarnessesResponse,
  OperationsResponse,
  OperationUndoResponse,
  PreviewResponse,
  ProfilePublic,
  ProvidersResponse,
  ScanImportResponse,
  ScanResponse,
  UserSyncResponse,
  UsersResponse,
} from '@seaveyon/harness-switch-shared';
import {
  CliError,
  type CliFlags,
  flagValue,
  hasFlag,
  requirePositional,
  validateFlags,
  validatePositionals,
} from './args';
import { CliClient, readWebPassword, resolveBaseUrl } from './client';
import {
  cliUsage,
  OutputMode,
  printActivateHuman,
  printDoctorHuman,
  printJson,
  printListHuman,
  printOperationsHuman,
  printPlanHuman,
  printProfilesHuman,
  printProvidersHuman,
  printScanHuman,
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
  try {
    validateCommand(command, positional, flags);
  } catch (error) {
    return fail(error, json);
  }

  let client: CliClient;
  try {
    client = new CliClient(resolveBaseUrl(), readWebPassword());
    await client.login();
  } catch (error) {
    return fail(error, json);
  }

  try {
    const selectedUser = flagValue(flags, 'user');
    if (selectedUser) {
      await selectUser(client, selectedUser);
    }
    switch (command) {
      case 'list':
        return await cmdList(client, json);
      case 'profiles':
        return await cmdProfiles(client, positional, json);
      case 'create':
        return await cmdCreate(client, positional, flags, json);
      case 'delete':
        return await cmdDelete(client, positional, flags, json);
      case 'providers':
        return await cmdProviders(client, json);
      case 'doctor':
        return await cmdDoctor(client, flags, json);
      case 'plan':
        return await cmdPlan(client, positional, json);
      case 'activate':
        return await cmdActivate(client, positional, flags, json);
      case 'official':
        return await cmdOfficial(client, positional, flags, json);
      case 'users':
        return await cmdUsers(client, json);
      case 'sync':
        return await cmdSync(client, flags, json);
      case 'scan':
        return await cmdScan(client, json);
      case 'import':
        return await cmdImport(client, positional, flags, json);
      case 'operations':
        return await cmdOperations(client, json);
      case 'undo':
        return await cmdUndo(client, positional, json);
      default:
        console.error(cliUsage());
        throw new CliError(`unknown command: ${command}`);
    }
  } catch (error) {
    return fail(error, json);
  } finally {
    await client.logout().catch(() => undefined);
  }
}

function validateCommand(command: string, positional: string[], flags: CliFlags): void {
  const specs: Record<string, { flags?: string[]; min: number; max: number; usage: string }> = {
    list: { min: 0, max: 0, usage: 'list [options]' },
    profiles: { min: 0, max: 1, usage: 'profiles [harness] [options]' },
    create: {
      flags: ['base-url', 'model', 'notes', 'api-key', 'api-key-env', 'provider', 'endpoint'],
      min: 2,
      max: 2,
      usage: 'create <harness> <name> [options]',
    },
    delete: { flags: ['yes'], min: 2, max: 2, usage: 'delete <harness> <profile> [--yes]' },
    providers: { min: 0, max: 0, usage: 'providers [options]' },
    doctor: {
      flags: ['probe', 'harness', 'strict'],
      min: 0,
      max: 0,
      usage: 'doctor [--probe] [--harness H] [--strict]',
    },
    plan: { min: 2, max: 2, usage: 'plan <harness> <profile> [options]' },
    activate: {
      flags: ['yes'],
      min: 2,
      max: 2,
      usage: 'activate <harness> <profile> [--yes]',
    },
    official: { flags: ['yes'], min: 1, max: 1, usage: 'official <harness> [--yes]' },
    users: { min: 0, max: 0, usage: 'users [options]' },
    sync: {
      flags: ['from', 'to', 'overwrite', 'copy-codex-auth'],
      min: 0,
      max: 0,
      usage: 'sync --from USER --to USER [options]',
    },
    scan: { min: 0, max: 0, usage: 'scan [options]' },
    import: {
      flags: ['vault', 'name', 'api-key', 'api-key-env', 'overwrite'],
      min: 1,
      max: Number.POSITIVE_INFINITY,
      usage: 'import <id>... [options]',
    },
    operations: { min: 0, max: 0, usage: 'operations [options]' },
    undo: { min: 1, max: 1, usage: 'undo <operation-id> [options]' },
  };
  const spec = specs[command];
  if (!spec) return;
  validateFlags(flags, spec.flags ?? []);
  validatePositionals(positional, spec.min, spec.max, spec.usage);
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
      // An unmanageable account is listed but annotated: `--user` on it would be
      // refused, so the reason is more useful than a bare name.
      const note = user.manageable === false ? `  (${user.blockReason ?? '不可切换'})` : '';
      console.log(`${user.current ? '*' : ' '} ${user.username.padEnd(20)} ${user.homeDir}${note}`);
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
  const copyCodexAuth = hasFlag(flags, 'copy-codex-auth');
  const payload = (await client.post('/api/users/sync', {
    sourceUser: source,
    conflictPolicy,
    migrateCodexLoginCache: copyCodexAuth,
  })) as UserSyncResponse;
  if (json === 'json') {
    printJson(payload);
  } else {
    console.log(`已从 ${source} 同步到 ${target}`);
    console.log(
      `新增=${payload.imported} 覆盖=${payload.overwritten} 跳过=${payload.skipped} 凭据=${payload.providersCopied} Codex登录缓存=${payload.codexLoginCacheMigrated ? '已迁移' : '未迁移'}`,
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

async function cmdProfiles(
  client: CliClient,
  positional: string[],
  json: OutputMode,
): Promise<number> {
  const harness = positional[0];
  const payload = (await client.get(
    harness ? `/api/harnesses/${encodeURIComponent(harness)}` : '/api/harnesses',
  )) as HarnessesResponse | HarnessesResponse['items'][number];
  const items =
    'items' in payload ? payload.items.flatMap((item) => item.profiles) : payload.profiles;
  if (json === 'json') printJson({ items });
  else printProfilesHuman(items);
  return 0;
}

async function cmdCreate(
  client: CliClient,
  positional: string[],
  flags: CliFlags,
  json: OutputMode,
): Promise<number> {
  const harness = requirePositional(positional, 0, 'harness');
  const name = requirePositional(positional, 1, 'name');
  const apiKey = credentialFromFlags(flags);
  const payload = (await client.post(`/api/harnesses/${encodeURIComponent(harness)}/profiles`, {
    name,
    baseUrl: flagValue(flags, 'base-url'),
    model: flagValue(flags, 'model'),
    notes: flagValue(flags, 'notes'),
    ...(apiKey ? { apiKey } : {}),
    ...(flagValue(flags, 'provider') ? { providerId: flagValue(flags, 'provider') } : {}),
    ...(flagValue(flags, 'endpoint') ? { providerEndpoint: flagValue(flags, 'endpoint') } : {}),
  })) as ProfilePublic;
  if (json === 'json') printJson(payload);
  else console.log(`已创建 ${payload.harness}/${payload.name}`);
  return 0;
}

async function cmdDelete(
  client: CliClient,
  positional: string[],
  flags: CliFlags,
  json: OutputMode,
): Promise<number> {
  const harness = requirePositional(positional, 0, 'harness');
  const profile = requirePositional(positional, 1, 'profile');
  if (!(await confirmMutation(`确认删除 ${harness}/${profile}？[y/N] `, flags, json))) return 0;
  const payload = await client.delete(
    `/api/harnesses/${encodeURIComponent(harness)}/profiles/${encodeURIComponent(profile)}`,
  );
  if (json === 'json') printJson({ harness, profile, ...(payload as object) });
  else console.log(`已删除 ${harness}/${profile}`);
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
  return hasFlag(flags, 'strict') &&
    payload.items.some((item) => item.checks.some((check) => check.status === 'error'))
    ? 1
    : 0;
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
    const preview = (await client.get(
      `/api/harnesses/${encodeURIComponent(harness)}/profiles/${encodeURIComponent(profile)}/preview`,
    )) as PreviewResponse;
    if (json === 'human') {
      printPlanHuman(harness, profile, preview.targets);
    }
    if (!(await confirmMutation(`确认激活 ${harness}/${profile}？[y/N] `, flags, json))) return 0;
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

async function cmdOfficial(
  client: CliClient,
  positional: string[],
  flags: CliFlags,
  json: OutputMode,
): Promise<number> {
  const harness = requirePositional(positional, 0, 'harness');
  if (!(await confirmMutation(`确认让 ${harness} 恢复官方登录？[y/N] `, flags, json))) return 0;
  const payload = (await client.post(
    `/api/harnesses/${encodeURIComponent(harness)}/official/activate`,
  )) as ActivateResponse;
  if (json === 'json') printJson({ harness, official: true, ...payload });
  else printActivateHuman(harness, 'official', payload);
  return 0;
}

async function cmdScan(client: CliClient, json: OutputMode): Promise<number> {
  const payload = (await client.get('/api/scan')) as ScanResponse;
  if (json === 'json') {
    printJson(payload);
  } else {
    printScanHuman(payload.items);
  }
  return 0;
}

async function cmdImport(
  client: CliClient,
  positional: string[],
  flags: CliFlags,
  json: OutputMode,
): Promise<number> {
  if (positional.length === 0) {
    throw new CliError('import 需要至少一个候选 id，可先运行 harness-switch scan 查看');
  }
  const target = hasFlag(flags, 'vault') ? 'vault' : 'profile';
  const name = flagValue(flags, 'name');
  if (name && positional.length > 1) {
    throw new CliError('--name 只能用于单条导入');
  }
  const apiKey = credentialFromFlags(flags);
  const overwrite = hasFlag(flags, 'overwrite');
  const selections = positional.map((id) => ({
    id,
    // The provider id in the tool's own file is already the most recognisable name.
    name: name || id.split(':').slice(1).join(':') || id,
    target,
    ...(apiKey ? { apiKey } : {}),
    ...(overwrite ? { overwrite: true } : {}),
  }));

  const payload = (await client.post('/api/scan/import', { selections })) as ScanImportResponse;
  if (json === 'json') {
    printJson(payload);
  } else {
    console.log(
      `导入=${payload.imported} 跳过=${payload.skipped} 新建Vault条目=${payload.providersCreated}`,
    );
    for (const warning of payload.warnings) {
      console.log(`warning: ${warning.message}`);
    }
    console.log('工具本身的配置文件未被修改；需要生效请再执行 activate。');
  }
  return payload.skipped > 0 && payload.imported === 0 ? 1 : 0;
}

function credentialFromFlags(flags: CliFlags): string {
  const inline = flagValue(flags, 'api-key');
  const envName = flagValue(flags, 'api-key-env');
  if (inline && envName) throw new CliError('--api-key 与 --api-key-env 不能同时使用');
  if (!envName) return inline;
  const value = process.env[envName];
  if (!value) throw new CliError(`环境变量 ${envName} 未设置或为空`);
  return value;
}

async function confirmMutation(
  prompt: string,
  flags: CliFlags,
  json: OutputMode,
): Promise<boolean> {
  if (hasFlag(flags, 'yes')) return true;
  if (!stdin.isTTY) throw new CliError('非交互式终端需要 --yes 确认此操作');
  const readline = createInterface({ input: stdin, output: stdout });
  const answer = (await readline.question(prompt)).trim().toLowerCase();
  readline.close();
  if (answer === 'y' || answer === 'yes') return true;
  if (json === 'json') printJson({ cancelled: true });
  else console.log('已取消');
  return false;
}

async function cmdOperations(client: CliClient, json: OutputMode): Promise<number> {
  const payload = (await client.get('/api/operations')) as OperationsResponse;
  if (json === 'json') {
    printJson(payload);
  } else {
    printOperationsHuman(payload.items);
  }
  return 0;
}

async function cmdUndo(client: CliClient, positional: string[], json: OutputMode): Promise<number> {
  const id = requirePositional(positional, 0, 'operation-id');
  const payload = (await client.post(
    `/api/operations/${encodeURIComponent(id)}/undo`,
  )) as OperationUndoResponse;
  if (json === 'json') {
    printJson(payload);
  } else {
    const { receipt } = payload;
    console.log(`已撤销 ${receipt.kind} ${receipt.harness}/${receipt.profile}`);
  }
  return 0;
}

function fail(error: unknown, json: OutputMode): number {
  const message = error instanceof Error ? error.message : String(error);
  if (json === 'json') {
    const cliError = error instanceof CliError ? error : undefined;
    printJson({
      error: {
        code: cliError?.code ?? 1,
        message,
        ...(cliError?.status ? { status: cliError.status } : {}),
        ...(cliError?.params ? { params: cliError.params } : {}),
      },
    });
  } else {
    console.error(`error: ${message}`);
  }
  return 1;
}
