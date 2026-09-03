import { join } from 'node:path';
import type { CompletionProtocol, FieldSpec, HarnessMode } from '@seaveyon/harness-switch-shared';
import { ERROR_CODES } from '@seaveyon/harness-switch-shared';
import { HttpError } from '../../common/errors';
import type { IEnvironmentService } from '../environment';
import { compact, type DetectedProfile, providerId, seedProfile, toCandidate } from './detect';
import {
  ensureObject,
  isPlainObject,
  numeric,
  parseTomlObject,
  readString,
  stringifyToml,
  tryParseTomlObject,
  valueString,
} from './serialize';
import type {
  AdapterProfile,
  AdapterTarget,
  CurrentFiles,
  HarnessAdapter,
  OfficialCapability,
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
  readonly envNoteCode = 'harness.field.kimi.envNote';

  official(_current: CurrentFiles): OfficialCapability {
    return {
      kind: 'account-login',
      available: true,
      titleCode: 'harness.official',
      hintCode: 'harness.officialHintKimi',
    };
  }

  readonly fields: FieldSpec[] = [
    {
      key: 'providerType',
      label: 'Provider 类型',
      labelCode: 'harness.field.kimi.providerType.label',
      kind: 'select',
      defaultValue: 'kimi',
      help: '决定 Kimi Code 使用哪套协议实现。',
      helpCode: 'harness.field.kimi.providerType.help',
      options: [
        {
          value: 'kimi',
          label: 'kimi（Moonshot / Kimi Code）',
          labelCode: 'harness.field.kimi.providerType.option.kimi',
        },
        { value: 'anthropic', label: 'anthropic' },
        { value: 'openai_responses', label: 'openai_responses' },
        { value: 'openai_legacy', label: 'openai_legacy' },
      ],
    },
    {
      key: 'providerId',
      label: 'Provider ID（可选）',
      labelCode: 'harness.field.providerId.label',
      kind: 'text',
      placeholder: '默认取配置名称',
      placeholderCode: 'harness.field.providerId.placeholder',
    },
    {
      key: 'maxContextSize',
      label: '上下文长度',
      labelCode: 'harness.field.contextLength.label',
      kind: 'text',
      defaultValue: String(DEFAULT_CONTEXT),
      help: 'Kimi Code 要求 models 条目必须声明 max_context_size。',
      helpCode: 'harness.field.kimi.maxContextSize.help',
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

  /**
   * `providerType` decides which protocol implementation Kimi Code uses. The `kimi` type
   * is Moonshot's own OpenAI-compatible chat surface.
   */
  completionProtocol(profile: AdapterProfile): CompletionProtocol | undefined {
    switch (profile.extras.providerType || 'kimi') {
      case 'anthropic':
        return 'anthropic-messages';
      case 'openai_responses':
        return 'openai-responses';
      case 'kimi':
      case 'openai_legacy':
        return 'openai-chat';
      default:
        return undefined;
    }
  }

  validate(profile: AdapterProfile): void {
    if (!profile.model.trim()) {
      throw new HttpError(400, 'Kimi Code 需要填写模型名称，否则无法生成 models 条目', {
        code: ERROR_CODES.adapterModelRequired,
        params: { harness: 'Kimi Code' },
      });
    }
  }

  render(profile: AdapterProfile, current: CurrentFiles): RenderedFiles {
    this.validate(profile);
    const id = providerId(profile);
    const config = parseTomlObject(current[CONFIG]);

    const provider = ensureObject(ensureObject(config, 'providers'), id);
    provider.type = profile.extras.providerType || 'kimi';
    provider.base_url = profile.baseUrl;
    provider.api_key = profile.apiKey;

    const model = ensureObject(ensureObject(config, 'models'), id);
    model.provider = id;
    model.model = profile.model;
    model.max_context_size = numeric(profile.extras.maxContextSize, DEFAULT_CONTEXT);

    config.default_model = id;

    return { [CONFIG]: stringifyToml(config) };
  }

  revoke(profile: AdapterProfile, current: CurrentFiles): RenderedFiles {
    const id = providerId(profile);
    if (current[CONFIG] === undefined) {
      return {};
    }
    const config = tryParseTomlObject(current[CONFIG]);
    if (!config) {
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

  /**
   * Point `default_model` back at the managed provider that `/login` provisions
   * (recognised by a `managed:` id or an `oauth` credential reference). Additive config
   * keeps every provider, so nothing is removed: the profile's entries stay on disk for
   * the next switch, and the OAuth cache under `credentials/` is never touched. When the
   * file holds no managed entry the user never completed `/login`, so the switch refuses.
   */
  renderOfficial(_profile: AdapterProfile | undefined, current: CurrentFiles): RenderedFiles {
    if (current[CONFIG] === undefined) {
      return {};
    }
    const config = tryParseTomlObject(current[CONFIG]);
    if (!config) {
      return {};
    }

    const official = officialModel(config);
    if (official === undefined) {
      throw new HttpError(
        400,
        '未检测到 Kimi Code 官方登录条目，请先在终端运行 kimi 并完成 /login',
        {
          code: ERROR_CODES.officialLoginMissing,
          params: { harness: 'Kimi Code' },
        },
      );
    }
    config.default_model = official;
    return { [CONFIG]: stringifyToml(config) };
  }

  backfill(profile: AdapterProfile, current: CurrentFiles): Partial<AdapterProfile> {
    const config = tryParseTomlObject(current[CONFIG]);
    if (!config) {
      return {};
    }
    const id = providerId(profile);
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

  /** One candidate per `providers` entry; `default_model` names the one in use. */
  detect(current: CurrentFiles): DetectedProfile[] {
    const config = tryParseTomlObject(current[CONFIG]);
    if (!config) {
      return [];
    }
    const providers = config.providers;
    if (!isPlainObject(providers)) {
      return [];
    }
    const models = isPlainObject(config.models) ? config.models : {};
    const selected = readString(config, 'default_model');
    return compact(
      Object.entries(providers).map(([id, provider]) => {
        if (!isPlainObject(provider)) {
          return null;
        }
        const model = models[id];
        const seed = seedProfile({
          providerId: id,
          providerType: readString(provider, 'type') || 'kimi',
          maxContextSize: valueString(
            isPlainObject(model) ? model.max_context_size : undefined,
            String(DEFAULT_CONTEXT),
          ),
        });
        return toCandidate(id, seed, this.backfill(seed, current), id === selected);
      }),
    );
  }
}

/**
 * The model alias `/login` provisions: its provider is a managed entry (`managed:*` id)
 * or carries an `oauth` credential reference. When several exist, the preferred official
 * default wins, then the classic alias, then whatever is left.
 */
const PREFERRED_OFFICIAL_MODELS = ['kimi-code/k3-256k', 'kimi-code/kimi-for-coding'];

function officialModel(config: Record<string, unknown>): string | undefined {
  const providers = isPlainObject(config.providers) ? config.providers : {};
  const models = isPlainObject(config.models) ? config.models : {};
  const managed = new Set(
    Object.entries(providers)
      .filter(
        ([id, provider]) =>
          id.startsWith('managed:') || (isPlainObject(provider) && isPlainObject(provider.oauth)),
      )
      .map(([id]) => id),
  );
  const aliases = Object.entries(models)
    .filter(
      ([, model]) =>
        isPlainObject(model) && typeof model.provider === 'string' && managed.has(model.provider),
    )
    .map(([alias]) => alias);
  return PREFERRED_OFFICIAL_MODELS.find((preferred) => aliases.includes(preferred)) ?? aliases[0];
}
