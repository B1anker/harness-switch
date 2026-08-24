import { spawnSync } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import {
  DOCTOR_CODES,
  type DoctorCheck,
  type DoctorReport,
  type DoctorResponse,
  HARNESS_LABELS,
  type HarnessId,
  type MessageParams,
  PROBE_CODES,
} from '@seaveyon/harness-switch-shared';
import { createDecorator, inject } from '../di';
import { checkForUpdate } from '../update';
import { IActivationService } from './activation';
import { IAdapterRegistry } from './adapters';
import { assertParsable } from './adapters/serialize';
import { IDriftService } from './drift';
import { IEnvironmentService } from './environment';
import { IFileService } from './files';
import { IProbeService } from './probe';
import { IProfileService } from './profiles';
import { IHarnessRegistry } from './registry';

export type DoctorOptions = {
  /** Run the connectivity probe against each harness's active profile. */
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
  IProfileService,
  IProbeService,
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
    private readonly profiles: IProfileService,
    private readonly probe: IProbeService,
  ) {}

  async run(options: DoctorOptions = {}): Promise<DoctorResponse> {
    const harnessIds = options.harness
      ? [this.harnesses.require(options.harness)]
      : this.harnesses.list().map((item) => item.id);

    // Probes run concurrently: five endpoints answered serially would turn a single
    // slow relay into a visibly stalled report.
    const items: DoctorReport[] = await Promise.all(
      harnessIds.map(async (harness) => ({
        harness,
        checks: await this.harnessChecks(harness, options.probe === true),
      })),
    );

    // The registry check is cached and degrades to "no update" when unreachable.
    const update = await checkForUpdate();
    return { items, updatedAvailable: update.updateAvailable };
  }

  private async harnessChecks(harness: HarnessId, probe: boolean): Promise<DoctorCheck[]> {
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
      const mode = this.modeOf(path);
      if (mode === undefined) {
        // The file vanished between the checks above and this one.
        checks.push(
          warn(
            `${harness}.files.${target.key}`,
            `${target.label} 不存在（${path}）`,
            DOCTOR_CODES.fileMissing,
            fileParams,
          ),
        );
      } else if ((mode & 0o077) !== 0) {
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

    // Parse: live content must be parseable back. A file the manager cannot read at all
    // is reported as its own check — doctor describes files it does not own, so one
    // unreadable config must not throw away every other finding in the report.
    for (const target of targets) {
      const read = this.files.readForReport(target.path);
      if (!read.ok) {
        checks.push(
          error(
            `${harness}.parse.${target.key}`,
            `${target.label} 无法读取：${read.reason}`,
            DOCTOR_CODES.parseUnreadable,
            { target: target.label, reason: read.reason },
            { code: read.code ?? null },
          ),
        );
        continue;
      }
      const content = read.content;
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

    // Connectivity probe: a real request against the active profile's base URL with
    // its stored credential. A failure here means the tool would fail too, so it
    // reports as an error rather than a warning.
    if (probe) {
      checks.push(await this.probeCheck(harness));
    }

    return checks;
  }

  private async probeCheck(harness: HarnessId): Promise<DoctorCheck> {
    const active = this.activation.getActive(harness);
    if (!active) {
      return unknown(
        `${harness}.probe`,
        '未激活任何配置，跳过连通性探测',
        DOCTOR_CODES.probeNoProfile,
        undefined,
        { probed: false },
      );
    }
    // Official-login mode points at the tool's own service, not a profile-owned
    // endpoint; there is nothing of ours to probe, and no stored credential either.
    if (active.official === true) {
      return unknown(
        `${harness}.probe`,
        `${HARNESS_LABELS[harness]} 处于官方账号登录状态，无自定义端点可探测`,
        DOCTOR_CODES.probeOfficialLogin,
        undefined,
        { probed: false },
      );
    }
    const decrypted = this.profiles.decrypt(harness, active.name);
    if (!decrypted.baseUrl || !decrypted.apiKey) {
      return warn(
        `${harness}.probe`,
        `配置 ${active.name} 缺少 Base URL 或 API Key，无法探测`,
        DOCTOR_CODES.probeMissingCredential,
        { profile: active.name },
        { probed: false, baseUrl: decrypted.baseUrl || null },
      );
    }
    const result = await this.probe.probe(decrypted);
    const detail = {
      probed: true,
      baseUrl: result.requestUrl ?? decrypted.baseUrl,
      status: result.status ?? null,
      latencyMs: result.latencyMs ?? null,
      modelCount: result.models?.length ?? null,
      reason: result.code ?? null,
    };
    if (result.ok) {
      return ok(
        `${harness}.probe`,
        `端点可达（${result.latencyMs ?? '?'}ms，${result.models?.length ?? 0} 个模型）`,
        DOCTOR_CODES.probeOk,
        { profile: active.name },
        detail,
      );
    }
    return error(
      `${harness}.probe`,
      `连通性探测失败：${result.message ?? '未知原因'}`,
      DOCTOR_CODES.probeFailed,
      { profile: active.name, reason: result.code ?? PROBE_CODES.networkError },
      detail,
    );
  }

  private commandExists(bin: string): boolean {
    try {
      // Pass the environment explicitly so runtime PATH overrides remain visible.
      const result = spawnSync('/bin/sh', ['-c', `command -v ${bin}`], {
        env: process.env,
        encoding: 'utf8',
      });
      return result.status === 0 && result.stdout.trim().length > 0;
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

  /** Undefined when the file cannot be stat'd, so a race cannot abort the whole report. */
  private modeOf(path: string): number | undefined {
    try {
      return statSync(path).mode & 0o777;
    } catch {
      return undefined;
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
