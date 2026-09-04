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
  type ProbeCompletion,
} from '@seaveyon/harness-switch-shared';
import { createDecorator, inject } from '../di';
import { IActivationService } from './activation';
import { IAdapterRegistry } from './adapters';
import { assertParsable } from './adapters/serialize';
import { IDriftService } from './drift';
import { IEnvironmentService } from './environment';
import { IFileService } from './files';
import { IProbeProfileService } from './probe-profile';
import { IProfileService } from './profiles';
import { IHarnessRegistry } from './registry';
import { IUpdateService } from './update';

export type DoctorOptions = {
  /** Run the connectivity probe against each harness's active profile. */
  probe?: boolean;
  /**
   * Also send one minimal completion during the probe, which is the only proof the
   * active model really answers. Costs a token per harness, so it is opt-in even
   * when `probe` is on — and a cached outcome is replayed when one is still valid.
   *
   * Implies `probe`: a completion is only ever sent as part of one, so asking for it
   * alone turns the probe on rather than silently doing nothing.
   */
  completion?: boolean;
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
  IProbeProfileService,
  IUpdateService,
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
    private readonly profileProbe: IProbeProfileService,
    private readonly updates: IUpdateService,
  ) {}

  async run(options: DoctorOptions = {}): Promise<DoctorResponse> {
    const harnessIds = options.harness
      ? [this.harnesses.require(options.harness)]
      : this.harnesses.list().map((item) => item.id);

    const completion = options.completion === true;

    // Probes run concurrently: five endpoints answered serially would turn a single
    // slow relay into a visibly stalled report.
    const items: DoctorReport[] = await Promise.all(
      harnessIds.map(async (harness) => ({
        harness,
        checks: await this.harnessChecks(harness, completion || options.probe === true, completion),
      })),
    );

    // The registry check is cached and degrades to "no update" when unreachable.
    const update = await this.updates.check();
    return { items, updatedAvailable: update.updateAvailable };
  }

  private async harnessChecks(
    harness: HarnessId,
    probe: boolean,
    completion: boolean,
  ): Promise<DoctorCheck[]> {
    const checks: DoctorCheck[] = [];

    // Installation: PATH CLIs must be findable; web-service harnesses skip this.
    const bin = BIN_NAMES[harness];
    if (bin === undefined) {
      const label = HARNESS_LABELS[harness];
      checks.push(ok(`${harness}.install`, DOCTOR_CODES.installNotRequired, { harness: label }));
    } else {
      checks.push(
        this.commandExists(bin)
          ? ok(`${harness}.install`, DOCTOR_CODES.installFound, { bin })
          : error(`${harness}.install`, DOCTOR_CODES.installMissing, { bin }),
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
        checks.push(warn(`${harness}.files.${target.key}`, DOCTOR_CODES.fileMissing, fileParams));
        continue;
      }
      if (!this.isReadable(path)) {
        checks.push(
          error(`${harness}.files.${target.key}`, DOCTOR_CODES.fileUnreadable, fileParams),
        );
        continue;
      }
      if (!this.isWritable(path)) {
        checks.push(
          warn(`${harness}.files.${target.key}`, DOCTOR_CODES.fileUnwritable, fileParams),
        );
        continue;
      }
      // A config file holds credentials; group/other readability is a warning.
      const mode = this.modeOf(path);
      if (mode === undefined) {
        // The file vanished between the checks above and this one.
        checks.push(warn(`${harness}.files.${target.key}`, DOCTOR_CODES.fileMissing, fileParams));
      } else if ((mode & 0o077) !== 0) {
        checks.push(
          warn(
            `${harness}.files.${target.key}`,
            DOCTOR_CODES.filePermissive,
            { ...fileParams, mode: octal(mode) },
            { mode },
          ),
        );
      } else {
        checks.push(ok(`${harness}.files.${target.key}`, DOCTOR_CODES.fileOk, fileParams));
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
          ok(`${harness}.parse.${target.key}`, DOCTOR_CODES.parseOk, {
            target: target.label,
          }),
        );
      } catch (err) {
        checks.push(
          error(`${harness}.parse.${target.key}`, DOCTOR_CODES.parseFailed, {
            target: target.label,
            reason: (err as Error).message,
          }),
        );
      }
    }

    // Drift: does the live state match what the active profile would render?
    const summary = this.drift.inspect(harness);
    if (!summary.active) {
      checks.push(ok(`${harness}.drift`, DOCTOR_CODES.driftNoProfile));
    } else if (summary.status === 'invalid') {
      checks.push(error(`${harness}.drift`, DOCTOR_CODES.driftInvalid));
    } else if (summary.status === 'drifted' || summary.status === 'missing') {
      const affected = summary.files.filter((file) => file.status !== 'in-sync').length;
      checks.push(
        warn(`${harness}.drift`, DOCTOR_CODES.driftMismatch, {
          count: affected,
          status: summary.status,
        }),
      );
    } else {
      checks.push(ok(`${harness}.drift`, DOCTOR_CODES.driftInSync));
    }

    // Connectivity probe: a real request against the active profile's base URL with
    // its stored credential. A failure here means the tool would fail too, so it
    // reports as an error rather than a warning. With `completion` it also sends one
    // minimal completion, which adds a second check of its own.
    if (probe) {
      checks.push(...(await this.probeChecks(harness, completion)));
    }

    return checks;
  }

  /**
   * The catalog verdict and the completion verdict are separate checks because they fail
   * separately: a relay that lists the model and then 5xx on it reports probe ok and
   * completion error, which is exactly the state a single check would hide.
   */
  private async probeChecks(harness: HarnessId, completion: boolean): Promise<DoctorCheck[]> {
    const active = this.activation.getActive(harness);
    if (!active) {
      return [
        unknown(`${harness}.probe`, DOCTOR_CODES.probeNoProfile, undefined, { probed: false }),
      ];
    }
    // Official-login mode points at the tool's own service, not a profile-owned
    // endpoint; there is nothing of ours to probe, and no stored credential either.
    if (active.official === true) {
      return [
        unknown(`${harness}.probe`, DOCTOR_CODES.probeOfficialLogin, undefined, { probed: false }),
      ];
    }
    const decrypted = this.profiles.decrypt(harness, active.name);
    if (!decrypted.baseUrl || !decrypted.apiKey) {
      return [
        warn(
          `${harness}.probe`,
          DOCTOR_CODES.probeMissingCredential,
          { profile: active.name },
          { probed: false, baseUrl: decrypted.baseUrl || null },
        ),
      ];
    }
    const result = await this.profileProbe.probe(harness, decrypted, { completion });
    const detail = {
      probed: true,
      baseUrl: result.requestUrl ?? decrypted.baseUrl,
      status: result.status ?? null,
      latencyMs: result.latencyMs ?? null,
      modelCount: result.models?.length ?? null,
      reason: result.code ?? null,
    };
    const catalog = result.ok
      ? ok(`${harness}.probe`, DOCTOR_CODES.probeOk, { profile: active.name }, detail)
      : error(
          `${harness}.probe`,
          DOCTOR_CODES.probeFailed,
          { profile: active.name, reason: result.code ?? PROBE_CODES.networkError },
          detail,
        );
    return result.completion
      ? [catalog, completionCheck(harness, active.name, result.completion)]
      : [catalog];
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
 * `code` and `data` carry the fact in translatable form; `detail` keeps the
 * machine-readable extras (raw mode bits, probe state) that callers inspect.
 */
function makeCheck(
  id: string,
  status: DoctorCheck['status'],
  code: string,
  data?: MessageParams,
  detail?: unknown,
): DoctorCheck {
  return { id, status, code, data, detail };
}

function ok(id: string, code: string, data?: MessageParams, detail?: unknown): DoctorCheck {
  return makeCheck(id, 'ok', code, data, detail);
}

function warn(id: string, code: string, data?: MessageParams, detail?: unknown): DoctorCheck {
  return makeCheck(id, 'warn', code, data, detail);
}

function error(id: string, code: string, data?: MessageParams, detail?: unknown): DoctorCheck {
  return makeCheck(id, 'error', code, data, detail);
}

function unknown(id: string, code: string, data?: MessageParams, detail?: unknown): DoctorCheck {
  return makeCheck(id, 'unknown', code, data, detail);
}

/**
 * The completion verdict as its own check. A cached outcome says so in its prose and in
 * `detail.cachedAt`, because "the model answered" and "the model answered four hours ago"
 * are different claims and a diagnostic must not blur them.
 */
function completionCheck(
  harness: HarnessId,
  profile: string,
  completion: ProbeCompletion,
): DoctorCheck {
  const detail = {
    model: completion.model ?? null,
    protocol: completion.protocol ?? null,
    status: completion.status ?? null,
    latencyMs: completion.latencyMs ?? null,
    produced: completion.produced ?? null,
    cachedAt: completion.cachedAt ?? null,
    reason: completion.code ?? null,
  };
  const model = completion.model ?? '?';
  const cached = completion.cachedAt !== undefined;
  return completion.ok
    ? ok(
        `${harness}.completion`,
        cached ? DOCTOR_CODES.completionOkCached : DOCTOR_CODES.completionOk,
        { profile, model, latencyMs: completion.latencyMs ?? 0 },
        detail,
      )
    : error(
        `${harness}.completion`,
        cached ? DOCTOR_CODES.completionFailedCached : DOCTOR_CODES.completionFailed,
        { profile, model, reason: completion.code ?? PROBE_CODES.networkError },
        detail,
      );
}

function octal(mode: number): string {
  return mode.toString(8).padStart(4, '0');
}
