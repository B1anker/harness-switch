import { join } from 'node:path';
import type { FieldSpec, HarnessMode } from '@seaveyon/harness-switch-shared';
import type { IEnvironmentService } from '../environment';
import {
  ensureObject,
  type JsonObject,
  parseJsonObject,
  readString,
  stringifyJson,
} from './serialize';
import type {
  AdapterProfile,
  AdapterTarget,
  CurrentFiles,
  HarnessAdapter,
  RenderedFiles,
} from './types';

const SETTINGS = 'settings';
const BASE_URL_VAR = 'ANTHROPIC_BASE_URL';
const MODEL_VAR = 'ANTHROPIC_MODEL';
const AUTH_VARS = ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY'] as const;
const MODEL_MAPPINGS = [
  ['haikuModel', 'ANTHROPIC_DEFAULT_HAIKU_MODEL'],
  ['sonnetModel', 'ANTHROPIC_DEFAULT_SONNET_MODEL'],
  ['opusModel', 'ANTHROPIC_DEFAULT_OPUS_MODEL'],
  ['fableModel', 'ANTHROPIC_DEFAULT_FABLE_MODEL'],
  ['subagentModel', 'CLAUDE_CODE_SUBAGENT_MODEL'],
] as const;

/**
 * Claude Code reads the `env` block of settings.json itself, so a switch takes effect
 * without touching any shell. The settings value also wins over a variable inherited
 * from the shell, which is what makes this work for long-lived daemons that spawn
 * `claude` as a child process.
 */
export class ClaudeAdapter implements HarnessAdapter {
  readonly id = 'claude' as const;
  readonly mode: HarnessMode = 'replace';
  readonly envVarNames = [
    BASE_URL_VAR,
    ...AUTH_VARS,
    MODEL_VAR,
    ...MODEL_MAPPINGS.map(([, envVar]) => envVar),
  ];

  readonly fields: FieldSpec[] = [
    {
      key: 'authVar',
      label: '凭据变量',
      kind: 'select',
      defaultValue: 'ANTHROPIC_AUTH_TOKEN',
      help: '第三方中转通常要求 ANTHROPIC_AUTH_TOKEN；官方 API key 用 ANTHROPIC_API_KEY。',
      options: [
        { value: 'ANTHROPIC_AUTH_TOKEN', label: 'ANTHROPIC_AUTH_TOKEN（第三方中转）' },
        { value: 'ANTHROPIC_API_KEY', label: 'ANTHROPIC_API_KEY（官方）' },
      ],
    },
    {
      key: 'haikuModel',
      label: 'Haiku 模型映射',
      kind: 'text',
      placeholder: '例如：glm-5-air',
      help: '写入 ANTHROPIC_DEFAULT_HAIKU_MODEL；留空使用回退模型或 Claude Code 默认值。',
    },
    {
      key: 'sonnetModel',
      label: 'Sonnet 模型映射',
      kind: 'text',
      placeholder: '例如：glm-5',
      help: '写入 ANTHROPIC_DEFAULT_SONNET_MODEL。',
    },
    {
      key: 'opusModel',
      label: 'Opus 模型映射',
      kind: 'text',
      placeholder: '例如：glm-5',
      help: '写入 ANTHROPIC_DEFAULT_OPUS_MODEL。',
    },
    {
      key: 'fableModel',
      label: 'Fable 模型映射（可选）',
      kind: 'text',
      placeholder: '例如：glm-5',
      help: '写入 ANTHROPIC_DEFAULT_FABLE_MODEL；用于支持 Fable 档位的新版 Claude Code。',
    },
    {
      key: 'subagentModel',
      label: '子代理模型（可选）',
      kind: 'text',
      placeholder: '例如：glm-5-air',
      help: '写入 CLAUDE_CODE_SUBAGENT_MODEL，可让子代理使用更快或成本更低的模型。',
    },
    {
      key: 'extraEnv',
      label: '追加环境变量（可选）',
      kind: 'textarea',
      placeholder: 'ANTHROPIC_DEFAULT_SONNET_MODEL=glm-5.2\nAPI_TIMEOUT_MS=3000000',
      help: '每行一个 KEY=VALUE，会合并进 settings.json 的 env。',
    },
  ];

  constructor(private readonly environment: IEnvironmentService) {}

  targets(): AdapterTarget[] {
    return [
      {
        key: SETTINGS,
        label: 'settings.json',
        path: join(this.environment.harnessHomes.claude, 'settings.json'),
        format: 'json',
      },
    ];
  }

  envVars(profile: AdapterProfile): Record<string, string> {
    const vars: Record<string, string> = { [BASE_URL_VAR]: profile.baseUrl };
    vars[this.authVar(profile)] = profile.apiKey;
    if (profile.model) {
      vars[MODEL_VAR] = profile.model;
    }
    for (const [field, envVar] of MODEL_MAPPINGS) {
      if (profile.extras[field]) {
        vars[envVar] = profile.extras[field];
      }
    }
    return vars;
  }

  render(profile: AdapterProfile, current: CurrentFiles): RenderedFiles {
    const settings = parseJsonObject(current[SETTINGS]);
    const env = ensureObject(settings, 'env');
    const authVar = this.authVar(profile);

    env[BASE_URL_VAR] = profile.baseUrl;
    env[authVar] = profile.apiKey;
    // Leaving the other credential variable behind makes Claude Code pick the wrong one.
    for (const candidate of AUTH_VARS) {
      if (candidate !== authVar) {
        delete env[candidate];
      }
    }

    if (profile.model) {
      env[MODEL_VAR] = profile.model;
    } else {
      delete env[MODEL_VAR];
    }

    for (const [field, envVar] of MODEL_MAPPINGS) {
      const value = profile.extras[field]?.trim();
      if (value) {
        env[envVar] = value;
      } else {
        delete env[envVar];
      }
    }

    for (const [key, value] of parseEnvLines(profile.extras.extraEnv)) {
      env[key] = value;
    }

    return { [SETTINGS]: stringifyJson(settings) };
  }

  renderOfficial(profile: AdapterProfile | undefined, current: CurrentFiles): RenderedFiles {
    const settings = parseJsonObject(current[SETTINGS]);
    const env = ensureObject(settings, 'env');
    delete env[BASE_URL_VAR];
    delete env[MODEL_VAR];
    for (const authVar of AUTH_VARS) {
      delete env[authVar];
    }
    for (const [, envVar] of MODEL_MAPPINGS) {
      delete env[envVar];
    }
    for (const [key] of parseEnvLines(profile?.extras.extraEnv)) {
      delete env[key];
    }
    if (Object.keys(env).length === 0) {
      delete settings.env;
    }
    return { [SETTINGS]: stringifyJson(settings) };
  }

  backfill(profile: AdapterProfile, current: CurrentFiles): Partial<AdapterProfile> {
    const settings = safeParse(current[SETTINGS]);
    const env = settings.env;
    const authVar = this.authVar(profile);
    const apiKey = readString(env, authVar);
    return {
      baseUrl: readString(env, BASE_URL_VAR) || profile.baseUrl,
      model: readString(env, MODEL_VAR),
      apiKey: apiKey || profile.apiKey,
      extras: {
        ...profile.extras,
        ...Object.fromEntries(
          MODEL_MAPPINGS.map(([field, envVar]) => [field, readString(env, envVar)]),
        ),
      },
    };
  }

  private authVar(profile: AdapterProfile): string {
    const configured = profile.extras.authVar;
    return AUTH_VARS.includes(configured as (typeof AUTH_VARS)[number]) ? configured : AUTH_VARS[0];
  }
}

function safeParse(text: string | undefined): JsonObject {
  try {
    return parseJsonObject(text);
  } catch {
    return {};
  }
}

function parseEnvLines(raw: string | undefined): Array<[string, string]> {
  if (!raw) {
    return [];
  }
  const entries: Array<[string, string]> = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separator = trimmed.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    entries.push([trimmed.slice(0, separator).trim(), trimmed.slice(separator + 1).trim()]);
  }
  return entries;
}
