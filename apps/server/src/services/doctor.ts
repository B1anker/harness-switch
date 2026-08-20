import { accessSync, constants, statSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  DoctorCheck,
  DoctorReport,
  DoctorResponse,
  HarnessId,
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

const BIN_NAMES: Record<HarnessId, string> = {
  claude: 'claude',
  codex: 'codex',
  kimi: 'kimi',
  pi: 'pi',
  dsh: 'dsh',
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

    // Installation: the tool's own CLI must exist on PATH.
    const bin = BIN_NAMES[harness];
    checks.push(
      this.commandExists(bin)
        ? ok(`${harness}.install`, `已找到可执行文件 ${bin}`)
        : error(`${harness}.install`, `未找到可执行文件 ${bin}（PATH 中不存在），工具可能未安装`),
    );

    const targets = this.adapters.get(harness).targets();

    // Config dir: every target's directory must exist so files can be written.
    for (const target of targets) {
      const dir = dirname(target.path);
      const present = this.files.exists(dir);
      checks.push(
        present
          ? ok(`${harness}.configDir.${target.key}`, `${target.label} 所在目录存在（${dir}）`)
          : error(
              `${harness}.configDir.${target.key}`,
              `${target.label} 所在目录不存在（${dir}），无法写入配置`,
            ),
      );
    }

    // Files: existence, readability, writability and secret-file permissions.
    for (const target of targets) {
      const path = target.path;
      const exists = this.files.exists(path);
      if (!exists) {
        checks.push(warn(`${harness}.files.${target.key}`, `${target.label} 不存在（${path}）`));
        continue;
      }
      if (!this.isReadable(path)) {
        checks.push(error(`${harness}.files.${target.key}`, `${target.label} 不可读（${path}）`));
        continue;
      }
      if (!this.isWritable(path)) {
        checks.push(warn(`${harness}.files.${target.key}`, `${target.label} 不可写（${path}）`));
        continue;
      }
      // A config file holds credentials; group/other readability is a warning.
      const mode = statSync(path).mode & 0o777;
      if ((mode & 0o077) !== 0) {
        checks.push(
          warn(
            `${harness}.files.${target.key}`,
            `${target.label} 存在可读写，但权限为 ${octal(mode)}，group/other 可读，建议 0600`,
            { mode },
          ),
        );
      } else {
        checks.push(
          ok(`${harness}.files.${target.key}`, `${target.label} 存在且可读可写（${path}）`),
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
        checks.push(ok(`${harness}.parse.${target.key}`, `${target.label} 解析正常`));
      } catch (err) {
        checks.push(
          error(
            `${harness}.parse.${target.key}`,
            `${target.label} 无法解析：${(err as Error).message}`,
          ),
        );
      }
    }

    // Drift: does the live state match what the active profile would render?
    const summary = this.drift.inspect(harness);
    if (!summary.active) {
      checks.push(ok(`${harness}.drift`, '未激活任何配置，无漂移可检查'));
    } else if (summary.status === 'invalid') {
      checks.push(error(`${harness}.drift`, 'live 文件存在无法解析的内容'));
    } else if (summary.status === 'drifted' || summary.status === 'missing') {
      const affected = summary.files.filter((file) => file.status !== 'in-sync').length;
      checks.push(
        warn(`${harness}.drift`, `${affected} 个文件与激活配置不一致（${summary.status}）`),
      );
    } else {
      checks.push(ok(`${harness}.drift`, 'live 文件与激活配置一致'));
    }

    // Connectivity probe: the MVP never makes a network request; the check only
    // reports the active base URL and explains that probing is disabled.
    if (probe) {
      const active = this.activation.getActive(harness);
      checks.push(
        unknown(`${harness}.probe`, '连通性探测在 MVP 中默认关闭，未发起网络请求', {
          baseUrl: active?.baseUrl ?? null,
          enabled: false,
        }),
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

function makeCheck(
  id: string,
  label: string,
  status: DoctorCheck['status'],
  detail?: unknown,
): DoctorCheck {
  const detailObject =
    detail === undefined
      ? { message: label }
      : { message: label, ...(detail as Record<string, unknown>) };
  return { id, label, status, detail: detailObject };
}

function ok(id: string, message: string, detail?: unknown): DoctorCheck {
  return makeCheck(id, message, 'ok', detail);
}

function warn(id: string, message: string, detail?: unknown): DoctorCheck {
  return makeCheck(id, message, 'warn', detail);
}

function error(id: string, message: string, detail?: unknown): DoctorCheck {
  return makeCheck(id, message, 'error', detail);
}

function unknown(id: string, message: string, detail?: unknown): DoctorCheck {
  return makeCheck(id, message, 'unknown', detail);
}

function octal(mode: number): string {
  return mode.toString(8).padStart(4, '0');
}
