import { join } from 'node:path';
import type { FieldSpec, HarnessMode } from '@seaveyon/harness-switch-shared';
import { HttpError } from '../../common/errors';
import type { IEnvironmentService } from '../environment';
import {
  ensureObject,
  isPlainObject,
  parseTomlObject,
  readString,
  slugify,
  stringifyToml,
} from './serialize';
import type {
  AdapterProfile,
  AdapterTarget,
  CurrentFiles,
  HarnessAdapter,
  RenderedFiles,
} from './types';

const CONFIG = 'config';
const DEFAULT_CONTEXT = 262144;

/**
 * Kimi Code keeps every provider in one config file and picks the active one through
 * `default_model`, so a switch moves that pointer instead of rewriting the file. It also
 * never reads credentials from the shell, which makes the native write the only option.
 *
 * Note this targets Kimi Code (TypeScript, `~/.kimi-code`), not the separate Kimi CLI
 * (Python, `~/.kimi`). Both ship a `kimi` command.
 */
export class KimiAdapter implements HarnessAdapter {
  readonly id = 'kimi' as const;
  readonly mode: HarnessMode = 'additive';
  readonly modelRequired = true;
  readonly envVarNames: string[] = [];
  readonly envNote = 'Kimi Code 不从 shell 读取凭据，env.sh 对它无效。';

  readonly fields: FieldSpec[] = [
    {
      key: 'providerType',
      label: 'Provider 类型',
      kind: 'select',
      defaultValue: 'kimi',
      help: '决定 Kimi Code 使用哪套协议实现。',
      options: [
        { value: 'kimi', label: 'kimi（Moonshot / Kimi Code）' },
        { value: 'anthropic', label: 'anthropic' },
        { value: 'openai_responses', label: 'openai_responses' },
        { value: 'openai_legacy', label: 'openai_legacy' },
      ],
    },
    {
      key: 'providerId',
      label: 'Provider ID（可选）',
      kind: 'text',
      placeholder: '默认取配置名称',
    },
    {
      key: 'maxContextSize',
      label: '上下文长度',
      kind: 'text',
      defaultValue: String(DEFAULT_CONTEXT),
      help: 'Kimi Code 要求 models 条目必须声明 max_context_size。',
    },
  ];

  constructor(private readonly environment: IEnvironmentService) {}

  targets(): AdapterTarget[] {
    return [
      {
        key: CONFIG,
        label: 'config.toml',
        path: join(this.environment.harnessHomes.kimiCode, 'config.toml'),
        format: 'toml',
      },
    ];
  }

  envVars(): Record<string, string> {
    return {};
  }

  validate(profile: AdapterProfile): void {
    if (!profile.model.trim()) {
      throw new HttpError(400, 'Kimi Code 需要填写模型名称，否则无法生成 models 条目');
    }
  }

  render(profile: AdapterProfile, current: CurrentFiles): RenderedFiles {
    this.validate(profile);
    const id = this.providerId(profile);
    const config = parseTomlObject(current[CONFIG]);

    const provider = ensureObject(ensureObject(config, 'providers'), id);
    provider.type = profile.extras.providerType || 'kimi';
    provider.base_url = profile.baseUrl;
    provider.api_key = profile.apiKey;

    const model = ensureObject(ensureObject(config, 'models'), id);
    model.provider = id;
    model.model = profile.model;
    model.max_context_size = this.contextSize(profile);

    config.default_model = id;

    return { [CONFIG]: stringifyToml(config) };
  }

  revoke(profile: AdapterProfile, current: CurrentFiles): RenderedFiles {
    const id = this.providerId(profile);
    if (current[CONFIG] === undefined) {
      return {};
    }
    let config: Record<string, unknown>;
    try {
      config = parseTomlObject(current[CONFIG]);
    } catch {
      return {};
    }

    const providers = config.providers;
    if (isPlainObject(providers)) {
      delete providers[id];
    }
    const models = config.models;
    if (isPlainObject(models)) {
      delete models[id];
    }
    if (config.default_model === id) {
      const remaining = isPlainObject(models) ? Object.keys(models) : [];
      if (remaining.length > 0) {
        config.default_model = remaining[0];
      } else {
        delete config.default_model;
      }
    }

    return { [CONFIG]: stringifyToml(config) };
  }

  backfill(profile: AdapterProfile, current: CurrentFiles): Partial<AdapterProfile> {
    let config: Record<string, unknown>;
    try {
      config = parseTomlObject(current[CONFIG]);
    } catch {
      return {};
    }
    const id = this.providerId(profile);
    const providers = config.providers;
    const provider = isPlainObject(providers) ? providers[id] : undefined;
    const models = config.models;
    const model = isPlainObject(models) ? models[id] : undefined;
    const apiKey = readString(provider, 'api_key');
    return {
      baseUrl: readString(provider, 'base_url') || profile.baseUrl,
      model: readString(model, 'model') || profile.model,
      apiKey: apiKey || profile.apiKey,
    };
  }

  private providerId(profile: AdapterProfile): string {
    return slugify(profile.extras.providerId || profile.name, 'provider');
  }

  private contextSize(profile: AdapterProfile): number {
    const parsed = Number(profile.extras.maxContextSize);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : DEFAULT_CONTEXT;
  }
}
