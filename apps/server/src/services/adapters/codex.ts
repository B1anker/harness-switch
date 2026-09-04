import { join } from 'node:path';
import type { CompletionProtocol, FieldSpec, HarnessMode } from '@seaveyon/harness-switch-shared';
import { BaseAdapter } from './base';
import {
  providerId as baseProviderId,
  compact,
  type DetectedProfile,
  seedProfile,
  toCandidate,
} from './detect';
import {
  ensureObject,
  isPlainObject,
  parseJsonObject,
  parseTomlObject,
  readString,
  stringifyJson,
  stringifyToml,
  tryParseJsonObject,
  tryParseTomlObject,
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
/** Exported so the login-cache service can plan a write against the same target. */
export const CODEX_AUTH_TARGET = 'auth';
const AUTH = CODEX_AUTH_TARGET;
const DEFAULT_ENV_KEY = 'OPENAI_API_KEY';

/**
 * Ids owned by Codex itself. `oss` and `ollama-chat` are removed aliases that Codex
 * still rejects, so they belong in the list too.
 */
const RESERVED_PROVIDER_IDS = new Set([
  'openai',
  'ollama',
  'lmstudio',
  'amazon-bedrock',
  'oss',
  'ollama-chat',
]);

export type CodexAuthMode = 'bearer_token' | 'env_key' | 'openai_auth';

/**
 * Codex resolves providers from `config.toml`; `OPENAI_BASE_URL` is not a switch it
 * reads. Only the user-level file is written because Codex ignores `model_provider`
 * and `model_providers` coming from a project-level `.codex/config.toml`.
 */
export class CodexAdapter extends BaseAdapter implements HarnessAdapter {
  readonly id = 'codex' as const;
  readonly mode: HarnessMode = 'replace';
  readonly envVarNames = [DEFAULT_ENV_KEY];
  readonly envNote = '仅「环境变量」认证模式需要 env.sh，其余模式的凭据自包含在 config.toml 里。';
  readonly envNoteCode = 'harness.field.codex.envNote';

  official(_current: CurrentFiles): OfficialCapability {
    return {
      kind: 'account-login',
      available: true,
      titleCode: 'harness.official',
      hintCode: 'harness.officialHintCodex',
    };
  }

  readonly fields: FieldSpec[] = [
    {
      key: 'authMode',
      labelCode: 'harness.field.codex.authMode.label',
      kind: 'select',
      defaultValue: 'bearer_token',
      helpCode: 'harness.field.codex.authMode.help',
      options: [
        {
          value: 'bearer_token',
          labelCode: 'harness.field.codex.authMode.option.bearerToken',
        },
        {
          value: 'env_key',
          labelCode: 'harness.field.codex.authMode.option.envKey',
        },
        {
          value: 'openai_auth',
          labelCode: 'harness.field.codex.authMode.option.openaiAuth',
        },
      ],
    },
    {
      key: 'providerId',
      labelCode: 'harness.field.providerId.label',
      kind: 'text',
      placeholderCode: 'harness.field.providerId.placeholder',
      helpCode: 'harness.field.codex.providerId.help',
    },
    {
      key: 'envKeyName',
      labelCode: 'harness.field.codex.envKeyName.label',
      kind: 'text',
      defaultValue: DEFAULT_ENV_KEY,
      helpCode: 'harness.field.codex.envKeyName.help',
    },
    {
      key: 'reasoningEffort',
      labelCode: 'harness.field.codex.reasoningEffort.label',
      kind: 'select',
      defaultValue: '',
      options: [
        {
          value: '',
          labelCode: 'harness.field.codex.reasoningEffort.option.unset',
        },
        { value: 'low' },
        { value: 'medium' },
        { value: 'high' },
      ],
    },
  ];

  targets(): AdapterTarget[] {
    return [
      {
        key: CONFIG,
        label: 'config.toml',
        path: join(this.environment.harnessHomes.codex, 'config.toml'),
        format: 'toml',
      },
      {
        key: AUTH,
        label: 'auth.json（仅 auth.json 模式）',
        labelCode: 'harness.field.codex.target.auth',
        path: join(this.environment.harnessHomes.codex, 'auth.json'),
        format: 'json',
      },
    ];
  }

  envVars(profile: AdapterProfile): Record<string, string> {
    if (this.authMode(profile) !== 'env_key') {
      return {};
    }
    return { [this.envKeyName(profile)]: profile.apiKey };
  }

  /** `chat` was removed from Codex; `responses` is the only protocol it still speaks. */
  completionProtocol(): CompletionProtocol {
    return 'openai-responses';
  }

  render(profile: AdapterProfile, current: CurrentFiles): RenderedFiles {
    const providerId = this.providerId(profile);
    const config = parseTomlObject(current[CONFIG]);
    const mode = this.authMode(profile);

    config.model_provider = providerId;
    if (profile.model) {
      config.model = profile.model;
    }
    const effort = profile.extras.reasoningEffort;
    if (effort) {
      config.model_reasoning_effort = effort;
    }

    const providers = ensureObject(config, 'model_providers');
    const provider = ensureObject(providers, providerId);
    provider.name = profile.name;
    provider.base_url = profile.baseUrl;
    // `chat` was removed; `responses` is the only protocol Codex still speaks.
    provider.wire_api = 'responses';

    // These three are mutually exclusive: with requires_openai_auth Codex ignores
    // env_key entirely, so leaving stale keys behind produces silent misrouting.
    delete provider.experimental_bearer_token;
    delete provider.env_key;
    delete provider.requires_openai_auth;

    if (mode === 'bearer_token') {
      provider.experimental_bearer_token = profile.apiKey;
    } else if (mode === 'env_key') {
      provider.env_key = this.envKeyName(profile);
    } else {
      provider.requires_openai_auth = true;
    }

    const rendered: RenderedFiles = { [CONFIG]: stringifyToml(config) };
    if (mode === 'openai_auth') {
      const auth = parseJsonObject(current[AUTH]);
      auth[DEFAULT_ENV_KEY] = profile.apiKey;
      rendered[AUTH] = stringifyJson(auth);
    }
    return rendered;
  }

  renderOfficial(_profile: AdapterProfile | undefined, current: CurrentFiles): RenderedFiles {
    const config = parseTomlObject(current[CONFIG]);
    // Official login is Codex's built-in ChatGPT provider. Leftover custom
    // model_providers stay selectable in the UI; if one still points at
    // OpenRouter, ChatGPT OAuth is not sent there and the request 401s.
    delete config.model_provider;
    delete config.model;
    delete config.model_reasoning_effort;
    delete config.model_providers;

    const rendered: RenderedFiles = { [CONFIG]: stringifyToml(config) };
    if (current[AUTH] !== undefined) {
      const auth = parseJsonObject(current[AUTH]);
      if (DEFAULT_ENV_KEY in auth) {
        delete auth[DEFAULT_ENV_KEY];
        rendered[AUTH] = stringifyJson(auth);
      }
    }
    return rendered;
  }

  backfill(profile: AdapterProfile, current: CurrentFiles): Partial<AdapterProfile> {
    const config = tryParseTomlObject(current[CONFIG]);
    if (!config) {
      return {};
    }
    const providers = config.model_providers;
    const provider = isPlainObject(providers) ? providers[this.providerId(profile)] : undefined;
    const mode = this.authMode(profile);
    const token =
      mode === 'bearer_token'
        ? readString(provider, 'experimental_bearer_token')
        : mode === 'openai_auth'
          ? readString(tryParseJsonObject(current[AUTH]) ?? {}, DEFAULT_ENV_KEY)
          : '';
    return {
      baseUrl: readString(provider, 'base_url') || profile.baseUrl,
      model: readString(config, 'model'),
      apiKey: token || profile.apiKey,
    };
  }

  /**
   * Every entry under `model_providers` is a routing the user set up, so each becomes a
   * candidate. Which of the three mutually exclusive credential keys the entry carries
   * identifies its auth mode, and `env_key` deliberately yields no key: that one lives
   * in the shell environment, not in a file this can read.
   */
  detect(current: CurrentFiles): DetectedProfile[] {
    const config = tryParseTomlObject(current[CONFIG]);
    if (!config) {
      return [];
    }
    const providers = config.model_providers;
    if (!isPlainObject(providers)) {
      return [];
    }
    const selected = readString(config, 'model_provider');
    return compact(
      Object.entries(providers).map(([id, provider]) => {
        if (!isPlainObject(provider)) {
          return null;
        }
        const mode: CodexAuthMode = provider.requires_openai_auth
          ? 'openai_auth'
          : typeof provider.env_key === 'string'
            ? 'env_key'
            : 'bearer_token';
        const seed = seedProfile({
          providerId: id,
          authMode: mode,
          ...(mode === 'env_key' ? { envKeyName: provider.env_key as string } : {}),
          ...(readString(config, 'model_reasoning_effort')
            ? { reasoningEffort: readString(config, 'model_reasoning_effort') }
            : {}),
        });
        return toCandidate(id, seed, this.backfill(seed, current), id === selected);
      }),
    );
  }

  private authMode(profile: AdapterProfile): CodexAuthMode {
    const mode = profile.extras.authMode;
    return mode === 'env_key' || mode === 'openai_auth' ? mode : 'bearer_token';
  }

  private envKeyName(profile: AdapterProfile): string {
    return profile.extras.envKeyName?.trim() || DEFAULT_ENV_KEY;
  }

  private providerId(profile: AdapterProfile): string {
    const slug = baseProviderId(profile);
    return RESERVED_PROVIDER_IDS.has(slug) ? `${slug}-hsw` : slug;
  }
}
