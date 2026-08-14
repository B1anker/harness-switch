import type { HarnessSummary, ProfilePublic } from '@seaveyon/harness-switch-shared';
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
