import type {
  ActivePublic,
  HarnessId,
  LocalizedMessage,
  PreviewTarget,
} from '@seaveyon/harness-switch-shared';
import { ERROR_CODES, WARNING_CODES } from '@seaveyon/harness-switch-shared';
import { HttpError } from '../common/errors';
import { createDecorator, inject } from '../di';
import type { AdapterProfile, AdapterTarget, CurrentFiles, HarnessAdapter } from './adapters';
import { IAdapterRegistry } from './adapters';
import { IEnvironmentService } from './environment';
import { IFileService } from './files';
import { ILiveWriteService, type PlannedWrite } from './live-write';
import { ILogService } from './log';
import { IProfileService } from './profiles';
import { IHarnessRegistry } from './registry';

type ActiveEntry = {
  name: string;
  base_url: string;
  api_key: string;
  model: string;
  extras?: Record<string, string>;
  official?: boolean;
};

type ActiveStore = Record<string, ActiveEntry>;

export type ActivationResult = {
  envFile: string;
  warnings: LocalizedMessage[];
};

export interface IActivationService {
  readonly _serviceBrand: undefined;
  getActive(harness: HarnessId): ActivePublic | null;
  activate(harness: HarnessId, name: string): ActivationResult;
  activateOfficial(harness: HarnessId): ActivationResult;
  preview(harness: HarnessId, name: string): PreviewTarget[];
  /**
   * The exact writes the current ACTIVE state would produce (named profile or official
   * login), overrides included. Renders only; nothing is written to disk.
   */
  expectedWrites(harness: HarnessId): PlannedWrite[];
  /** Keeps live files and active pointers in step after an edit or rename. */
  reconcileProfileUpdate(harness: HarnessId, previousName: string, nextName: string): void;
  /** Refuses to delete the active profile and clears additive leftovers otherwise. */
  prepareDelete(harness: HarnessId, name: string): void;
}

export const IActivationService = createDecorator<IActivationService>('activationService');

@inject(
  IEnvironmentService,
  IFileService,
  IHarnessRegistry,
  IProfileService,
  IAdapterRegistry,
  ILiveWriteService,
  ILogService,
)
export class ActivationService implements IActivationService {
  declare readonly _serviceBrand: undefined;

  constructor(
    private readonly environment: IEnvironmentService,
    private readonly files: IFileService,
    private readonly harnesses: IHarnessRegistry,
    private readonly profiles: IProfileService,
    private readonly adapters: IAdapterRegistry,
    private readonly liveWrite: ILiveWriteService,
    private readonly log: ILogService,
  ) {}

  getActive(harness: HarnessId): ActivePublic | null {
    const stored = this.read()[harness];
    if (!stored) {
      return null;
    }
    return {
      name: stored.name,
      baseUrl: stored.base_url || '',
      model: stored.model || '',
      official: stored.official === true,
    };
  }

  activate(harness: HarnessId, name: string): ActivationResult {
    const adapter = this.adapters.get(harness);
    const profile = this.profiles.decrypt(harness, name);
    adapter.validate?.(profile);

    const warnings: LocalizedMessage[] = [];
    const active = this.read();
    this.backfillPrevious(adapter, active[harness], name, warnings);

    const writes = this.expectedNamedWrites(harness, name);
    // The active pointer commits inside the transaction, so the live files and the
    // record of what is live can never end up describing different profiles.
    this.liveWrite.transaction(
      { kind: 'activate', harness, profile: name, writes, metadata: ['active'] },
      () => {
        active[harness] = {
          name: profile.name,
          base_url: profile.baseUrl,
          api_key: profile.apiKey,
          model: profile.model,
          extras: profile.extras,
          official: false,
        };
        this.files.writeJson(this.environment.files.active, active);
      },
    );

    // The switch is already effective here, so a failure below is reported rather than
    // raised: throwing would tell the user it failed when it did not.
    try {
      this.writeEnv(active);
    } catch (error) {
      this.log.error('failed to rebuild env file', error);
      warnings.push({
        message: '原生配置已写入，但重建 env.sh 失败',
        code: WARNING_CODES.envRebuildFailed,
      });
    }

    return { envFile: this.environment.files.env, warnings };
  }

  activateOfficial(harness: HarnessId): ActivationResult {
    const adapter = this.adapters.get(harness);
    if (!adapter.renderOfficial) {
      throw new HttpError(400, `${this.harnesses.label(harness)} 不支持官方账号登录模式`, {
        code: ERROR_CODES.officialLoginUnsupported,
        params: { harness: this.harnesses.label(harness) },
      });
    }

    const warnings: LocalizedMessage[] = [];
    const active = this.read();
    const previous = active[harness];
    const alreadyOfficial = previous?.official === true;

    // Always re-render even when already marked official: config.toml can drift
    // (Codex re-selects a leftover provider) while active.json still says official.
    if (!alreadyOfficial) {
      this.backfillPrevious(adapter, previous, '__official__', warnings);
    }
    const writes = this.expectedOfficialWrites(harness);
    this.liveWrite.transaction(
      {
        kind: 'activate-official',
        harness,
        profile: '官方登录',
        writes,
        metadata: ['active'],
      },
      () => {
        active[harness] = {
          name: '官方登录',
          base_url: '',
          api_key: '',
          model: '',
          extras: {},
          official: true,
        };
        this.files.writeJson(this.environment.files.active, active);
      },
    );

    try {
      this.writeEnv(active);
    } catch (error) {
      this.log.error('failed to rebuild env file', error);
      warnings.push({
        message: '已恢复官方登录，但重建 env.sh 失败',
        code: WARNING_CODES.officialEnvRebuildFailed,
      });
    }
    return { envFile: this.environment.files.env, warnings };
  }

  preview(harness: HarnessId, name: string): PreviewTarget[] {
    const adapter = this.adapters.get(harness);
    const profile = this.profiles.decrypt(harness, name);
    const targets = adapter.targets();
    const current = this.readCurrent(targets);
    const rendered = adapter.render(profile, current);

    return Object.entries(rendered).map(([key, content]) => {
      const target = this.requireTarget(targets, key);
      const override = profile.overrides[key];
      return {
        key,
        label: target.label,
        path: target.path,
        format: target.format,
        content: override ?? content,
        overridden: override !== undefined,
        currentContent: current[key] ?? null,
      };
    });
  }

  reconcileProfileUpdate(harness: HarnessId, previousName: string, nextName: string): void {
    const adapter = this.adapters.get(harness);
    if (previousName !== nextName && adapter.revoke) {
      const profile = this.profiles.decrypt(harness, nextName);
      const previousProfile = { ...profile, name: previousName };
      const targets = adapter.targets();
      const rendered = adapter.revoke(previousProfile, this.readCurrent(targets));
      this.liveWrite.apply({
        kind: 'revoke',
        harness,
        profile: previousName,
        writes: this.toWrites(targets, rendered),
      });
    }

    if (this.read()[harness]?.name !== previousName) {
      return;
    }
    this.activate(harness, nextName);
  }

  prepareDelete(harness: HarnessId, name: string): void {
    if (this.read()[harness]?.name === name) {
      throw new HttpError(
        409,
        '不能删除当前已激活的配置，请先激活另一个配置，否则工具的 live 配置会留下孤儿条目',
        { code: ERROR_CODES.profileActiveDeleteForbidden },
      );
    }
    const adapter = this.adapters.get(harness);
    if (!adapter.revoke) {
      return;
    }
    // Fail closed: if the provider cannot be removed from the live files, do not
    // delete the profile either, or the orphan entry would be left behind with
    // no record left to clean it up with.
    const profile = this.profiles.decrypt(harness, name);
    const targets = adapter.targets();
    const rendered = adapter.revoke(profile, this.readCurrent(targets));
    this.liveWrite.apply({
      kind: 'revoke',
      harness,
      profile: name,
      writes: this.toWrites(targets, rendered),
    });
  }

  /**
   * Writes the current live content back into the profile being switched away from, so
   * edits the user made directly in the CLI tool are not lost.
   */
  private backfillPrevious(
    adapter: HarnessAdapter,
    previous: ActiveEntry | undefined,
    nextName: string,
    warnings: LocalizedMessage[],
  ): void {
    if (!adapter.backfill || !previous || previous.official || previous.name === nextName) {
      return;
    }
    try {
      const targets = adapter.targets();
      const values = adapter.backfill(
        {
          name: previous.name,
          baseUrl: previous.base_url,
          apiKey: previous.api_key,
          model: previous.model,
          extras: previous.extras ?? {},
        },
        this.readCurrent(targets),
      );
      this.profiles.applyBackfill(adapter.id, previous.name, values);
    } catch (error) {
      this.log.error(`failed to backfill ${adapter.id}/${previous.name}`, error);
      warnings.push({
        message: `未能把 ${previous.name} 的现有配置回填保存`,
        code: WARNING_CODES.backfillFailed,
        params: { profile: previous.name },
      });
    }
  }

  /**
   * The exact content that would hit the disk for the current active state. With no
   * active profile there is nothing to render, so the caller gets a clear 400.
   */
  expectedWrites(harness: HarnessId): PlannedWrite[] {
    const active = this.read()[harness];
    if (!active) {
      throw new HttpError(400, '该工具未激活任何配置，无可渲染的内容', {
        code: ERROR_CODES.noActiveProfile,
      });
    }
    if (active.official === true) {
      return this.expectedOfficialWrites(harness);
    }
    return this.expectedNamedWrites(harness, active.name);
  }

  /** The exact content that would hit the disk for a named profile, overrides included. */
  private expectedNamedWrites(harness: HarnessId, name: string): PlannedWrite[] {
    const adapter = this.adapters.get(harness);
    const profile = this.profiles.decrypt(harness, name);
    const targets = adapter.targets();
    const rendered = adapter.render(profile, this.readCurrent(targets));
    for (const [key, content] of Object.entries(profile.overrides)) {
      // An override only makes sense for a file this harness owns; a stale key from an
      // earlier schema is ignored rather than written to an unknown path.
      if (targets.some((target) => target.key === key)) {
        rendered[key] = content;
      }
    }
    return this.toWrites(targets, rendered);
  }

  expectedOfficialWrites(harness: HarnessId): PlannedWrite[] {
    const adapter = this.adapters.get(harness);
    if (!adapter.renderOfficial) {
      throw new HttpError(400, `${this.harnesses.label(harness)} 不支持官方账号登录模式`);
    }
    const active = this.read()[harness];
    const profile =
      active && active.official !== true
        ? {
            name: active.name,
            baseUrl: active.base_url,
            apiKey: active.api_key,
            model: active.model,
            extras: active.extras ?? {},
          }
        : undefined;
    const targets = adapter.targets();
    const rendered = adapter.renderOfficial(profile, this.readCurrent(targets));
    return this.toWrites(targets, rendered);
  }

  private toWrites(targets: AdapterTarget[], rendered: Record<string, string>): PlannedWrite[] {
    return Object.entries(rendered).map(([key, content]) => {
      const target = this.requireTarget(targets, key);
      return { key: target.key, path: target.path, format: target.format, content };
    });
  }

  private requireTarget(targets: AdapterTarget[], key: string): AdapterTarget {
    const target = targets.find((candidate) => candidate.key === key);
    if (!target) {
      throw new HttpError(500, `adapter produced unknown target ${key}`);
    }
    return target;
  }

  private readCurrent(targets: AdapterTarget[]): CurrentFiles {
    const current: CurrentFiles = {};
    for (const target of targets) {
      current[target.key] = this.files.readOptional(target.path);
    }
    return current;
  }

  private read(): ActiveStore {
    // Strict: a corrupt active store must not be mistaken for "nothing active",
    // or a later switch could write over it and lose the record of what is live.
    return this.files.readJsonStrict<ActiveStore>(this.environment.files.active, {});
  }

  private writeEnv(active: ActiveStore): void {
    const lines = [
      '# Generated by harness-switch.',
      '# Native config files are already written on activation; this file is only a',
      '# compatibility layer for shells and tools that expect environment variables.',
      '# It contains secrets. Do not commit it.',
    ];

    for (const adapter of this.adapters.all()) {
      const entry = active[adapter.id];
      if (!entry) {
        continue;
      }
      if (entry.official) {
        lines.push('', `# ${this.harnesses.label(adapter.id)} / 官方登录`);
        lines.push('# 使用工具自身的官方账号登录，不注入环境变量。');
        continue;
      }
      const profile: AdapterProfile = {
        name: entry.name,
        baseUrl: entry.base_url,
        apiKey: entry.api_key,
        model: entry.model,
        extras: entry.extras ?? {},
      };
      const vars = adapter.envVars(profile);
      lines.push('', `# ${this.harnesses.label(adapter.id)} / ${entry.name}`);
      if (Object.keys(vars).length === 0) {
        lines.push(`# ${adapter.envNote ?? '该工具不读取环境变量凭据。'}`);
        continue;
      }
      for (const [key, value] of Object.entries(vars)) {
        if (value) {
          lines.push(`export ${key}=${shellQuote(value)}`);
        }
      }
    }

    this.files.writeSecure(this.environment.files.env, `${lines.join('\n')}\n`);
  }
}

function shellQuote(value: string): string {
  return `'${String(value || '').replace(/'/g, `'"'"'`)}'`;
}
