import { join } from 'node:path';
import type { FieldSpec, HarnessMode } from '@seaveyon/harness-switch-shared';
import { ERROR_CODES } from '@seaveyon/harness-switch-shared';
import { HttpError } from '../../common/errors';
import type { IEnvironmentService } from '../environment';
import { compact, type DetectedProfile, providerId, seedProfile, toCandidate } from './detect';
import {
  ensureObject,
  isPlainObject,
  type JsonObject,
  numeric,
  parseJsonObject,
  readString,
  stringifyJson,
  tryParseJsonObject,
  valueString,
} from './serialize';
import type {
  AdapterProfile,
  AdapterTarget,
  CurrentFiles,
  HarnessAdapter,
  RenderedFiles,
} from './types';

const MODELS = 'models';
const SETTINGS = 'settings';
const DEFAULT_CONTEXT = 200000;
const DEFAULT_MAX_TOKENS = 8192;

/**
 * Pi (command `pi`) loads custom providers from `~/.pi/agent/models.json`. A model stays
 * hidden until the provider has an `apiKey` (or auth.json / `--api-key`), which is why
 * an empty auth.json produces "No models available" even after a profile is activated.
 *
 * There is no provider-order list; `defaultProvider` / `defaultModel` in `settings.json`
 * select the active route. `PI_CODING_AGENT_DIR` overrides the config directory.
 */
export class PiAdapter implements HarnessAdapter {
  readonly id = 'pi' as const;
  readonly mode: HarnessMode = 'additive';
  readonly modelRequired = true;
  readonly envVarNames: string[] = [];
  readonly envNote = 'API key 直接写入 models.json，无需环境变量；运行时仍可用 --model 覆盖。';

  readonly fields: FieldSpec[] = [
    {
      key: 'providerId',
      label: 'Provider ID（可选）',
      kind: 'text',
      placeholder: '默认取配置名称',
      help: '模型引用格式为 provider/model。',
    },
    {
      key: 'api',
      label: '协议',
      kind: 'select',
      defaultValue: 'openai-completions',
      options: [
        { value: 'openai-completions', label: 'openai-completions' },
        { value: 'openai-responses', label: 'openai-responses' },
        { value: 'anthropic-messages', label: 'anthropic-messages' },
      ],
    },
    {
      key: 'authHeader',
      label: 'Authorization 头',
      kind: 'select',
      defaultValue: 'true',
      help: '以 Authorization: Bearer <key> 发送。',
      options: [
        { value: 'true', label: '开启' },
        { value: 'false', label: '关闭' },
      ],
    },
    {
      key: 'contextWindow',
      label: '上下文长度',
      kind: 'text',
      defaultValue: String(DEFAULT_CONTEXT),
    },
    {
      key: 'maxTokens',
      label: '最大输出 tokens',
      kind: 'text',
      defaultValue: String(DEFAULT_MAX_TOKENS),
    },
    {
      key: 'reasoning',
      label: '推理能力',
      kind: 'select',
      defaultValue: 'false',
      help: '对应 models.json 的 reasoning。GPT / Claude 思考模型需要开启。',
      options: [
        { value: 'false', label: '关闭' },
        { value: 'true', label: '开启' },
      ],
    },
  ];

  constructor(private readonly environment: IEnvironmentService) {}

  targets(): AdapterTarget[] {
    return [
      {
        key: MODELS,
        label: 'models.json',
        path: join(this.environment.harnessHomes.piAgent, 'models.json'),
        format: 'json',
      },
      {
        key: SETTINGS,
        label: 'settings.json',
        path: join(this.environment.harnessHomes.piAgent, 'settings.json'),
        format: 'json',
      },
    ];
  }

  envVars(): Record<string, string> {
    return {};
  }

  validate(profile: AdapterProfile): void {
    if (!profile.model.trim()) {
      throw new HttpError(400, 'Pi 需要填写模型名称，否则无法生成 models 条目', {
        code: ERROR_CODES.adapterModelRequired,
        params: { harness: 'Pi' },
      });
    }
    if (!profile.apiKey.trim()) {
      throw new HttpError(400, 'Pi 需要填写 API key，否则模型不会出现在 /model 列表里', {
        code: ERROR_CODES.adapterApiKeyRequired,
        params: { harness: 'Pi' },
      });
    }
  }

  render(profile: AdapterProfile, current: CurrentFiles): RenderedFiles {
    this.validate(profile);
    const id = providerId(profile);
    const models = parseJsonObject(current[MODELS]);
    const provider = ensureObject(ensureObject(models, 'providers'), id);
    const model: JsonObject = {
      id: profile.model,
      name: profile.model,
      contextWindow: numeric(profile.extras.contextWindow, DEFAULT_CONTEXT),
      maxTokens: numeric(profile.extras.maxTokens, DEFAULT_MAX_TOKENS),
    };
    if (profile.extras.reasoning === 'true') {
      model.reasoning = true;
    }

    provider.baseUrl = profile.baseUrl;
    provider.apiKey = profile.apiKey;
    provider.api = profile.extras.api || 'openai-completions';
    provider.authHeader = profile.extras.authHeader !== 'false';
    provider.models = [model];

    const settings = parseJsonObject(current[SETTINGS]);
    settings.defaultProvider = id;
    settings.defaultModel = profile.model;

    return {
      [MODELS]: stringifyJson(models),
      [SETTINGS]: stringifyJson(settings),
    };
  }

  revoke(profile: AdapterProfile, current: CurrentFiles): RenderedFiles {
    const id = providerId(profile);
    const rendered: RenderedFiles = {};

    if (current[MODELS] !== undefined) {
      const models = tryParseJsonObject(current[MODELS]);
      if (models) {
        const providers = models.providers;
        if (isPlainObject(providers)) {
          delete providers[id];
        }
        rendered[MODELS] = stringifyJson(models);
      }
      // A models.json we cannot parse is left untouched rather than clobbered.
    }

    if (current[SETTINGS] !== undefined) {
      const settings = tryParseJsonObject(current[SETTINGS]);
      if (settings) {
        if (settings.defaultProvider === id) {
          delete settings.defaultProvider;
          delete settings.defaultModel;
        }
        rendered[SETTINGS] = stringifyJson(settings);
      }
      // Same reasoning as above.
    }

    return rendered;
  }

  backfill(profile: AdapterProfile, current: CurrentFiles): Partial<AdapterProfile> {
    const models = tryParseJsonObject(current[MODELS]);
    if (!models) {
      return {};
    }
    const id = providerId(profile);
    const providers = models.providers;
    const provider = isPlainObject(providers) ? providers[id] : undefined;
    if (!isPlainObject(provider)) {
      return {};
    }
    const firstModel = Array.isArray(provider.models)
      ? provider.models.find((entry) => isPlainObject(entry))
      : undefined;
    const apiKey = readString(provider, 'apiKey');
    return {
      baseUrl: readString(provider, 'baseUrl') || profile.baseUrl,
      apiKey: apiKey || profile.apiKey,
      model: readString(firstModel, 'id') || profile.model,
      extras: {
        ...profile.extras,
        api: readString(provider, 'api') || profile.extras.api || '',
        contextWindow: valueString(firstModel?.contextWindow, profile.extras.contextWindow),
        maxTokens: valueString(firstModel?.maxTokens, profile.extras.maxTokens),
        reasoning: firstModel?.reasoning === true ? 'true' : profile.extras.reasoning || 'false',
      },
    };
  }

  /** One candidate per `providers` entry in models.json; settings.json names the active one. */
  detect(current: CurrentFiles): DetectedProfile[] {
    const models = tryParseJsonObject(current[MODELS]);
    const settings = tryParseJsonObject(current[SETTINGS]);
    if (!models || !settings) {
      return [];
    }
    const providers = models.providers;
    const selected = readString(settings, 'defaultProvider');
    if (!isPlainObject(providers)) {
      return [];
    }
    return compact(
      Object.entries(providers).map(([id, provider]) => {
        if (!isPlainObject(provider)) {
          return null;
        }
        const seed = seedProfile({
          providerId: id,
          authHeader: provider.authHeader === false ? 'false' : 'true',
        });
        return toCandidate(id, seed, this.backfill(seed, current), id === selected);
      }),
    );
  }
}
