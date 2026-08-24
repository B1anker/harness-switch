import type {
  DoctorCheck,
  DoctorResponse,
  HarnessesResponse,
  LocalizedMessage,
  OperationReceipt,
  PreviewTarget,
  ProfilePublic,
  ProviderPublic,
  ScanHarnessResult,
} from '@seaveyon/harness-switch-shared';

export type OutputMode = 'human' | 'json';

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

export function printListHuman(payload: HarnessesResponse): void {
  console.log(`env file: ${payload.envFile}`);
  for (const item of payload.items) {
    const active = item.active ? (item.active.official ? '官方登录' : item.active.name) : '-';
    console.log(
      `${item.id.padEnd(8)} ${item.label.padEnd(14)} ${item.mode.padEnd(9)} active=${active} profiles=${item.profiles.length}`,
    );
  }
}

export function printProvidersHuman(items: ProviderPublic[]): void {
  if (items.length === 0) {
    console.log('(no providers)');
    return;
  }
  for (const entry of items) {
    const endpoints = entry.endpoints.map((endpoint) => endpoint.key).join(',') || '-';
    const configured = entry.apiKeyConfigured ? 'key=set' : 'key=missing';
    console.log(
      `${entry.id.padEnd(24)} ${entry.name.padEnd(20)} ${configured.padEnd(9)} endpoints=${endpoints}`,
    );
  }
}

export function printProfilesHuman(items: ProfilePublic[]): void {
  if (items.length === 0) {
    console.log('(no profiles)');
    return;
  }
  for (const profile of items) {
    const provider = profile.providerId ? `vault=${profile.providerId}` : 'key=inline';
    console.log(
      `${profile.harness.padEnd(8)} ${profile.name.padEnd(20)} ${profile.model || '-'}  ${provider}`,
    );
  }
}

export function printDoctorHuman(report: DoctorResponse): void {
  console.log(`harness-switch doctor  updateAvailable=${report.updatedAvailable}`);
  for (const item of report.items) {
    console.log('');
    console.log(`${item.harness}:`);
    for (const check of item.checks) {
      printCheck(check);
    }
  }
}

function printCheck(check: DoctorCheck): void {
  const tag =
    check.status === 'ok'
      ? '[ok]'
      : check.status === 'warn'
        ? '[warn]'
        : check.status === 'error'
          ? '[error]'
          : '[unknown]';
  const message = detailMessage(check.detail) ?? check.label;
  console.log(`  ${tag} ${message}`);
}

function detailMessage(detail: unknown): string | undefined {
  if (typeof detail === 'object' && detail !== null) {
    const message = (detail as Record<string, unknown>).message;
    if (typeof message === 'string') {
      return message;
    }
  }
  return undefined;
}

export function printPlanHuman(harness: string, profile: string, targets: PreviewTarget[]): void {
  console.log(`plan ${harness}/${profile}:`);
  for (const target of targets) {
    const changed = target.content !== target.currentContent;
    const marker = target.overridden ? ' (override)' : changed ? ' (将写入)' : ' (无变更)';
    console.log(`- ${target.path}${marker}`);
  }
  console.log('');
  console.log('内容包含 API key，请仅在可信终端查看。');
}

export function printActivateHuman(
  harness: string,
  profile: string,
  result: { envFile: string; warnings: LocalizedMessage[] },
): void {
  console.log(`已激活 ${harness}/${profile}`);
  console.log(`env: ${result.envFile}`);
  for (const warning of result.warnings) {
    // The terminal prints the server's own prose; only the web UI translates codes.
    console.log(`warning: ${warning.message}`);
  }
}

export function printScanHuman(items: ScanHarnessResult[]): void {
  for (const item of items) {
    console.log('');
    console.log(`${item.label} (${item.harness}):`);
    for (const source of item.sources) {
      const state = !source.exists ? '缺失' : source.parsable ? '已读取' : '无法解析';
      console.log(`  · ${source.path} [${state}]`);
    }
    if (item.candidates.length === 0) {
      console.log(`  ${item.note ?? '没有可导入的配置'}`);
      continue;
    }
    for (const candidate of item.candidates) {
      const marks = [
        candidate.active ? '使用中' : '',
        candidate.apiKeyPresent ? `key=${candidate.apiKeyPreview}` : 'key=需手动填写',
        candidate.matchesProvider ? `已在 Vault：${candidate.matchesProvider}` : '',
      ].filter(Boolean);
      console.log(`  [${candidate.id}] ${candidate.suggestedName}  ${marks.join('  ')}`);
      console.log(
        `      ${candidate.baseUrl || '(无 base url)'}  ${candidate.model || ''}`.trimEnd(),
      );
    }
  }
  console.log('');
  console.log('用 harness-switch import <id>... 导入；扫描和导入都不会改动工具本身的配置。');
}

export function printOperationsHuman(items: OperationReceipt[]): void {
  if (items.length === 0) {
    console.log('(no operations)');
    return;
  }
  for (const receipt of items) {
    const undo = receipt.undoable ? '可撤销' : '不可撤销';
    console.log(
      `${receipt.id}  ${receipt.state.padEnd(18)} ${receipt.kind.padEnd(17)} ${receipt.harness}/${receipt.profile}  user=${receipt.user}  ${undo}`,
    );
    if (receipt.note) {
      console.log(`  ${receipt.note}`);
    }
  }
}

export function cliUsage(): string {
  return [
    'usage: harness-switch <command> [options]',
    '',
    'commands:',
    '  list                          list harnesses, active profiles and live targets',
    '  profiles [harness]            list saved profiles without credential material',
    '  create <harness> <name>       create a profile from command-line options',
    '  delete <harness> <profile>    delete an inactive profile (confirmation required)',
    '  providers                     list Provider Vault entries',
    '  doctor [--probe] [--strict]   run diagnostics; probe tests the active endpoint',
    '  plan <harness> <profile>      show the exact content activation would write',
    '  activate <harness> <profile>  activate a profile (add --yes to skip the prompt)',
    '  official <harness>            return a harness to its built-in login',
    '  users                         list manageable local Unix users',
    '  sync --from USER --to USER    copy profiles and credentials between users',
    '  scan                          find configuration the five tools already have',
    '  import <id>... [--vault]      save scanned configuration as profiles',
    '  operations                    list operation receipts, newest first',
    '  undo <operation-id>           revert one complete operation',
    '  version                       print the installed version',
    '  help                          show this help',
    '',
    'options:',
    '  --json, -j    machine-readable JSON output',
    '  --yes, -y     skip confirmation for activate, official and delete',
    "  --probe       test the active profile's endpoint (makes a real request)",
    '  --harness H   limit doctor to one harness',
    '  --strict      make doctor exit 1 when any check has error status',
    '  --user USER   run an API-backed command for this Unix user',
    '  --overwrite   overwrite same-name profiles during sync and import (default: skip)',
    '  --copy-codex-auth  copy the source user’s Codex auth.json during sync',
    '  --vault       import extracts the credential into a Provider Vault entry',
    '  --name NAME   profile name for a single import (default: the provider id)',
    '  --api-key KEY inline credential for create/import (prefer --api-key-env)',
    '  --api-key-env VAR  read a create/import credential from an environment variable',
    '  --base-url URL --model MODEL --notes TEXT  profile fields used by create',
    '  --provider ID [--endpoint KEY]  create a profile backed by Provider Vault',
    '  --help, -h    show help without connecting to the service',
    '  --version, -V print the installed version',
    '',
    'environment:',
    '  HSW_URL       base URL of the local service (default http://127.0.0.1:8787)',
    '  PORT          port override when HSW_URL is unset',
    '  HSW_DATA_DIR  data directory holding web_password (default ~/.harness-switch)',
  ].join('\n');
}
