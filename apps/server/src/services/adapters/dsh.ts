import { join } from 'node:path';
import type { FieldSpec, HarnessMode } from '@seaveyon/harness-switch-shared';
import { ERROR_CODES } from '@seaveyon/harness-switch-shared';
import { HttpError } from '../../common/errors';
import type { IEnvironmentService } from '../environment';
import { compact, type DetectedProfile, seedProfile, toCandidate } from './detect';
import { parseYamlDocument, slugify } from './serialize';
import type {
  AdapterProfile,
  AdapterTarget,
  CurrentFiles,
  HarnessAdapter,
  RenderedFiles,
} from './types';

const SETTINGS = 'settings';
const CREDENTIALS = 'credentials';
const DEFAULT_CONTEXT = 262144;
const DEFAULT_MAX_TOKENS = 32768;

/**
 * DeepSeek Harness keeps custom routes in the `llm-pi-ai` settings namespace and
 * stores their referenced secrets separately. The deployment default lives in the
 * `agent-default-model` namespace, so activating a profile both registers its route
 * and selects it for newly created sessions.
 */
export class DshAdapter implements HarnessAdapter {
  readonly id = 'dsh' as const;
  readonly mode: HarnessMode = 'additive';
  readonly modelRequired = true;
  readonly envVarNames: string[] = [];
  readonly envNote = 'API key 安全写入 DSH 的 .credentials.yaml，并由 settings.yaml 引用。';

  readonly fields: FieldSpec[] = [
    {
      key: 'providerType',
      label: '提供方类型',
      kind: 'select',
      defaultValue: 'custom',
      options: [
        { value: 'custom', label: '自定义提供方' },
        { value: 'official', label: 'DeepSeek 官方' },
      ],
    },
    {
      key: 'providerId',
      label: 'Provider ID（可选）',
      kind: 'text',
      placeholder: '默认取配置名称',
      help: 'DSH 的模型路由标识；必须以小写字母开头。',
    },
    {
      key: 'models',
      label: '模型目录（可选）',
      kind: 'textarea',
      fullWidth: true,
      placeholder: '每行一个模型 ID；留空时只注册上方的默认模型',
      help: '一个提供方可注册多个模型；上方“模型”作为新会话的默认模型。',
    },
    {
      key: 'api',
      label: 'API 协议',
      kind: 'select',
      defaultValue: 'openai-responses',
      options: [
        { value: 'openai-responses', label: 'openai-responses' },
        { value: 'openai-completions', label: 'openai-completions' },
        { value: 'anthropic-messages', label: 'anthropic-messages' },
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
      key: 'reasoningEfforts',
      label: '支持的思考程度',
      kind: 'select',
      defaultValue: '',
      help: 'DSH 只会显示这里声明且上游模型实际支持的档位。',
      options: [
        { value: '', label: '不声明（提供方默认）' },
        { value: 'low,medium,high,xhigh,max', label: 'Low / Medium / High / XHigh / Max' },
        { value: 'low,medium,high,xhigh', label: 'Low / Medium / High / XHigh' },
        { value: 'minimal,low,medium,high', label: 'Minimal / Low / Medium / High' },
        { value: 'false', label: '模型不支持思考程度' },
      ],
    },
  ];

  constructor(private readonly environment: IEnvironmentService) {}

  targets(): AdapterTarget[] {
    return [
      {
        key: SETTINGS,
        label: 'settings.yaml',
        path: join(this.environment.harnessHomes.dsh, 'settings.yaml'),
        format: 'yaml',
      },
      {
        key: CREDENTIALS,
        label: '.credentials.yaml',
        path: join(this.environment.harnessHomes.dsh, '.credentials.yaml'),
        format: 'yaml',
      },
    ];
  }

  envVars(): Record<string, string> {
    return {};
  }

  validate(profile: AdapterProfile): void {
    if (!profile.model.trim()) {
      throw new HttpError(400, 'DeepSeek Harness 需要填写模型名称', {
        code: ERROR_CODES.adapterModelRequired,
        params: { harness: 'DeepSeek Harness' },
      });
    }
    if (!profile.apiKey.trim()) {
      throw new HttpError(400, 'DeepSeek Harness 需要填写 API key', {
        code: ERROR_CODES.adapterApiKeyRequired,
        params: { harness: 'DeepSeek Harness' },
      });
    }
  }

  render(profile: AdapterProfile, current: CurrentFiles): RenderedFiles {
    this.validate(profile);
    const official = this.isOfficial(profile);
    const providerId = official ? 'deepseek-official' : this.providerId(profile);
    const credentialRef = this.credentialRef(providerId);
    const settings = parseYamlDocument(current[SETTINGS]);
    const models = this.models(profile, official);
    if (official) {
      settings.setIn(['llm-deepseek', 'apiKeyEnv'], credentialRef);
      settings.setIn(['llm-deepseek', 'baseURL'], profile.baseUrl || 'https://api.deepseek.com');
      settings.setIn(['llm-deepseek', 'models'], models);
      settings.setIn(['llm-deepseek', 'maxTokens'], this.numeric(profile.extras.maxTokens, 256000));
    } else {
      settings.setIn(['llm-pi-ai', 'providers', providerId], {
        displayName: profile.name,
        apiKeyEnv: credentialRef,
        api: profile.extras.api || 'openai-responses',
        baseURL: profile.baseUrl,
        models,
      });
    }
    settings.setIn(['agent-default-model', 'provider'], providerId);
    settings.setIn(['agent-default-model', 'model'], profile.model);
    settings.deleteIn(['agent-default-model', 'reasoningEffort']);

    const credentials = parseYamlDocument(current[CREDENTIALS]);
    this.normalizeCredentials(credentials);
    credentials.setIn(['version'], 1);
    credentials.setIn(['refs', credentialRef], profile.apiKey);

    return {
      [SETTINGS]: settings.toString(),
      [CREDENTIALS]: credentials.toString(),
    };
  }

  renderAvailable(profile: AdapterProfile, current: CurrentFiles): RenderedFiles {
    const rendered = this.render(profile, current);
    const settings = parseYamlDocument(rendered[SETTINGS]);
    const currentSettings = parseYamlDocument(current[SETTINGS]);
    const currentDefault = currentSettings.getIn(['agent-default-model']);
    if (currentDefault === undefined) settings.deleteIn(['agent-default-model']);
    else settings.setIn(['agent-default-model'], currentDefault);
    rendered[SETTINGS] = settings.toString();
    return rendered;
  }

  revoke(profile: AdapterProfile, current: CurrentFiles): RenderedFiles {
    const official = this.isOfficial(profile);
    const providerId = official ? 'deepseek-official' : this.providerId(profile);
    const rendered: RenderedFiles = {};

    if (current[SETTINGS] !== undefined) {
      try {
        const settings = parseYamlDocument(current[SETTINGS]);
        if (official) settings.deleteIn(['llm-deepseek']);
        else settings.deleteIn(['llm-pi-ai', 'providers', providerId]);
        if (settings.getIn(['agent-default-model', 'provider']) === providerId) {
          settings.deleteIn(['agent-default-model']);
        }
        rendered[SETTINGS] = settings.toString();
      } catch {
        // Never replace a hand-edited settings document that DSH itself cannot parse.
      }
    }

    if (current[CREDENTIALS] !== undefined) {
      try {
        const credentials = parseYamlDocument(current[CREDENTIALS]);
        this.normalizeCredentials(credentials);
        credentials.deleteIn(['refs', this.credentialRef(providerId)]);
        rendered[CREDENTIALS] = credentials.toString();
      } catch {
        // The credential provider rejects an invalid document too, so leave it intact.
      }
    }

    return rendered;
  }

  backfill(profile: AdapterProfile, current: CurrentFiles): Partial<AdapterProfile> {
    try {
      const official = this.isOfficial(profile);
      const providerId = official ? 'deepseek-official' : this.providerId(profile);
      const settings = parseYamlDocument(current[SETTINGS]);
      const credentials = parseYamlDocument(current[CREDENTIALS]);
      const route = toPlain(
        settings.getIn(official ? ['llm-deepseek'] : ['llm-pi-ai', 'providers', providerId]),
      );
      const models = Array.isArray(route?.models) ? route.models : [];
      const firstModel = toPlain(models[0]);
      const ref = this.credentialRef(providerId);
      const apiKey = credentials.getIn(['refs', ref]) ?? credentials.getIn([ref]);

      return {
        baseUrl: typeof route?.baseURL === 'string' ? route.baseURL : profile.baseUrl,
        apiKey: typeof apiKey === 'string' && apiKey ? apiKey : profile.apiKey,
        model: typeof firstModel?.id === 'string' ? firstModel.id : profile.model,
        extras: {
          ...profile.extras,
          providerType: official ? 'official' : 'custom',
          api: typeof route?.api === 'string' ? route.api : profile.extras.api || '',
          models: models
            .map((entry) => toPlain(entry)?.id)
            .filter((id): id is string => typeof id === 'string')
            .join('\n'),
          contextWindow: valueString(firstModel?.contextWindow, profile.extras.contextWindow),
          maxTokens: valueString(firstModel?.maxTokens, profile.extras.maxTokens),
          reasoningEfforts: reasoningEffortsString(
            firstModel?.reasoningEfforts,
            profile.extras.reasoningEfforts,
          ),
        },
      };
    } catch {
      return {};
    }
  }

  /**
   * DSH keeps its routings under `llm-pi-ai.providers` and the credential itself in a
   * separate file, which `backfill` already knows how to pair up.
   */
  detect(current: CurrentFiles): DetectedProfile[] {
    let providers: Record<string, unknown> | undefined;
    let selected = '';
    try {
      const settings = parseYamlDocument(current[SETTINGS]);
      providers = toPlain(settings.getIn(['llm-pi-ai', 'providers']));
      const active = settings.getIn(['agent-default-model', 'provider']);
      selected = typeof active === 'string' ? active : '';
    } catch {
      return [];
    }
    if (!providers) {
      return [];
    }
    return compact(
      Object.entries(providers).map(([id, provider]) => {
        const route = toPlain(provider);
        if (!route) {
          return null;
        }
        const seed = seedProfile({ providerId: id });
        return toCandidate(id, seed, this.backfill(seed, current), id === selected);
      }),
    );
  }

  private providerId(profile: AdapterProfile): string {
    const id = slugify(profile.extras.providerId || profile.name, 'provider');
    return /^[a-z]/.test(id) ? id : `provider-${id}`;
  }

  private credentialRef(providerId: string): string {
    return providerId === 'deepseek-official'
      ? 'DEEPSEEK_API_KEY'
      : `${providerId.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}_API_KEY`;
  }

  private isOfficial(profile: AdapterProfile): boolean {
    return profile.extras.providerType === 'official';
  }

  private models(profile: AdapterProfile, official: boolean): Record<string, unknown>[] {
    const ids = [profile.model, ...(profile.extras.models || '').split(/[\n,]/)]
      .map((id) => id.trim())
      .filter(Boolean);
    const contextWindow = this.numeric(
      profile.extras.contextWindow,
      official ? 1000000 : DEFAULT_CONTEXT,
    );
    const maxTokens = this.numeric(
      profile.extras.maxTokens,
      official ? 256000 : DEFAULT_MAX_TOKENS,
    );
    const reasoningEfforts = this.reasoningEfforts(profile.extras.reasoningEfforts);
    return [...new Set(ids)].map((id) => ({
      id,
      name: id,
      contextWindow,
      maxTokens,
      ...(!official && reasoningEfforts !== undefined ? { reasoningEfforts } : {}),
    }));
  }

  private normalizeCredentials(credentials: ReturnType<typeof parseYamlDocument>): void {
    const root = toPlain(credentials) ?? {};
    for (const [key, value] of Object.entries(root)) {
      if (
        ['version', 'refs', 'records'].includes(key) ||
        !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ||
        typeof value !== 'string' ||
        !value
      )
        continue;
      if (credentials.getIn(['refs', key]) === undefined) credentials.setIn(['refs', key], value);
      credentials.deleteIn([key]);
    }
  }

  private numeric(raw: string | undefined, fallback: number): number {
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
  }

  private reasoningEfforts(raw: string | undefined): Record<string, string> | false | undefined {
    if (!raw) {
      return undefined;
    }
    if (raw === 'false') {
      return false;
    }
    const levels = raw
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    return levels.length > 0
      ? Object.fromEntries(levels.map((level) => [level, level]))
      : undefined;
  }
}

function toPlain(value: unknown): Record<string, unknown> | undefined {
  const plain = isYamlNode(value) ? value.toJSON() : value;
  return typeof plain === 'object' && plain !== null && !Array.isArray(plain)
    ? (plain as Record<string, unknown>)
    : undefined;
}

function isYamlNode(value: unknown): value is { toJSON(): unknown } {
  return typeof value === 'object' && value !== null && 'toJSON' in value;
}

function valueString(value: unknown, fallback: string | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : fallback || '';
}

function reasoningEffortsString(value: unknown, fallback: string | undefined): string {
  if (value === false) {
    return 'false';
  }
  const plain = toPlain(value);
  return plain ? Object.keys(plain).join(',') : fallback || '';
}
