import { join } from 'node:path';
import type { CompletionProtocol, FieldSpec, HarnessMode } from '@seaveyon/harness-switch-shared';
import { BaseAdapter } from './base';
import { compact, type DetectedProfile, seedProfile, toCandidate } from './detect';
import {
  ensureObject,
  parseJsonObject,
  readString,
  stringifyJson,
  tryParseJsonObject,
} from './serialize';
import type {
  AdapterProfile,
  AdapterTarget,
  CurrentFiles,
  HarnessAdapter,
  OfficialCapability,
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
/**
 * One model tier Claude Code can be pointed at, and everything the form needs to render
 * it. The three fields per tier (id, display name, 1M flag) follow the same shape, so
 * they are generated from this table rather than written out fifteen times.
 */
type ModelMapping = {
  field: string;
  envVar: string;
  nameField?: string;
  nameEnvVar?: string;
  /** Absent for tiers whose models have no 1M variant, such as Haiku. */
  oneMField?: string;
  /** Tier name as it appears in labels and as the `role` catalog parameter. */
  role: string;
  /** Label of the model-id field; the tiers do not phrase it uniformly enough to derive. */
  label: string;
  /** Model id shown as the field's example placeholder. */
  example: string;
  /** Tiers Claude Code always resolves. The rest are newer or opt-in. */
  required?: boolean;
  /** Set when the model-id field needs its own help entry instead of the shared one. */
  help?: string;
  helpCode?: string;
  /** Set when the 1M toggle's role is prose rather than a tier name. */
  oneMLabelCode?: string;
};

const MODEL_MAPPINGS: readonly ModelMapping[] = [
  {
    field: 'haikuModel',
    envVar: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    nameField: 'haikuModelName',
    nameEnvVar: 'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME',
    role: 'Haiku',
    label: 'Haiku 模型映射',
    example: 'glm-5-air',
    required: true,
  },
  {
    field: 'sonnetModel',
    envVar: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
    nameField: 'sonnetModelName',
    nameEnvVar: 'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME',
    oneMField: 'sonnetModel1m',
    role: 'Sonnet',
    label: 'Sonnet 模型映射',
    example: 'glm-5',
    required: true,
  },
  {
    field: 'opusModel',
    envVar: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
    nameField: 'opusModelName',
    nameEnvVar: 'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME',
    oneMField: 'opusModel1m',
    role: 'Opus',
    label: 'Opus 模型映射',
    example: 'glm-5',
    required: true,
  },
  {
    field: 'fableModel',
    envVar: 'ANTHROPIC_DEFAULT_FABLE_MODEL',
    nameField: 'fableModelName',
    nameEnvVar: 'ANTHROPIC_DEFAULT_FABLE_MODEL_NAME',
    oneMField: 'fableModel1m',
    role: 'Fable',
    label: 'Fable 模型映射（可选）',
    example: 'glm-5',
    helpCode: 'harness.field.claude.fableModel.help',
  },
  {
    field: 'subagentModel',
    envVar: 'CLAUDE_CODE_SUBAGENT_MODEL',
    oneMField: 'subagentModel1m',
    role: '子代理',
    label: '子代理模型（可选）',
    example: 'glm-5-air',
    helpCode: 'harness.field.claude.subagentModel.help',
    oneMLabelCode: 'harness.field.claude.oneM.subagentLabel',
  },
];

const ONE_M_OPTIONS = [
  { value: 'false', labelCode: 'harness.field.toggle.off' },
  { value: 'true', labelCode: 'harness.field.toggle.on' },
];

/**
 * `role` is a model tier name (`Sonnet`, `Opus`, `Fable`) and reads the same in every
 * language, so it is interpolated into one shared catalog entry. The subagent row is the
 * exception — its role is prose — so it passes its own key instead of a `role` value.
 */
function oneMField(role: string, key: string, labelCode?: string): FieldSpec {
  return {
    key,
    labelCode: labelCode ?? 'harness.field.claude.oneM.label',
    ...(labelCode ? {} : { params: { role } }),
    kind: 'select',
    defaultValue: 'false',
    options: ONE_M_OPTIONS,
    helpCode: 'harness.field.claude.oneM.help',
  };
}

/**
 * The model-id field, its optional display-name companion and its optional 1M toggle,
 * in the order the form shows them.
 */
function tierFields(tier: ModelMapping): FieldSpec[] {
  const fields: FieldSpec[] = [
    {
      key: tier.field,
      labelCode: `harness.field.claude.${tier.field}.label`,
      kind: 'text',
      ...(tier.required ? { required: true } : {}),
      placeholderCode: 'harness.field.claude.example.placeholder',
      helpCode: tier.helpCode ?? 'harness.field.claude.modelMapping.help',
      // The shared help entry names the variable it writes; a tier with its own entry
      // already spells the variable out in its prose.
      params: tier.helpCode
        ? { value: tier.example }
        : { value: tier.example, envVar: tier.envVar },
    },
  ];
  if (tier.nameField && tier.nameEnvVar) {
    fields.push({
      key: tier.nameField,
      labelCode: `harness.field.claude.${tier.nameField}.label`,
      kind: 'text',
      placeholderCode: 'harness.field.claude.modelName.placeholder',
      helpCode: 'harness.field.claude.modelName.help',
      params: { role: tier.role, envVar: tier.nameEnvVar },
    });
  }
  if (tier.oneMField) {
    fields.push(oneMField(tier.role, tier.oneMField, tier.oneMLabelCode));
  }
  return fields;
}

/**
 * Claude Code reads the `env` block of settings.json itself, so a switch takes effect
 * without touching any shell. The settings value also wins over a variable inherited
 * from the shell, which is what makes this work for long-lived daemons that spawn
 * `claude` as a child process.
 */
export class ClaudeAdapter extends BaseAdapter implements HarnessAdapter {
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

  official(_current: CurrentFiles): OfficialCapability {
    return {
      kind: 'account-login',
      available: true,
      titleCode: 'harness.official',
      hintCode: 'harness.officialHintClaude',
    };
  }

  readonly fields: FieldSpec[] = [
    {
      key: 'authVar',
      labelCode: 'harness.field.claude.authVar.label',
      kind: 'select',
      defaultValue: 'ANTHROPIC_AUTH_TOKEN',
      helpCode: 'harness.field.claude.authVar.help',
      fullWidth: true,
      options: [
        {
          value: 'ANTHROPIC_AUTH_TOKEN',
          labelCode: 'harness.field.claude.authVar.option.authToken',
        },
        {
          value: 'ANTHROPIC_API_KEY',
          labelCode: 'harness.field.claude.authVar.option.official',
        },
      ],
    },
    ...MODEL_MAPPINGS.flatMap(tierFields),
    {
      key: 'extraEnv',
      labelCode: 'harness.field.claude.extraEnv.label',
      kind: 'textarea',
      placeholder: 'ANTHROPIC_DEFAULT_SONNET_MODEL=glm-5.2\nAPI_TIMEOUT_MS=3000000',
      helpCode: 'harness.field.claude.extraEnv.help',
    },
  ];

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

  /** Claude Code only ever speaks the Anthropic Messages API. */
  completionProtocol(): CompletionProtocol {
    return 'anthropic-messages';
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
      if (nameEnvVar) {
        delete env[nameEnvVar];
      }
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
    const settings = tryParseJsonObject(current[SETTINGS]) ?? {};
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
    const env = (tryParseJsonObject(current[SETTINGS]) ?? {}).env;
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
