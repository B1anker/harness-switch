import { describe, expect, test } from 'bun:test';
import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';
import { ClaudeAdapter } from '../src/services/adapters/claude';
import { CodexAdapter } from '../src/services/adapters/codex';
import { DshAdapter } from '../src/services/adapters/dsh';
import { KimiAdapter } from '../src/services/adapters/kimi';
import { PiAdapter } from '../src/services/adapters/pi';
import type { AdapterProfile } from '../src/services/adapters/types';
import type { IEnvironmentService } from '../src/services/environment';

const environment = {
  harnessHomes: {
    claude: '/home/tester/.claude',
    codex: '/home/tester/.codex',
    kimiCode: '/home/tester/.kimi-code',
    piAgent: '/home/tester/.omp/agent',
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
        ANTHROPIC_DEFAULT_FABLE_MODEL: 'stale-fable',
      },
    });
    const settings = JSON.parse(
      adapter.render(
        profile({
          extras: {
            haikuModel: 'fast-model',
            sonnetModel: 'balanced-model',
            opusModel: 'strong-model',
            subagentModel: 'cheap-model',
          },
        }),
        { settings: current },
      ).settings,
    );

    expect(settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('fast-model');
    expect(settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('balanced-model');
    expect(settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('strong-model');
    expect(settings.env.ANTHROPIC_DEFAULT_FABLE_MODEL).toBeUndefined();
    expect(settings.env.CLAUDE_CODE_SUBAGENT_MODEL).toBe('cheap-model');
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
        sonnetModel: '',
        opusModel: '',
        fableModel: '',
        subagentModel: '',
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

  test('returns to official login while preserving OAuth material and other providers', () => {
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
    expect(config.model_providers?.['glm-main']).toBeUndefined();
    expect(config.model_providers?.keep?.base_url).toBe('https://keep');
    expect(auth.tokens.access_token).toBe('official');
    expect(auth.OPENAI_API_KEY).toBeUndefined();
  });

  test('official login also removes a drifted model_provider that is not the previous profile', () => {
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
    // Previous profile was via-env, but the pointer drifted to an orphan provider.
    const rendered = adapter.renderOfficial(profile({ name: 'via-env' }), current);
    const config = parseToml(rendered.config) as CodexConfig;

    expect(config.model_provider).toBeUndefined();
    expect(config.model_providers?.['via-env']).toBeUndefined();
    expect(config.model_providers?.['third-party']).toBeUndefined();
    expect(config.model_providers?.keep?.base_url).toBe('https://keep');
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
    expect(() => adapter.render(profile({ model: '' }), {})).toThrow(/模型名称/);
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
  const models = [
    '# hand written',
    'providers:',
    '  other:',
    '    baseUrl: https://other',
    '',
  ].join('\n');

  test('merges into models.yml while keeping comments and other providers', () => {
    const adapter = new PiAdapter(environment);
    const rendered = adapter.render(profile(), { models, config: 'theme: dark\n' });

    expect(rendered.models).toContain('# hand written');
    const parsed = parseYaml(rendered.models);
    expect(parsed.providers.other.baseUrl).toBe('https://other');
    expect(parsed.providers['glm-main'].apiKey).toBe('sk-new');
    expect(parsed.providers['glm-main'].authHeader).toBe(true);
    expect(parsed.providers['glm-main'].models[0].id).toBe('glm-4.6');

    const config = parseYaml(rendered.config);
    expect(config.theme).toBe('dark');
    expect(config.modelProviderOrder).toEqual(['glm-main']);
  });

  test('writes block style yaml when the file does not exist yet', () => {
    const adapter = new PiAdapter(environment);
    const rendered = adapter.render(profile(), {});

    // Seeding an empty document as `{}` would make every key flow style, which is
    // unreadable in a file people maintain by hand.
    expect(rendered.models).toContain('providers:');
    expect(rendered.models).not.toContain('{');
    expect(rendered.config).toBe('modelProviderOrder:\n  - glm-main\n');
  });

  test('revoking leaves absent files absent instead of creating empty ones', () => {
    const adapter = new PiAdapter(environment);
    expect(adapter.revoke(profile(), {})).toEqual({});
  });

  test('moves itself to the front of the provider order without dropping the rest', () => {
    const adapter = new PiAdapter(environment);
    const rendered = adapter.render(profile(), {
      models,
      config: 'modelProviderOrder:\n  - other\n  - glm-main\n',
    });
    expect(parseYaml(rendered.config).modelProviderOrder).toEqual(['glm-main', 'other']);
  });

  test('revoking drops its provider and its place in the order', () => {
    const adapter = new PiAdapter(environment);
    const activated = adapter.render(profile(), {
      models,
      config: 'modelProviderOrder:\n  - other\n',
    });
    const rendered = adapter.revoke(profile(), {
      models: activated.models,
      config: activated.config,
    });

    const parsed = parseYaml(rendered.models);
    expect(parsed.providers['glm-main']).toBeUndefined();
    expect(parsed.providers.other).toBeDefined();
    expect(parseYaml(rendered.config).modelProviderOrder).toEqual(['other']);
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
    expect(() => adapter.render(profile({ model: '' }), {})).toThrow(/模型名称/);
    expect(() => adapter.render(profile({ apiKey: '' }), {})).toThrow(/API key/);
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
