import { join } from 'node:path';
import type { FieldSpec, HarnessMode } from '@seaveyon/harness-switch-shared';
import type { IEnvironmentService } from '../environment';
import {
  ensureObject,
  isPlainObject,
  parseJsonObject,
  parseTomlObject,
  readString,
  slugify,
  stringifyJson,
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
const AUTH = 'auth';
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
export class CodexAdapter implements HarnessAdapter {
  readonly id = 'codex' as const;
  readonly mode: HarnessMode = 'replace';
  readonly envVarNames = [DEFAULT_ENV_KEY];
  readonly envNote = '仅「环境变量」认证模式需要 env.sh，其余模式的凭据自包含在 config.toml 里。';

  readonly fields: FieldSpec[] = [
    {
      key: 'authMode',
      label: '认证方式',
      kind: 'select',
      defaultValue: 'bearer_token',
      help: 'auth.json 就是 Codex 的登录缓存，覆盖它会丢失 ChatGPT 登录态，所以默认不碰它。',
      options: [
        { value: 'bearer_token', label: '写入 config.toml（推荐，保留官方登录）' },
        { value: 'env_key', label: '环境变量（需要 source env.sh）' },
        { value: 'openai_auth', label: '写入 auth.json（会覆盖 ChatGPT 登录缓存）' },
      ],
    },
    {
      key: 'providerId',
      label: 'Provider ID（可选）',
      kind: 'text',
      placeholder: '默认取配置名称',
      help: 'openai / ollama / lmstudio / amazon-bedrock 等是 Codex 保留字，会自动改名。',
    },
    {
      key: 'envKeyName',
      label: '环境变量名',
      kind: 'text',
      defaultValue: DEFAULT_ENV_KEY,
      help: '仅「环境变量」模式生效。',
    },
    {
      key: 'reasoningEffort',
      label: '推理强度（可选）',
      kind: 'select',
      defaultValue: '',
      options: [
        { value: '', label: '不设置' },
        { value: 'low', label: 'low' },
        { value: 'medium', label: 'medium' },
        { value: 'high', label: 'high' },
      ],
    },
  ];

  constructor(private readonly environment: IEnvironmentService) {}

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
    let config: Record<string, unknown> = {};
    try {
      config = parseTomlObject(current[CONFIG]);
    } catch {
      return {};
    }
    const providers = config.model_providers;
    const provider = isPlainObject(providers) ? providers[this.providerId(profile)] : undefined;
    const mode = this.authMode(profile);
    const token =
      mode === 'bearer_token'
        ? readString(provider, 'experimental_bearer_token')
        : mode === 'openai_auth'
          ? readString(safeJson(current[AUTH]), DEFAULT_ENV_KEY)
          : '';
    return {
      baseUrl: readString(provider, 'base_url') || profile.baseUrl,
      model: readString(config, 'model'),
      apiKey: token || profile.apiKey,
    };
  }

  private authMode(profile: AdapterProfile): CodexAuthMode {
    const mode = profile.extras.authMode;
    return mode === 'env_key' || mode === 'openai_auth' ? mode : 'bearer_token';
  }

  private envKeyName(profile: AdapterProfile): string {
    return profile.extras.envKeyName?.trim() || DEFAULT_ENV_KEY;
  }

  private providerId(profile: AdapterProfile): string {
    const slug = slugify(profile.extras.providerId || profile.name, 'provider');
    return RESERVED_PROVIDER_IDS.has(slug) ? `${slug}-hsw` : slug;
  }
}

function safeJson(text: string | undefined): Record<string, unknown> {
  try {
    return parseJsonObject(text);
  } catch {
    return {};
  }
}
