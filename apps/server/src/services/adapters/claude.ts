import { join } from 'node:path';
import type { FieldSpec, HarnessMode } from '@seaveyon/harness-switch-shared';
import type { IEnvironmentService } from '../environment';
import { compact, type DetectedProfile, seedProfile, toCandidate } from './detect';
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
/**
 * Claude Code reads `[1m]` at the end of a pinned model id as "this model has a 1M
 * context window" and strips the suffix before calling the provider. It is a capability
 * declaration for the local session, not part of the model name, so it is kept as a
 * separate flag per tier instead of being typed into the model field.
 */
const ONE_M_SUFFIX = '[1m]';
type ModelMapping = {
  field: string;
  envVar: string;
  nameField?: string;
  nameEnvVar?: string;
  /** Absent for tiers whose models have no 1M variant, such as Haiku. */
  oneMField?: string;
};
const MODEL_MAPPINGS: readonly ModelMapping[] = [
  {
    field: 'haikuModel',
    envVar: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    nameField: 'haikuModelName',
    nameEnvVar: 'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME',
  },
  {
    field: 'sonnetModel',
    envVar: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
    nameField: 'sonnetModelName',
    nameEnvVar: 'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME',
    oneMField: 'sonnetModel1m',
  },
  {
    field: 'opusModel',
    envVar: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
    nameField: 'opusModelName',
    nameEnvVar: 'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME',
    oneMField: 'opusModel1m',
  },
  {
    field: 'fableModel',
    envVar: 'ANTHROPIC_DEFAULT_FABLE_MODEL',
    nameField: 'fableModelName',
    nameEnvVar: 'ANTHROPIC_DEFAULT_FABLE_MODEL_NAME',
    oneMField: 'fableModel1m',
  },
  { field: 'subagentModel', envVar: 'CLAUDE_CODE_SUBAGENT_MODEL', oneMField: 'subagentModel1m' },
];

const ONE_M_OPTIONS = [
  { value: 'false', label: '关闭' },
  { value: 'true', label: '开启' },
];

function oneMField(role: string, key: string): FieldSpec {
  return {
    key,
    label: `${role} 声明支持 1M`,
    kind: 'select',
    defaultValue: 'false',
    options: ONE_M_OPTIONS,
    help: '在模型 ID 末尾追加 [1m]，向 Claude Code 声明 1M 上下文；Claude Code 请求上游前会去掉该后缀。仅在该模型确实支持 1M 时开启。',
  };
}

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
    ...MODEL_MAPPINGS.flatMap(({ envVar, nameEnvVar }) =>
      nameEnvVar ? [envVar, nameEnvVar] : [envVar],
    ),
  ];

  readonly fields: FieldSpec[] = [
    {
      key: 'authVar',
      label: '凭据变量',
      kind: 'select',
      defaultValue: 'ANTHROPIC_AUTH_TOKEN',
      help: '第三方中转通常要求 ANTHROPIC_AUTH_TOKEN；官方 API key 用 ANTHROPIC_API_KEY。',
      fullWidth: true,
      options: [
        { value: 'ANTHROPIC_AUTH_TOKEN', label: 'ANTHROPIC_AUTH_TOKEN（第三方中转）' },
        { value: 'ANTHROPIC_API_KEY', label: 'ANTHROPIC_API_KEY（官方）' },
      ],
    },
    {
      key: 'haikuModel',
      label: 'Haiku 模型映射',
      kind: 'text',
      required: true,
      placeholder: '例如：glm-5-air',
      help: '写入 ANTHROPIC_DEFAULT_HAIKU_MODEL。',
    },
    {
      key: 'haikuModelName',
      label: 'Haiku 显示名称（选填）',
      kind: 'text',
      placeholder: '留空则使用 Haiku 模型 ID',
      help: '写入 ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME；留空时 Claude Code 默认显示对应模型 ID。',
    },
    {
      key: 'sonnetModel',
      label: 'Sonnet 模型映射',
      kind: 'text',
      required: true,
      placeholder: '例如：glm-5',
      help: '写入 ANTHROPIC_DEFAULT_SONNET_MODEL。',
    },
    {
      key: 'sonnetModelName',
      label: 'Sonnet 显示名称（选填）',
      kind: 'text',
      placeholder: '留空则使用 Sonnet 模型 ID',
      help: '写入 ANTHROPIC_DEFAULT_SONNET_MODEL_NAME；留空时 Claude Code 默认显示对应模型 ID。',
    },
    oneMField('Sonnet', 'sonnetModel1m'),
    {
      key: 'opusModel',
      label: 'Opus 模型映射',
      kind: 'text',
      required: true,
      placeholder: '例如：glm-5',
      help: '写入 ANTHROPIC_DEFAULT_OPUS_MODEL。',
    },
    {
      key: 'opusModelName',
      label: 'Opus 显示名称（选填）',
      kind: 'text',
      placeholder: '留空则使用 Opus 模型 ID',
      help: '写入 ANTHROPIC_DEFAULT_OPUS_MODEL_NAME；留空时 Claude Code 默认显示对应模型 ID。',
    },
    oneMField('Opus', 'opusModel1m'),
    {
      key: 'fableModel',
      label: 'Fable 模型映射（可选）',
      kind: 'text',
      placeholder: '例如：glm-5',
      help: '写入 ANTHROPIC_DEFAULT_FABLE_MODEL；用于支持 Fable 档位的新版 Claude Code。',
    },
    {
      key: 'fableModelName',
      label: 'Fable 显示名称（选填）',
      kind: 'text',
      placeholder: '留空则使用 Fable 模型 ID',
      help: '写入 ANTHROPIC_DEFAULT_FABLE_MODEL_NAME；留空时 Claude Code 默认显示对应模型 ID。',
    },
    oneMField('Fable', 'fableModel1m'),
    {
      key: 'subagentModel',
      label: '子代理模型（可选）',
      kind: 'text',
      placeholder: '例如：glm-5-air',
      help: '写入 CLAUDE_CODE_SUBAGENT_MODEL，可让子代理使用更快或成本更低的模型。',
    },
    oneMField('子代理', 'subagentModel1m'),
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
    for (const { field, envVar, nameField, nameEnvVar, oneMField: flagField } of MODEL_MAPPINGS) {
      if (profile.extras[field]) {
        vars[envVar] = withOneM(profile.extras[field], profile.extras[flagField ?? '']);
      }
      if (nameField && nameEnvVar && profile.extras[nameField]) {
        vars[nameEnvVar] = profile.extras[nameField];
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

    for (const { field, envVar, nameField, nameEnvVar, oneMField: flagField } of MODEL_MAPPINGS) {
      const value = profile.extras[field]?.trim();
      if (value) {
        env[envVar] = withOneM(value, profile.extras[flagField ?? '']);
      } else {
        delete env[envVar];
      }
      if (nameField && nameEnvVar) {
        const name = profile.extras[nameField]?.trim();
        if (name) {
          env[nameEnvVar] = name;
        } else {
          delete env[nameEnvVar];
        }
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
    for (const { envVar, nameEnvVar } of MODEL_MAPPINGS) {
      delete env[envVar];
      if (nameEnvVar) delete env[nameEnvVar];
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
          MODEL_MAPPINGS.flatMap(
            ({ field, envVar, nameField, nameEnvVar, oneMField: flagField }) => {
              const value = readString(env, envVar);
              return [
                [field, withoutOneM(value)],
                ...(nameField && nameEnvVar ? [[nameField, readString(env, nameEnvVar)]] : []),
                ...(flagField
                  ? [[flagField, value.endsWith(ONE_M_SUFFIX) ? 'true' : 'false']]
                  : []),
              ];
            },
          ),
        ),
      },
    };
  }

  /**
   * Claude Code holds exactly one routing in the `env` block, so a scan yields at most
   * one candidate. Which credential variable is present also tells us which one the user
   * chose, and backfill needs that seeded before it can find the key.
   */
  detect(current: CurrentFiles): DetectedProfile[] {
    const env = safeParse(current[SETTINGS]).env;
    const authVar = AUTH_VARS.find((name) => readString(env, name)) ?? AUTH_VARS[0];
    const seed = seedProfile({ authVar });
    return compact([toCandidate('claude', seed, this.backfill(seed, current), true)]);
  }

  private authVar(profile: AdapterProfile): string {
    const configured = profile.extras.authVar;
    return AUTH_VARS.includes(configured as (typeof AUTH_VARS)[number]) ? configured : AUTH_VARS[0];
  }
}

function withOneM(value: string, enabled: string | undefined): string {
  const model = withoutOneM(value.trim());
  return enabled === 'true' && model ? `${model}${ONE_M_SUFFIX}` : model;
}

function withoutOneM(value: string): string {
  return value.endsWith(ONE_M_SUFFIX) ? value.slice(0, -ONE_M_SUFFIX.length) : value;
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
