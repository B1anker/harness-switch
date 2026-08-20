import type {
  DoctorCheck,
  DoctorReport,
  DriftFileState,
  DriftSummary,
  HarnessSummary,
  ProfilePublic,
  ProviderPublic,
} from '@seaveyon/harness-switch-shared';
import { useAppStore } from '@/stores/app-store';

export function profileFixture(overrides: Partial<ProfilePublic> = {}): ProfilePublic {
  return {
    harness: 'claude',
    name: 'openrouter-main',
    baseUrl: 'https://api.example.com/v1',
    model: 'claude-sonnet-4-5',
    notes: '',
    extras: {},
    overriddenTargets: [],
    updatedAt: '2026-08-13T00:00:00.000Z',
    ...overrides,
  };
}

export function harnessFixture(overrides: Partial<HarnessSummary> = {}): HarnessSummary {
  return {
    id: 'claude',
    label: 'Claude Code',
    mode: 'replace',
    active: null,
    profiles: [],
    fields: [
      {
        key: 'authVar',
        label: '凭据变量',
        kind: 'select',
        defaultValue: 'ANTHROPIC_AUTH_TOKEN',
        options: [
          { value: 'ANTHROPIC_AUTH_TOKEN', label: 'ANTHROPIC_AUTH_TOKEN（第三方中转）' },
          { value: 'ANTHROPIC_API_KEY', label: 'ANTHROPIC_API_KEY（官方）' },
        ],
      },
      { key: 'haikuModel', label: 'Haiku 模型映射', kind: 'text' },
      { key: 'sonnetModel', label: 'Sonnet 模型映射', kind: 'text' },
      { key: 'opusModel', label: 'Opus 模型映射', kind: 'text' },
      { key: 'fableModel', label: 'Fable 模型映射（可选）', kind: 'text' },
      { key: 'subagentModel', label: '子代理模型（可选）', kind: 'text' },
    ],
    targets: [
      {
        key: 'settings',
        label: 'settings.json',
        path: '/home/tester/.claude/settings.json',
        format: 'json',
      },
    ],
    envVars: ['ANTHROPIC_BASE_URL'],
    supportsOfficialAuth: true,
    ...overrides,
  };
}

/**
 * Replaces the store's async actions with recorders, so a component test asserts what
 * the component asked for without touching the network.
 */
export function stubStoreActions<K extends keyof ReturnType<typeof useAppStore.getState>>(
  keys: K[],
): Record<K, unknown[][]> {
  const calls = {} as Record<K, unknown[][]>;
  const patch: Record<string, unknown> = {};
  for (const key of keys) {
    calls[key] = [];
    patch[key as string] = async (...args: unknown[]) => {
      calls[key].push(args);
    };
  }
  useAppStore.setState(patch);
  return calls;
}

export function providerFixture(overrides: Partial<ProviderPublic> = {}): ProviderPublic {
  return {
    id: 'openrouter',
    name: 'OpenRouter',
    notes: '',
    apiKeyConfigured: true,
    endpoints: [
      { key: 'main', label: '主入口', baseUrl: 'https://openrouter.ai/api/v1' },
      { key: 'fallback', label: '', baseUrl: 'https://fallback.example.com/v1' },
    ],
    updatedAt: '2026-08-13T00:00:00.000Z',
    ...overrides,
  };
}

export function driftFileFixture(overrides: Partial<DriftFileState> = {}): DriftFileState {
  return {
    key: 'settings',
    label: 'settings.json',
    path: '/home/tester/.claude/settings.json',
    format: 'json',
    expectedContent: '{"env":{"ANTHROPIC_AUTH_TOKEN":"sk-expected"}}',
    currentContent: '{"env":{"ANTHROPIC_AUTH_TOKEN":"sk-live"}}',
    status: 'drifted',
    ...overrides,
  };
}

export function driftSummaryFixture(overrides: Partial<DriftSummary> = {}): DriftSummary {
  return {
    harness: 'claude',
    status: 'in-sync',
    active: true,
    files: [],
    ...overrides,
  };
}

export function doctorCheckFixture(overrides: Partial<DoctorCheck> = {}): DoctorCheck {
  return {
    id: 'claude.install',
    label: 'claude.install',
    status: 'ok',
    detail: '已找到可执行文件 claude',
    ...overrides,
  };
}

export function doctorReportFixture(overrides: Partial<DoctorReport> = {}): DoctorReport {
  return {
    harness: 'claude',
    checks: [
      doctorCheckFixture(),
      doctorCheckFixture({
        id: 'claude.drift',
        label: 'claude.drift',
        status: 'warn',
        detail: '2 个文件与激活配置不一致（drifted）',
      }),
    ],
    ...overrides,
  };
}
