import { describe, expect, test } from 'bun:test';
import { ERROR_CODES } from '@seaveyon/harness-switch-shared';
import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';
import { ClaudeAdapter } from '../src/services/adapters/claude';
import { CodexAdapter } from '../src/services/adapters/codex';
import { DshAdapter } from '../src/services/adapters/dsh';
import { KimiAdapter } from '../src/services/adapters/kimi';
import { PiAdapter } from '../src/services/adapters/pi';
import type { AdapterProfile } from '../src/services/adapters/types';
import type { IEnvironmentService } from '../src/services/environment';
import { expectHttpError } from './support/http-error';

const environment = {
  harnessHomes: {
    claude: '/home/tester/.claude',
    codex: '/home/tester/.codex',
    kimiCode: '/home/tester/.kimi-code',
    piAgent: '/home/tester/.pi/agent',
    dsh: '/home/tester/.dsh',
  },
} as IEnvironmentService;

type ProviderTable = Record<string, Record<string, unknown>>;

type CodexConfig = {
  model?: string;
  model_provider?: string;
  model_reasoning_effort?: string;
  model_providers?: ProviderTable;
};

type KimiConfig = {
  default_model?: string;
  providers?: ProviderTable;
  models?: ProviderTable;
};

function idOf(config: string): string | undefined {
  return (parseToml(config) as KimiConfig).default_model;
}

function profile(overrides: Partial<AdapterProfile> = {}): AdapterProfile {
  return {
    name: 'glm-main',
    baseUrl: 'https://api.z.ai/api/anthropic',
    apiKey: 'sk-new',
    model: 'glm-4.6',
    extras: {},
    ...overrides,
  };
}

describe('claude adapter', () => {
  test('writes the auth token variant and keeps unrelated settings', () => {
    const adapter = new ClaudeAdapter(environment);
    const current = JSON.stringify({
      permissions: { allow: ['Bash'] },
      env: { ANTHROPIC_API_KEY: 'sk-old', UNRELATED: 'keep' },
    });

    const settings = JSON.parse(adapter.render(profile(), { settings: current }).settings);

    expect(settings.permissions).toEqual({ allow: ['Bash'] });
    expect(settings.env.UNRELATED).toBe('keep');
    expect(settings.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-new');
    expect(settings.env.ANTHROPIC_BASE_URL).toBe('https://api.z.ai/api/anthropic');
    // Leaving the previous credential variable behind makes Claude Code pick the wrong one.
    expect(settings.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  test('honours the official api key variant', () => {
    const adapter = new ClaudeAdapter(environment);
    const rendered = adapter.render(profile({ extras: { authVar: 'ANTHROPIC_API_KEY' } }), {});
    const settings = JSON.parse(rendered.settings);
    expect(settings.env.ANTHROPIC_API_KEY).toBe('sk-new');
    expect(settings.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });

  test('drops a stale model instead of leaving the previous one behind', () => {
    const adapter = new ClaudeAdapter(environment);
    const current = JSON.stringify({ env: { ANTHROPIC_MODEL: 'claude-sonnet-4-5' } });
    const settings = JSON.parse(
      adapter.render(profile({ model: '' }), { settings: current }).settings,
    );
    expect(settings.env.ANTHROPIC_MODEL).toBeUndefined();
  });

  test('writes each Claude model tier independently and clears stale mappings', () => {
    const adapter = new ClaudeAdapter(environment);
    const current = JSON.stringify({
      env: {
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'stale-haiku',
        ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME: 'Stale Fast',
        ANTHROPIC_DEFAULT_FABLE_MODEL: 'stale-fable',
        ANTHROPIC_DEFAULT_FABLE_MODEL_NAME: 'Stale Latest',
      },
    });
    const settings = JSON.parse(
      adapter.render(
        profile({
          extras: {
            haikuModel: 'fast-model',
            haikuModelName: 'Fast',
            sonnetModel: 'balanced-model',
            sonnetModelName: 'Balanced',
            opusModel: 'strong-model',
            opusModelName: 'Powerful',
            subagentModel: 'cheap-model',
          },
        }),
        { settings: current },
      ).settings,
    );

    expect(settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('fast-model');
    expect(settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME).toBe('Fast');
    expect(settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('balanced-model');
    expect(settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME).toBe('Balanced');
    expect(settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('strong-model');
    expect(settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME).toBe('Powerful');
    expect(settings.env.ANTHROPIC_DEFAULT_FABLE_MODEL).toBeUndefined();
    expect(settings.env.ANTHROPIC_DEFAULT_FABLE_MODEL_NAME).toBeUndefined();
    expect(settings.env.CLAUDE_CODE_SUBAGENT_MODEL).toBe('cheap-model');
  });

  test('adds a 1M suffix exactly when the model tier opts in', () => {
    const adapter = new ClaudeAdapter(environment);
    const settings = JSON.parse(
      adapter.render(
        profile({
          extras: {
            sonnetModel: 'gateway-sonnet[1m]',
            sonnetModel1m: 'true',
            opusModel: 'gateway-opus[1m]',
            opusModel1m: 'false',
          },
        }),
        {},
      ).settings,
    );

    expect(settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('gateway-sonnet[1m]');
    expect(settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('gateway-opus');
  });

  test('leaves display names unset so Claude Code defaults to each model id', () => {
    const adapter = new ClaudeAdapter(environment);
    const current = JSON.stringify({
      env: { ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: 'Stale name' },
    });
    const settings = JSON.parse(
      adapter.render(
        profile({
          extras: {
            sonnetModel: 'gateway-sonnet-model',
            sonnetModelName: '',
          },
        }),
        { settings: current },
      ).settings,
    );

    expect(settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('gateway-sonnet-model');
    expect(settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME).toBeUndefined();
  });

  test('merges extra env lines and ignores comments', () => {
    const adapter = new ClaudeAdapter(environment);
    const extras = { extraEnv: '# comment\nAPI_TIMEOUT_MS=3000000\n\nbroken-line\n' };
    const settings = JSON.parse(adapter.render(profile({ extras }), {}).settings);
    expect(settings.env.API_TIMEOUT_MS).toBe('3000000');
    expect(Object.keys(settings.env)).not.toContain('broken-line');
  });

  test('recovers hand edits made in the live file', () => {
    const adapter = new ClaudeAdapter(environment);
    const current = JSON.stringify({
      env: { ANTHROPIC_BASE_URL: 'https://edited', ANTHROPIC_AUTH_TOKEN: 'sk-edited' },
    });
    expect(adapter.backfill(profile(), { settings: current })).toEqual({
      baseUrl: 'https://edited',
      model: '',
      apiKey: 'sk-edited',
      extras: {
        haikuModel: '',
        haikuModelName: '',
        sonnetModel: '',
        sonnetModelName: '',
        sonnetModel1m: 'false',
        opusModel: '',
        opusModelName: '',
        opusModel1m: 'false',
        fableModel: '',
        fableModelName: '',
        fableModel1m: 'false',
        subagentModel: '',
        subagentModel1m: 'false',
      },
    });
  });

  test('returns to official login without removing unrelated Claude settings', () => {
    const adapter = new ClaudeAdapter(environment);
    const current = JSON.stringify({
      permissions: { allow: ['Bash'] },
      env: {
        ANTHROPIC_BASE_URL: 'https://relay.example.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-third-party',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'relay-model',
        API_TIMEOUT_MS: '3000000',
        UNRELATED: 'keep',
      },
    });
    const rendered = adapter.renderOfficial(
      profile({ extras: { extraEnv: 'API_TIMEOUT_MS=3000000' } }),
      { settings: current },
    );
    const settings = JSON.parse(rendered.settings);

    expect(settings.permissions).toEqual({ allow: ['Bash'] });
    expect(settings.env).toEqual({ UNRELATED: 'keep' });
  });
});

describe('codex adapter', () => {
  test('keeps other providers and points the pointer at itself', () => {
    const adapter = new CodexAdapter(environment);
    const current = '[model_providers.openai]\nname = "OpenAI"\n';
    const config = parseToml(adapter.render(profile(), { config: current }).config) as CodexConfig;

    expect(config.model_provider).toBe('glm-main');
    expect(config.model_providers?.openai?.name).toBe('OpenAI');
    expect(config.model_providers?.['glm-main']?.base_url).toBe('https://api.z.ai/api/anthropic');
    expect(config.model_providers?.['glm-main']?.wire_api).toBe('responses');
  });

  test('does not touch auth.json in the default mode', () => {
    const adapter = new CodexAdapter(environment);
    const rendered = adapter.render(profile(), {});
    expect(Object.keys(rendered)).toEqual(['config']);
    const config = parseToml(rendered.config) as CodexConfig;
    expect(config.model_providers?.['glm-main']?.experimental_bearer_token).toBe('sk-new');
  });

  test('writes auth.json only when that mode is chosen and clears the other auth keys', () => {
    const adapter = new CodexAdapter(environment);
    const current =
      '[model_providers.glm-main]\nexperimental_bearer_token = "sk-old"\nenv_key = "OPENAI_API_KEY"\n';
    const rendered = adapter.render(profile({ extras: { authMode: 'openai_auth' } }), {
      config: current,
      auth: JSON.stringify({ tokens: { refresh_token: 'keep-me' } }),
    });

    const config = parseToml(rendered.config) as CodexConfig;
    const provider = config.model_providers?.['glm-main'] ?? {};
    expect(provider.requires_openai_auth).toBe(true);
    // requires_openai_auth makes Codex ignore env_key, so stale keys would misroute silently.
    expect(provider.env_key).toBeUndefined();
    expect(provider.experimental_bearer_token).toBeUndefined();

    const auth = JSON.parse(rendered.auth ?? '{}');
    expect(auth.OPENAI_API_KEY).toBe('sk-new');
    expect(auth.tokens.refresh_token).toBe('keep-me');
  });

  test('renames provider ids that Codex reserves for itself', () => {
    const adapter = new CodexAdapter(environment);
    for (const reserved of [
      'openai',
      'ollama',
      'lmstudio',
      'amazon-bedrock',
      'oss',
      'ollama-chat',
    ]) {
      const rendered = adapter.render(profile({ extras: { providerId: reserved } }), {});
      const config = parseToml(rendered.config) as CodexConfig;
      expect(config.model_provider).toBe(`${reserved}-hsw`);
    }
  });

  test('returns to official login by dropping every custom provider and third-party key', () => {
    const adapter = new CodexAdapter(environment);
    const current = {
      config:
        'model = "third-party-model"\nmodel_provider = "glm-main"\n[model_providers.glm-main]\nbase_url = "https://relay"\n[model_providers.keep]\nbase_url = "https://keep"\n',
      auth: '{"tokens":{"access_token":"official"},"OPENAI_API_KEY":"sk-third-party"}',
    };
    const rendered = adapter.renderOfficial(
      profile({ extras: { authMode: 'openai_auth' } }),
      current,
    );
    const config = parseToml(rendered.config) as CodexConfig;
    const auth = JSON.parse(rendered.auth);

    expect(config.model).toBeUndefined();
    expect(config.model_provider).toBeUndefined();
    expect(config.model_providers).toBeUndefined();
    expect(auth.tokens.access_token).toBe('official');
    expect(auth.OPENAI_API_KEY).toBeUndefined();
  });

  test('official login removes leftover OpenRouter providers even if they were not the previous profile', () => {
    const adapter = new CodexAdapter(environment);
    const current = {
      config: [
        'model_provider = "third-party"',
        '[model_providers.via-env]',
        'base_url = "https://openrouter.ai/api/v1"',
        '[model_providers.third-party]',
        'base_url = "https://openrouter.ai/api/v1"',
        'requires_openai_auth = true',
        '[model_providers.keep]',
        'base_url = "https://keep"',
        '',
      ].join('\n'),
    };
    const rendered = adapter.renderOfficial(profile({ name: 'via-env' }), current);
    const config = parseToml(rendered.config) as CodexConfig;

    expect(config.model_provider).toBeUndefined();
    expect(config.model_providers).toBeUndefined();
  });

  test('strips OPENAI_API_KEY from auth.json even without a previous openai_auth profile', () => {
    const adapter = new CodexAdapter(environment);
    const rendered = adapter.renderOfficial(undefined, {
      config: 'model_provider = "via-env"\n',
      auth: '{"tokens":{"refresh_token":"keep"},"OPENAI_API_KEY":"sk-or"}',
    });
    const auth = JSON.parse(rendered.auth ?? '{}');

    expect(auth.tokens.refresh_token).toBe('keep');
    expect(auth.OPENAI_API_KEY).toBeUndefined();
    expect(Object.keys(rendered)).toEqual(['config', 'auth']);
  });

  test('reconciling official login with no previous profile still clears the active provider', () => {
    const adapter = new CodexAdapter(environment);
    const current = {
      config: [
        'model_provider = "third-party"',
        '[model_providers.third-party]',
        'base_url = "https://openrouter.ai/api/v1"',
        'requires_openai_auth = true',
        '',
      ].join('\n'),
    };
    const rendered = adapter.renderOfficial(undefined, current);
    const config = parseToml(rendered.config) as CodexConfig;

    expect(config.model_provider).toBeUndefined();
    expect(config.model_providers).toBeUndefined();
  });
});

describe('kimi adapter', () => {
  const existing = [
    '[providers.other]',
    'type = "kimi"',
    'base_url = "https://other"',
    'api_key = "sk-other"',
    '',
    '[models.other]',
    'provider = "other"',
    'model = "kimi-k2"',
    'max_context_size = 100',
    '',
    'default_model = "other"',
    '',
  ].join('\n');

  test('adds itself without destroying providers the user wrote by hand', () => {
    const adapter = new KimiAdapter(environment);
    const config = parseToml(adapter.render(profile(), { config: existing }).config) as KimiConfig;

    expect(config.providers?.other?.api_key).toBe('sk-other');
    expect(config.models?.other?.model).toBe('kimi-k2');
    expect(config.providers?.['glm-main']?.base_url).toBe('https://api.z.ai/api/anthropic');
    expect(config.models?.['glm-main']?.max_context_size).toBe(262144);
    expect(config.default_model).toBe('glm-main');
  });

  test('rejects a profile without a model because the models entry needs one', () => {
    const adapter = new KimiAdapter(environment);
    expectHttpError(
      () => adapter.render(profile({ model: '' }), {}),
      ERROR_CODES.adapterModelRequired,
      400,
    );
  });

  test('revoking leaves an absent config file absent', () => {
    const adapter = new KimiAdapter(environment);
    expect(adapter.revoke(profile(), {})).toEqual({});
  });

  test('revoking removes only its own entries and repoints the default', () => {
    const adapter = new KimiAdapter(environment);
    const activated = adapter.render(profile(), { config: existing }).config;
    const config = parseToml(adapter.revoke(profile(), { config: activated }).config) as KimiConfig;

    expect(config.providers?.['glm-main']).toBeUndefined();
    expect(config.models?.['glm-main']).toBeUndefined();
    expect(config.providers?.other).toBeDefined();
    expect(config.default_model).toBe('other');
  });

  test('normalises dots out of ids, since TOML would read them as nested tables', () => {
    const adapter = new KimiAdapter(environment);
    const rendered = adapter.render(profile({ extras: { providerId: 'gpt-4.1' } }), {}).config;
    const config = parseToml(rendered) as KimiConfig;

    expect(config.default_model).toBe('gpt-4-1');
    expect(config.models?.['gpt-4-1']).toBeDefined();
    expect(rendered).not.toContain('[models.gpt-4.1]');
  });
});

describe('pi adapter', () => {
  const models = JSON.stringify(
    {
      providers: {
        other: { baseUrl: 'https://other' },
      },
    },
    null,
    2,
  );

  test('targets the official pi agent JSON files', () => {
    const adapter = new PiAdapter(environment);
    expect(adapter.targets().map((target) => [target.key, target.path, target.format])).toEqual([
      ['models', '/home/tester/.pi/agent/models.json', 'json'],
      ['settings', '/home/tester/.pi/agent/settings.json', 'json'],
    ]);
  });

  test('merges into models.json while keeping other providers', () => {
    const adapter = new PiAdapter(environment);
    const rendered = adapter.render(profile(), {
      models,
      settings: JSON.stringify({ lastChangelogVersion: '0.84.2', theme: 'dark' }),
    });

    const parsed = JSON.parse(rendered.models);
    expect(parsed.providers.other.baseUrl).toBe('https://other');
    expect(parsed.providers['glm-main'].apiKey).toBe('sk-new');
    expect(parsed.providers['glm-main'].authHeader).toBe(true);
    expect(parsed.providers['glm-main'].models[0].id).toBe('glm-4.6');
    expect(parsed.providers['glm-main'].models[0].reasoning).toBeUndefined();

    const settings = JSON.parse(rendered.settings);
    expect(settings.lastChangelogVersion).toBe('0.84.2');
    expect(settings.theme).toBe('dark');
    expect(settings.defaultProvider).toBe('glm-main');
    expect(settings.defaultModel).toBe('glm-4.6');
  });

  test('writes json when the file does not exist yet', () => {
    const adapter = new PiAdapter(environment);
    const rendered = adapter.render(profile(), {});

    expect(JSON.parse(rendered.models).providers['glm-main'].baseUrl).toBe(
      'https://api.z.ai/api/anthropic',
    );
    expect(JSON.parse(rendered.settings)).toEqual({
      defaultProvider: 'glm-main',
      defaultModel: 'glm-4.6',
    });
  });

  test('marks reasoning models so pi exposes thinking levels', () => {
    const adapter = new PiAdapter(environment);
    const rendered = adapter.render(
      profile({ extras: { api: 'openai-responses', reasoning: 'true' } }),
      {},
    );
    const parsed = JSON.parse(rendered.models);
    expect(parsed.providers['glm-main'].api).toBe('openai-responses');
    expect(parsed.providers['glm-main'].models[0].reasoning).toBe(true);
  });

  test('revoking leaves absent files absent instead of creating empty ones', () => {
    const adapter = new PiAdapter(environment);
    expect(adapter.revoke(profile(), {})).toEqual({});
  });

  test('revoking drops its provider and clears the default when it was selected', () => {
    const adapter = new PiAdapter(environment);
    const activated = adapter.render(profile(), {
      models,
      settings: JSON.stringify({ defaultProvider: 'other', defaultModel: 'keep-me' }),
    });
    const rendered = adapter.revoke(profile(), {
      models: activated.models,
      settings: activated.settings,
    });

    const parsed = JSON.parse(rendered.models);
    expect(parsed.providers['glm-main']).toBeUndefined();
    expect(parsed.providers.other).toBeDefined();
    expect(JSON.parse(rendered.settings).defaultProvider).toBeUndefined();
    expect(JSON.parse(rendered.settings).defaultModel).toBeUndefined();
  });

  test('requires an api key because pi hides keyless custom models', () => {
    const adapter = new PiAdapter(environment);
    expectHttpError(
      () => adapter.render(profile({ apiKey: '' }), {}),
      ERROR_CODES.adapterApiKeyRequired,
      400,
    );
  });
});

describe('dsh adapter', () => {
  const settings = [
    '# keep this comment',
    'ui-theme:',
    '  theme: dark',
    'llm-pi-ai:',
    '  providers:',
    '    other:',
    '      baseURL: https://other.example/v1',
    '',
  ].join('\n');

  test('registers and selects a route while keeping unrelated settings', () => {
    const adapter = new DshAdapter(environment);
    const rendered = adapter.render(
      profile({
        name: 'CLIProxy Main',
        baseUrl: 'https://api.seavey.ai/cliproxy/v1',
        model: 'gpt-5.6-sol',
        extras: { api: 'openai-responses', contextWindow: '262144', maxTokens: '32768' },
      }),
      { settings, credentials: 'OTHER_API_KEY: keep\n' },
    );

    expect(rendered.settings).toContain('# keep this comment');
    const parsedSettings = parseYaml(rendered.settings);
    const route = parsedSettings['llm-pi-ai'].providers['cliproxy-main'];
    expect(parsedSettings['ui-theme'].theme).toBe('dark');
    expect(parsedSettings['llm-pi-ai'].providers.other).toBeDefined();
    expect(parsedSettings['agent-default-model']).toEqual({
      provider: 'cliproxy-main',
      model: 'gpt-5.6-sol',
    });
    expect(route.apiKeyEnv).toBe('CLIPROXY_MAIN_API_KEY');
    expect(route.api).toBe('openai-responses');
    expect(route.baseURL).toBe('https://api.seavey.ai/cliproxy/v1');
    expect(route.models[0]).toEqual({
      id: 'gpt-5.6-sol',
      name: 'gpt-5.6-sol',
      contextWindow: 262144,
      maxTokens: 32768,
    });

    expect(parseYaml(rendered.credentials)).toEqual({
      OTHER_API_KEY: 'keep',
      CLIPROXY_MAIN_API_KEY: 'sk-new',
    });
  });

  test('revokes only the managed route and credential', () => {
    const adapter = new DshAdapter(environment);
    const selected = adapter.render(profile(), {
      settings,
      credentials: 'OTHER_API_KEY: keep\n',
    });
    const rendered = adapter.revoke(profile(), selected);
    const parsedSettings = parseYaml(rendered.settings);

    expect(parsedSettings['llm-pi-ai'].providers['glm-main']).toBeUndefined();
    expect(parsedSettings['llm-pi-ai'].providers.other).toBeDefined();
    expect(parsedSettings['agent-default-model']).toBeUndefined();
    expect(parseYaml(rendered.credentials)).toEqual({ OTHER_API_KEY: 'keep' });
  });

  test('recovers hand edits from both DSH documents', () => {
    const adapter = new DshAdapter(environment);
    const rendered = adapter.render(profile(), {});
    const edited = parseYaml(rendered.settings);
    edited['llm-pi-ai'].providers['glm-main'].baseURL = 'https://edited.example/v1';
    edited['llm-pi-ai'].providers['glm-main'].models[0].id = 'edited-model';
    edited['llm-pi-ai'].providers['glm-main'].models[0].contextWindow = 128000;

    expect(
      adapter.backfill(profile(), {
        settings: `${JSON.stringify(edited)}\n`,
        credentials: 'GLM_MAIN_API_KEY: sk-edited\n',
      }),
    ).toMatchObject({
      baseUrl: 'https://edited.example/v1',
      apiKey: 'sk-edited',
      model: 'edited-model',
      extras: { contextWindow: '128000' },
    });
  });

  test('rejects an empty model or key', () => {
    const adapter = new DshAdapter(environment);
    expectHttpError(
      () => adapter.render(profile({ model: '' }), {}),
      ERROR_CODES.adapterModelRequired,
      400,
    );
    expectHttpError(
      () => adapter.render(profile({ apiKey: '' }), {}),
      ERROR_CODES.adapterApiKeyRequired,
      400,
    );
  });

  test('declares selectable reasoning efforts for hand-written models', () => {
    const adapter = new DshAdapter(environment);
    const rendered = adapter.render(
      profile({ extras: { reasoningEfforts: 'low,medium,high,xhigh,max' } }),
      {},
    );
    const model = parseYaml(rendered.settings)['llm-pi-ai'].providers['glm-main'].models[0];

    expect(model.reasoningEfforts).toEqual({
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: 'max',
    });
  });
});

describe('provider ids', () => {
  test('names without ascii letters still get distinct ids', () => {
    const adapter = new KimiAdapter(environment);
    const first = adapter.render(profile({ name: '主力' }), {}).config;
    const second = adapter.render(profile({ name: '备用' }), {}).config;

    expect(idOf(first)).toStartWith('provider-');
    expect(idOf(first)).not.toBe(idOf(second));
  });
});
