import type {
  ConfigFormat,
  DriftAdoptResponse,
  DriftFileState,
  DriftReapplyResponse,
  DriftStatus,
  DriftSummary,
  HarnessId,
  PreviewTarget,
} from '@seaveyon/harness-switch-shared';
import { parse as parseTomlText } from 'smol-toml';
import { parseDocument } from 'yaml';
import { HttpError } from '../common/errors';
import { createDecorator, inject } from '../di';
import { IActivationService } from './activation';
import type { AdapterTarget, CurrentFiles } from './adapters';
import { IAdapterRegistry } from './adapters';
import { assertParsable } from './adapters/serialize';
import { IFileService } from './files';
import { ILiveWriteService } from './live-write';
import { IProfileService } from './profiles';
import { IHarnessRegistry } from './registry';

export interface IDriftService {
  readonly _serviceBrand: undefined;
  /** Compares the active profile's rendering against the live files of one harness. */
  inspect(harness: HarnessId): DriftSummary;
  inspectAll(): DriftSummary[];
  /** Rewrites the live files from the active profile (backup + rollback included). */
  reapply(harness: HarnessId): DriftReapplyResponse;
  /** Reads the live files back into the profile record, then re-inspects. */
  adopt(harness: HarnessId): DriftAdoptResponse;
}

export const IDriftService = createDecorator<IDriftService>('driftService');

const SEVERITY: Record<DriftStatus, number> = {
  unknown: 0,
  'in-sync': 1,
  drifted: 2,
  missing: 3,
  invalid: 4,
};

@inject(
  IActivationService,
  IAdapterRegistry,
  IProfileService,
  IFileService,
  ILiveWriteService,
  IHarnessRegistry,
)
export class DriftService implements IDriftService {
  declare readonly _serviceBrand: undefined;

  constructor(
    private readonly activation: IActivationService,
    private readonly adapters: IAdapterRegistry,
    private readonly profiles: IProfileService,
    private readonly files: IFileService,
    private readonly liveWrite: ILiveWriteService,
    private readonly harnesses: IHarnessRegistry,
  ) {}

  inspectAll(): DriftSummary[] {
    return this.harnesses.list().map((item) => this.inspect(item.id));
  }

  inspect(harness: HarnessId): DriftSummary {
    const active = this.activation.getActive(harness);
    if (!active) {
      return { harness, status: 'unknown', active: false, files: [] };
    }
    const files = active.official === true ? this.officialFiles(harness) : this.namedFiles(harness);
    return { harness, status: this.overall(files), active: true, files };
  }

  reapply(harness: HarnessId): DriftReapplyResponse {
    const active = this.activation.getActive(harness);
    if (!active) {
      throw new HttpError(400, '该工具未激活任何配置，无可重应用的内容');
    }
    const writes = this.activation.expectedWrites(harness);
    this.liveWrite.apply(harness, active.official === true ? '官方登录' : active.name, writes);
    return { ok: true, files: this.inspect(harness).files };
  }

  adopt(harness: HarnessId): DriftAdoptResponse {
    const active = this.activation.getActive(harness);
    if (!active) {
      throw new HttpError(400, '该工具未激活任何配置，无可采纳的内容');
    }
    if (active.official === true) {
      throw new HttpError(400, '官方登录模式下没有可采纳的配置');
    }
    const adapter = this.adapters.get(harness);
    if (!adapter.backfill) {
      throw new HttpError(400, '该工具不支持从 live 文件回读配置');
    }
    const profile = this.profiles.decrypt(harness, active.name);
    if (Object.keys(profile.overrides).length > 0) {
      throw new HttpError(
        409,
        '存在手动 override 的文件，自动采纳会丢弃你的手工配置；请先恢复为自动生成再采纳',
      );
    }

    const targets = adapter.targets();
    const current = this.readCurrent(targets);
    // Fail closed: never adopt from files the tool itself could not parse back.
    for (const target of targets) {
      const content = current[target.key];
      if (content !== undefined) {
        assertParsable(target.format, target.path, content);
      }
    }

    const values = adapter.backfill(profile, current);
    this.profiles.applyBackfill(harness, active.name, values);
    return { ok: true, summary: this.inspect(harness), warnings: [] };
  }

  /**
   * A named active profile: expected content comes from the same preview the
   * activation dialog shows (overrides included), compared against the live file.
   */
  private namedFiles(harness: HarnessId): DriftFileState[] {
    const targets = this.adapters.get(harness).targets();
    let preview: PreviewTarget[];
    try {
      preview = this.activation.preview(harness, this.activation.getActive(harness)!.name);
    } catch {
      // A corrupt live file can make the renderer itself throw before a comparison is
      // possible; report every target as invalid instead of crashing the view.
      return targets.map((target) => ({
        key: target.key,
        label: target.label,
        path: target.path,
        format: target.format,
        expectedContent: null,
        currentContent: this.files.readOptional(target.path) ?? null,
        status: 'invalid',
      }));
    }
    return preview.map((target) =>
      this.classify(
        { key: target.key, label: target.label, path: target.path, format: target.format },
        target.content,
        target.currentContent ?? null,
      ),
    );
  }

  /**
   * Official login has no expected rendering, so only the live file's parseability is
   * checked: parseable files are in-sync, text files cannot be verified (unknown),
   * broken ones are invalid and absent ones are missing.
   */
  private officialFiles(harness: HarnessId): DriftFileState[] {
    const targets = this.adapters.get(harness).targets();
    return targets.map((target) => {
      const live = this.files.readOptional(target.path) ?? null;
      const base = {
        key: target.key,
        label: target.label,
        path: target.path,
        format: target.format,
        expectedContent: null,
        currentContent: live,
      };
      if (live === null) {
        return { ...base, status: 'missing' as const };
      }
      if (target.format === 'text') {
        return { ...base, status: 'unknown' as const };
      }
      try {
        parseValue(target.format, live);
        return { ...base, status: 'in-sync' as const };
      } catch {
        return { ...base, status: 'invalid' as const };
      }
    });
  }

  private classify(target: AdapterTarget, expected: string, live: string | null): DriftFileState {
    const base = {
      key: target.key,
      label: target.label,
      path: target.path,
      format: target.format,
      expectedContent: expected,
      currentContent: live,
    };
    if (live === null) {
      return { ...base, status: 'missing' };
    }
    try {
      const equal = semanticEqual(target.format, expected, live);
      return { ...base, status: equal ? 'in-sync' : 'drifted' };
    } catch {
      return { ...base, status: 'invalid' };
    }
  }

  private overall(files: DriftFileState[]): DriftStatus {
    let worst: DriftStatus = files.length === 0 ? 'in-sync' : 'unknown';
    for (const file of files) {
      if (SEVERITY[file.status] > SEVERITY[worst]) {
        worst = file.status;
      }
    }
    return worst;
  }

  private readCurrent(targets: AdapterTarget[]): CurrentFiles {
    const current: CurrentFiles = {};
    for (const target of targets) {
      current[target.key] = this.files.readOptional(target.path);
    }
    return current;
  }
}

/**
 * Compares two documents by parsed value rather than by bytes, so a re-render that
 * only reorders keys or changes an int to a float does not count as drift. Throws
 * when either document cannot be parsed.
 */
export function semanticEqual(format: ConfigFormat, expected: string, live: string): boolean {
  if (format === 'text') {
    return expected === live;
  }
  return deepEqual(parseValue(format, expected), parseValue(format, live));
}

function parseValue(format: ConfigFormat, text: string): unknown {
  if (!text?.trim()) {
    return {};
  }
  if (format === 'json') {
    return JSON.parse(text) as unknown;
  }
  if (format === 'toml') {
    return parseTomlText(text) as unknown;
  }
  if (format === 'yaml') {
    const document = parseDocument(text);
    if (document.errors.length > 0) {
      throw document.errors[0];
    }
    return document.toJS() ?? {};
  }
  return text;
}

/** Structural equality: object keys are unordered, array order matters. */
function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (typeof left !== typeof right || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => deepEqual(value, right[index]));
  }
  if (typeof left === 'object' && typeof right === 'object') {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }
    return leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        deepEqual((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]),
    );
  }
  return false;
}
