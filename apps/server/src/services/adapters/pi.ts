import { join } from 'node:path';
import {
  type CompletionProtocol,
  ERROR_CODES,
  type FieldSpec,
  type HarnessMode,
} from '@seaveyon/harness-switch-shared';
import { HttpError } from '../../common/errors';
import { BaseAdapter } from './base';
import { compact, type DetectedProfile, providerId, seedProfile, toCandidate } from './detect';
import { apiFieldProtocol } from './protocol';
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
  OfficialCapability,
  RenderedFiles,
} from './types';

const MODELS = 'models';
const SETTINGS = 'settings';
const AUTH = 'auth';
const DEFAULT_API = 'openai-completions';
const DEFAULT_CONTEXT = 200000;
const DEFAULT_MAX_TOKENS = 8192;

/**
 * Pi (command `pi`) loads custom providers from `~/.pi/agent/models.json`. A model stays
 * hidden until the provider has an `apiKey` (or auth.json / `--api-key`), which is why
 * an empty auth.json produces "No models available" even after a profile is activated.
 *
 * There is no provider-order list; `defaultProvider` / `defaultModel` in `settings.json`
 * select the active route. `PI_CODING_AGENT_DIR` overrides the config directory.
 *
 * `/login` stores credentials for Pi's built-in providers in `auth.json`, keyed by
 * provider id. That file is read here only to tell whether an official login exists; it
 * is never written.
 */
export class PiAdapter extends BaseAdapter implements HarnessAdapter {
  readonly id = 'pi' as const;
  readonly mode: HarnessMode = 'additive';
  readonly modelRequired = true;
  readonly envVarNames: string[] = [];
  readonly envNote = 'API key 直接写入 models.json，无需环境变量；运行时仍可用 --model 覆盖。';
  readonly envNoteCode = 'harness.field.pi.envNote';
  readonly officialNeedsCurrent = true;
  protected readonly requires = ['model', 'apiKey'] as const;

  official(current: CurrentFiles): OfficialCapability {
    return {
      kind: 'account-login',
      available: loggedInProviders(current[AUTH]).length > 0,
      titleCode: 'harness.official',
      hintCode: 'harness.officialHintPi',
    };
  }

  readonly fields: FieldSpec[] = [
    {
      key: 'providerId',
      labelCode: 'harness.field.providerId.label',
      kind: 'text',
      placeholderCode: 'harness.field.providerId.placeholder',
      helpCode: 'harness.field.pi.providerId.help',
    },
    {
      key: 'api',
      labelCode: 'harness.field.pi.api.label',
      kind: 'select',
      defaultValue: DEFAULT_API,
      options: [
        { value: 'openai-completions' },
        { value: 'openai-responses' },
        { value: 'anthropic-messages' },
      ],
    },
    {
      key: 'authHeader',
      labelCode: 'harness.field.pi.authHeader.label',
      kind: 'select',
      defaultValue: 'true',
      helpCode: 'harness.field.pi.authHeader.help',
      options: [
        { value: 'true', labelCode: 'harness.field.toggle.on' },
        { value: 'false', labelCode: 'harness.field.toggle.off' },
      ],
    },
    {
      key: 'contextWindow',
      labelCode: 'harness.field.contextLength.label',
      kind: 'text',
      defaultValue: String(DEFAULT_CONTEXT),
    },
    {
      key: 'maxTokens',
      labelCode: 'harness.field.maxTokens.label',
      kind: 'text',
      defaultValue: String(DEFAULT_MAX_TOKENS),
    },
    {
      key: 'reasoning',
      labelCode: 'harness.field.pi.reasoning.label',
      kind: 'select',
      defaultValue: 'false',
      helpCode: 'harness.field.pi.reasoning.help',
      options: [
        { value: 'false', labelCode: 'harness.field.toggle.off' },
        { value: 'true', labelCode: 'harness.field.toggle.on' },
      ],
    },
  ];

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
      {
        key: AUTH,
        label: 'auth.json（仅检测官方登录）',
        labelCode: 'harness.field.pi.target.auth',
        path: join(this.environment.harnessHomes.piAgent, 'auth.json'),
        format: 'json',
      },
    ];
  }

  envVars(): Record<string, string> {
    return {};
  }

  /** The `api` field is exactly the protocol Pi will call the provider over. */
  completionProtocol(profile: AdapterProfile): CompletionProtocol | undefined {
    return apiFieldProtocol(profile.extras.api, 'openai-chat');
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
    provider.api = profile.extras.api || DEFAULT_API;
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

  /**
   * Hand the startup choice back to Pi. Additive config keeps every custom provider in
   * models.json for the next switch; only the pointer moves, and only when it names a
   * custom provider — a built-in default the user picked themselves is left alone. With
   * no pointer Pi starts on the first model whose provider holds a credential, which is
   * what `/login` wrote. Without any such credential the switch would leave Pi with "No
   * models available", so it is refused.
   */
  renderOfficial(_profile: AdapterProfile | undefined, current: CurrentFiles): RenderedFiles {
    if (loggedInProviders(current[AUTH]).length === 0) {
      throw new HttpError(400, '未检测到 Pi 的官方登录凭据，请先在终端运行 pi 并完成 /login', {
        code: ERROR_CODES.officialLoginMissing,
        params: { harness: 'Pi' },
      });
    }
    if (current[SETTINGS] === undefined) {
      return {};
    }
    const settings = tryParseJsonObject(current[SETTINGS]);
    if (!settings) {
      return {};
    }
    const custom = customProviderIds(current[MODELS]);
    if (typeof settings.defaultProvider === 'string' && custom.has(settings.defaultProvider)) {
      delete settings.defaultProvider;
      delete settings.defaultModel;
    }
    return { [SETTINGS]: stringifyJson(settings) };
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

/**
 * Provider ids `/login` has stored a credential for. Every auth.json entry is an object
 * with a `type` (`api_key` or `oauth`); anything else is noise rather than a login.
 */
function loggedInProviders(auth: string | undefined): string[] {
  const parsed = auth === undefined ? undefined : tryParseJsonObject(auth);
  if (!parsed) {
    return [];
  }
  return Object.entries(parsed)
    .filter(([, entry]) => isPlainObject(entry) && typeof entry.type === 'string')
    .map(([id]) => id);
}

/** Provider ids models.json defines — the ones an official switch must move away from. */
function customProviderIds(models: string | undefined): Set<string> {
  const parsed = models === undefined ? undefined : tryParseJsonObject(models);
  const providers = parsed?.providers;
  return new Set(isPlainObject(providers) ? Object.keys(providers) : []);
}
