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
      key: 'providerId',
      label: 'Provider ID（可选）',
      kind: 'text',
      placeholder: '默认取配置名称',
      help: 'DSH 的模型路由标识；必须以小写字母开头。',
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
    const providerId = this.providerId(profile);
    const credentialRef = this.credentialRef(providerId);
    const settings = parseYamlDocument(current[SETTINGS]);

    const model: Record<string, unknown> = {
      id: profile.model,
      name: profile.model,
      contextWindow: this.numeric(profile.extras.contextWindow, DEFAULT_CONTEXT),
      maxTokens: this.numeric(profile.extras.maxTokens, DEFAULT_MAX_TOKENS),
    };
    const reasoningEfforts = this.reasoningEfforts(profile.extras.reasoningEfforts);
    if (reasoningEfforts !== undefined) {
      model.reasoningEfforts = reasoningEfforts;
    }

    settings.setIn(['llm-pi-ai', 'providers', providerId], {
      displayName: profile.name,
      apiKeyEnv: credentialRef,
      api: profile.extras.api || 'openai-responses',
      baseURL: profile.baseUrl,
      models: [model],
    });
    settings.setIn(['agent-default-model', 'provider'], providerId);
    settings.setIn(['agent-default-model', 'model'], profile.model);
    settings.deleteIn(['agent-default-model', 'reasoningEffort']);

    const credentials = parseYamlDocument(current[CREDENTIALS]);
    credentials.setIn([credentialRef], profile.apiKey);

    return {
      [SETTINGS]: settings.toString(),
      [CREDENTIALS]: credentials.toString(),
    };
  }

  revoke(profile: AdapterProfile, current: CurrentFiles): RenderedFiles {
    const providerId = this.providerId(profile);
    const rendered: RenderedFiles = {};

    if (current[SETTINGS] !== undefined) {
      try {
        const settings = parseYamlDocument(current[SETTINGS]);
        settings.deleteIn(['llm-pi-ai', 'providers', providerId]);
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
        credentials.deleteIn([this.credentialRef(providerId)]);
        rendered[CREDENTIALS] = credentials.toString();
      } catch {
        // The credential provider rejects an invalid document too, so leave it intact.
      }
    }

    return rendered;
  }

  backfill(profile: AdapterProfile, current: CurrentFiles): Partial<AdapterProfile> {
    try {
      const providerId = this.providerId(profile);
      const settings = parseYamlDocument(current[SETTINGS]);
      const credentials = parseYamlDocument(current[CREDENTIALS]);
      const route = toPlain(settings.getIn(['llm-pi-ai', 'providers', providerId]));
      const models = Array.isArray(route?.models) ? route.models : [];
      const firstModel = toPlain(models[0]);
      const apiKey = credentials.getIn([this.credentialRef(providerId)]);

      return {
        baseUrl: typeof route?.baseURL === 'string' ? route.baseURL : profile.baseUrl,
        apiKey: typeof apiKey === 'string' && apiKey ? apiKey : profile.apiKey,
        model: typeof firstModel?.id === 'string' ? firstModel.id : profile.model,
        extras: {
          ...profile.extras,
          api: typeof route?.api === 'string' ? route.api : profile.extras.api || '',
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
    return `${providerId.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}_API_KEY`;
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
