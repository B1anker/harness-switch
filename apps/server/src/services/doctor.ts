import { accessSync, constants, statSync } from 'node:fs';
import {
  DOCTOR_CODES,
  type DoctorCheck,
  type DoctorReport,
  type DoctorResponse,
  HARNESS_LABELS,
  type HarnessId,
  type MessageParams,
} from '@seaveyon/harness-switch-shared';
import { createDecorator, inject } from '../di';
import { checkForUpdate } from '../update';
import { IActivationService } from './activation';
import { IAdapterRegistry } from './adapters';
import { assertParsable } from './adapters/serialize';
import { IDriftService } from './drift';
import { IEnvironmentService } from './environment';
import { IFileService } from './files';
import { IHarnessRegistry } from './registry';

export type DoctorOptions = {
  /** Run the connectivity probe. The MVP probe never makes a network request. */
  probe?: boolean;
  /** Restrict the report to one harness. */
  harness?: HarnessId;
};

export interface IDoctorService {
  readonly _serviceBrand: undefined;
  run(options?: DoctorOptions): Promise<DoctorResponse>;
}

export const IDoctorService = createDecorator<IDoctorService>('doctorService');

/**
 * PATH CLI names for harnesses that ship as interactive CLIs. Omitted harnesses
 * (currently DeepSeek Harness) are web-service deployments: install is judged by
 * config dirs/files below, not by a global `dsh` on PATH.
 */
const BIN_NAMES: Partial<Record<HarnessId, string>> = {
  claude: 'claude',
  codex: 'codex',
  kimi: 'kimi',
  pi: 'pi',
};

@inject(
  IEnvironmentService,
  IFileService,
  IHarnessRegistry,
  IAdapterRegistry,
  IActivationService,
  IDriftService,
)
export class DoctorService implements IDoctorService {
  declare readonly _serviceBrand: undefined;

  constructor(
    private readonly environment: IEnvironmentService,
    private readonly files: IFileService,
    private readonly harnesses: IHarnessRegistry,
    private readonly adapters: IAdapterRegistry,
    private readonly activation: IActivationService,
    private readonly drift: IDriftService,
  ) {}

  async run(options: DoctorOptions = {}): Promise<DoctorResponse> {
    const harnessIds = options.harness
      ? [this.harnesses.require(options.harness)]
      : this.harnesses.list().map((item) => item.id);

    const items: DoctorReport[] = [];
    for (const harness of harnessIds) {
      items.push({ harness, checks: this.harnessChecks(harness, options.probe === true) });
    }

    // The registry check is cached and degrades to "no update" when unreachable.
    const update = await checkForUpdate();
    return { items, updatedAvailable: update.updateAvailable };
  }

  private harnessChecks(harness: HarnessId, probe: boolean): DoctorCheck[] {
    const checks: DoctorCheck[] = [];

    // Installation: PATH CLIs must be findable; web-service harnesses skip this.
    const bin = BIN_NAMES[harness];
    if (bin === undefined) {
      const label = HARNESS_LABELS[harness];
      checks.push(
        ok(
          `${harness}.install`,
          `${label} 以 Web 服务部署，不要求 PATH 上有 CLI`,
          DOCTOR_CODES.installNotRequired,
          { harness: label },
        ),
      );
    } else {
      checks.push(
        this.commandExists(bin)
          ? ok(`${harness}.install`, `已找到可执行文件 ${bin}`, DOCTOR_CODES.installFound, { bin })
          : error(
              `${harness}.install`,
              `未找到可执行文件 ${bin}（PATH 中不存在），工具可能未安装`,
              DOCTOR_CODES.installMissing,
              { bin },
            ),
      );
    }

    const targets = this.adapters.get(harness).targets();

    // Files: existence, readability, writability and secret-file permissions.
    // Parent directories are not checked separately — writes already ensureDir, and a
    // readable/writable file implies its directory exists.
    for (const target of targets) {
      const path = target.path;
      const exists = this.files.exists(path);
      const fileParams = { target: target.label, path };
      if (!exists) {
        checks.push(
          warn(
            `${harness}.files.${target.key}`,
            `${target.label} 不存在（${path}）`,
            DOCTOR_CODES.fileMissing,
            fileParams,
          ),
        );
        continue;
      }
      if (!this.isReadable(path)) {
        checks.push(
          error(
            `${harness}.files.${target.key}`,
            `${target.label} 不可读（${path}）`,
            DOCTOR_CODES.fileUnreadable,
            fileParams,
          ),
        );
        continue;
      }
      if (!this.isWritable(path)) {
        checks.push(
          warn(
            `${harness}.files.${target.key}`,
            `${target.label} 不可写（${path}）`,
            DOCTOR_CODES.fileUnwritable,
            fileParams,
          ),
        );
        continue;
      }
      // A config file holds credentials; group/other readability is a warning.
      const mode = statSync(path).mode & 0o777;
      if ((mode & 0o077) !== 0) {
        checks.push(
          warn(
            `${harness}.files.${target.key}`,
            `${target.label} 存在可读写，但权限为 ${octal(mode)}，group/other 可读，建议 0600`,
            DOCTOR_CODES.filePermissive,
            { ...fileParams, mode: octal(mode) },
            { mode },
          ),
        );
      } else {
        checks.push(
          ok(
            `${harness}.files.${target.key}`,
            `${target.label} 存在且可读可写（${path}）`,
            DOCTOR_CODES.fileOk,
            fileParams,
          ),
        );
      }
    }

    // Parse: live content must be parseable back.
    for (const target of targets) {
      const content = this.files.readOptional(target.path);
      if (content === undefined) {
        continue;
      }
      try {
        assertParsable(target.format, target.path, content);
        checks.push(
          ok(`${harness}.parse.${target.key}`, `${target.label} 解析正常`, DOCTOR_CODES.parseOk, {
            target: target.label,
          }),
        );
      } catch (err) {
        checks.push(
          error(
            `${harness}.parse.${target.key}`,
            `${target.label} 无法解析：${(err as Error).message}`,
            DOCTOR_CODES.parseFailed,
            { target: target.label, reason: (err as Error).message },
          ),
        );
      }
    }

    // Drift: does the live state match what the active profile would render?
    const summary = this.drift.inspect(harness);
    if (!summary.active) {
      checks.push(
        ok(`${harness}.drift`, '未激活任何配置，无漂移可检查', DOCTOR_CODES.driftNoProfile),
      );
    } else if (summary.status === 'invalid') {
      checks.push(
        error(`${harness}.drift`, 'live 文件存在无法解析的内容', DOCTOR_CODES.driftInvalid),
      );
    } else if (summary.status === 'drifted' || summary.status === 'missing') {
      const affected = summary.files.filter((file) => file.status !== 'in-sync').length;
      checks.push(
        warn(
          `${harness}.drift`,
          `${affected} 个文件与激活配置不一致（${summary.status}）`,
          DOCTOR_CODES.driftMismatch,
          { count: affected, status: summary.status },
        ),
      );
    } else {
      checks.push(ok(`${harness}.drift`, 'live 文件与激活配置一致', DOCTOR_CODES.driftInSync));
    }

    // Connectivity probe: the MVP never makes a network request; the check only
    // reports the active base URL and explains that probing is disabled.
    if (probe) {
      const active = this.activation.getActive(harness);
      checks.push(
        unknown(
          `${harness}.probe`,
          '连通性探测在 MVP 中默认关闭，未发起网络请求',
          DOCTOR_CODES.probeDisabled,
          undefined,
          { baseUrl: active?.baseUrl ?? null, enabled: false },
        ),
      );
    }

    return checks;
  }

  private commandExists(bin: string): boolean {
    try {
      // Pass the environment explicitly: Bun.spawnSync otherwise uses the process
      // startup env, which would ignore runtime PATH overrides in tests.
      const result = Bun.spawnSync(['/bin/sh', '-c', `command -v ${bin}`], {
        env: process.env,
      });
      return result.exitCode === 0 && result.stdout.toString().trim().length > 0;
    } catch {
      return false;
    }
  }

  private isReadable(path: string): boolean {
    try {
      accessSync(path, constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  private isWritable(path: string): boolean {
    try {
      accessSync(path, constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * `label` stays the server's prose so the CLI keeps printing a sentence; `code` and
 * `params` carry the same fact in translatable form for the web UI. `detail` keeps the
 * machine-readable extras (raw mode bits, probe state) that callers inspect.
 */
function makeCheck(
  id: string,
  label: string,
  status: DoctorCheck['status'],
  code: string,
  params?: MessageParams,
  detail?: unknown,
): DoctorCheck {
  const detailObject =
    detail === undefined
      ? { message: label }
      : { message: label, ...(detail as Record<string, unknown>) };
  return { id, label, status, code, params, detail: detailObject };
}

function ok(
  id: string,
  message: string,
  code: string,
  params?: MessageParams,
  detail?: unknown,
): DoctorCheck {
  return makeCheck(id, message, 'ok', code, params, detail);
}

function warn(
  id: string,
  message: string,
  code: string,
  params?: MessageParams,
  detail?: unknown,
): DoctorCheck {
  return makeCheck(id, message, 'warn', code, params, detail);
}

function error(
  id: string,
  message: string,
  code: string,
  params?: MessageParams,
  detail?: unknown,
): DoctorCheck {
  return makeCheck(id, message, 'error', code, params, detail);
}

function unknown(
  id: string,
  message: string,
  code: string,
  params?: MessageParams,
  detail?: unknown,
): DoctorCheck {
  return makeCheck(id, message, 'unknown', code, params, detail);
}

function octal(mode: number): string {
  return mode.toString(8).padStart(4, '0');
}
