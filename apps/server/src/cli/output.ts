import type {
  DoctorCheck,
  DoctorResponse,
  HarnessesResponse,
  PreviewTarget,
  ProviderPublic,
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
  result: { envFile: string; warnings: string[] },
): void {
  console.log(`已激活 ${harness}/${profile}`);
  console.log(`env: ${result.envFile}`);
  for (const warning of result.warnings) {
    console.log(`warning: ${warning}`);
  }
}

export function cliUsage(): string {
  return [
    'usage: harness-switch <command> [options]',
    '',
    'commands:',
    '  list                          list harnesses, active profiles and live targets',
    '  providers                     list Provider Vault entries',
    '  doctor [--probe] [--harness H] run diagnostics (add --probe for /models checks)',
    '  plan <harness> <profile>      show the exact content activation would write',
    '  activate <harness> <profile>  activate a profile (add --yes to skip the prompt)',
    '',
    'options:',
    '  --json        machine-readable JSON output',
    '  --yes         skip confirmation for activate',
    '  --probe       run the /models connectivity probe in doctor',
    '  --harness H   limit doctor to one harness',
    '',
    'environment:',
    '  HSW_URL       base URL of the local service (default http://127.0.0.1:8787)',
    '  PORT          port override when HSW_URL is unset',
    '  HSW_DATA_DIR  data directory holding web_password (default ~/.harness-switch)',
  ].join('\n');
}
