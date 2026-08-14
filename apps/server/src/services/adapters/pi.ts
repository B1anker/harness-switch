import { join } from 'node:path';
import type { FieldSpec, HarnessMode } from '@seaveyon/harness-switch-shared';
import { HttpError } from '../../common/errors';
import type { IEnvironmentService } from '../environment';
import { parseYamlDocument, slugify } from './serialize';
import type {
  AdapterProfile,
  AdapterTarget,
  CurrentFiles,
  HarnessAdapter,
  RenderedFiles,
} from './types';

const MODELS = 'models';
const CONFIG = 'config';
const DEFAULT_CONTEXT = 200000;
const DEFAULT_MAX_TOKENS = 8192;

/**
 * oh-my-pi (command `omp`) declares custom providers in `models.yml`. Its `apiKey` field
 * is resolved as an environment variable name first and as a literal token second, so
 * writing the key itself keeps the profile self-contained.
 *
 * There is no single "current provider" key; `modelProviderOrder` in `config.yml` breaks
 * ties between providers offering the same model id, earliest entry winning. Activating
 * therefore registers the provider and moves it to the front of that order.
 */
export class PiAdapter implements HarnessAdapter {
  readonly id = 'pi' as const;
  readonly mode: HarnessMode = 'additive';
  readonly envVarNames: string[] = [];
  readonly envNote = 'API key 直接写入 models.yml，无需环境变量；运行时仍可用 --model 覆盖。';

  readonly fields: FieldSpec[] = [
    {
      key: 'providerId',
      label: 'Provider ID（可选）',
      kind: 'text',
      placeholder: '默认取配置名称',
      help: '模型引用格式为 provider/model。',
    },
    {
      key: 'api',
      label: '协议',
      kind: 'select',
      defaultValue: 'openai-completions',
      options: [
        { value: 'openai-completions', label: 'openai-completions' },
        { value: 'openai-responses', label: 'openai-responses' },
      ],
    },
    {
      key: 'authHeader',
      label: 'Authorization 头',
      kind: 'select',
      defaultValue: 'true',
      help: '以 Authorization: Bearer <key> 发送。',
      options: [
        { value: 'true', label: '开启' },
        { value: 'false', label: '关闭' },
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
  ];

  constructor(private readonly environment: IEnvironmentService) {}

  targets(): AdapterTarget[] {
    return [
      {
        key: MODELS,
        label: 'models.yml',
        path: join(this.environment.harnessHomes.piAgent, 'models.yml'),
        format: 'yaml',
      },
      {
        key: CONFIG,
        label: 'config.yml',
        path: join(this.environment.harnessHomes.piAgent, 'config.yml'),
        format: 'yaml',
      },
    ];
  }

  envVars(): Record<string, string> {
    return {};
  }

  validate(profile: AdapterProfile): void {
    if (!profile.model.trim()) {
      throw new HttpError(400, 'oh-my-pi 需要填写模型名称，否则无法生成 models 条目');
    }
  }

  render(profile: AdapterProfile, current: CurrentFiles): RenderedFiles {
    this.validate(profile);
    const id = this.providerId(profile);

    // The Document API is used instead of parse/stringify so the comments and layout in
    // a hand-maintained models.yml survive the merge.
    const models = parseYamlDocument(current[MODELS]);
    models.setIn(['providers', id, 'baseUrl'], profile.baseUrl);
    models.setIn(['providers', id, 'apiKey'], profile.apiKey);
    models.setIn(['providers', id, 'api'], profile.extras.api || 'openai-completions');
    models.setIn(['providers', id, 'authHeader'], profile.extras.authHeader !== 'false');
    models.setIn(
      ['providers', id, 'models'],
      [
        {
          id: profile.model,
          name: profile.model,
          contextWindow: this.numeric(profile.extras.contextWindow, DEFAULT_CONTEXT),
          maxTokens: this.numeric(profile.extras.maxTokens, DEFAULT_MAX_TOKENS),
        },
      ],
    );

    const config = parseYamlDocument(current[CONFIG]);
    config.setIn(['modelProviderOrder'], this.promote(config.getIn(['modelProviderOrder']), id));

    return {
      [MODELS]: models.toString(),
      [CONFIG]: config.toString(),
    };
  }

  revoke(profile: AdapterProfile, current: CurrentFiles): RenderedFiles {
    const id = this.providerId(profile);
    const rendered: RenderedFiles = {};

    // A file that does not exist has nothing to revoke, and creating an empty one would
    // be worse than leaving it absent.
    if (current[MODELS] !== undefined) {
      try {
        const models = parseYamlDocument(current[MODELS]);
        models.deleteIn(['providers', id]);
        rendered[MODELS] = models.toString();
      } catch {
        // A models.yml we cannot parse is left untouched rather than clobbered.
      }
    }

    if (current[CONFIG] !== undefined) {
      try {
        const config = parseYamlDocument(current[CONFIG]);
        const order = this.toStringArray(config.getIn(['modelProviderOrder'])).filter(
          (entry) => entry !== id,
        );
        if (order.length > 0) {
          config.setIn(['modelProviderOrder'], order);
        } else {
          config.deleteIn(['modelProviderOrder']);
        }
        rendered[CONFIG] = config.toString();
      } catch {
        // Same reasoning as above.
      }
    }

    return rendered;
  }

  backfill(profile: AdapterProfile, current: CurrentFiles): Partial<AdapterProfile> {
    try {
      const models = parseYamlDocument(current[MODELS]);
      const id = this.providerId(profile);
      const baseUrl = models.getIn(['providers', id, 'baseUrl']);
      const apiKey = models.getIn(['providers', id, 'apiKey']);
      return {
        baseUrl: typeof baseUrl === 'string' ? baseUrl : profile.baseUrl,
        apiKey: typeof apiKey === 'string' && apiKey ? apiKey : profile.apiKey,
      };
    } catch {
      return {};
    }
  }

  private providerId(profile: AdapterProfile): string {
    return slugify(profile.extras.providerId || profile.name, 'provider');
  }

  private promote(existing: unknown, id: string): string[] {
    return [id, ...this.toStringArray(existing).filter((entry) => entry !== id)];
  }

  private toStringArray(value: unknown): string[] {
    const plain = isYamlNode(value) ? value.toJSON() : value;
    return Array.isArray(plain)
      ? plain.filter((entry): entry is string => typeof entry === 'string')
      : [];
  }

  private numeric(raw: string | undefined, fallback: number): number {
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
  }
}

function isYamlNode(value: unknown): value is { toJSON(): unknown } {
  return typeof value === 'object' && value !== null && 'toJSON' in value;
}
