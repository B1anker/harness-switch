import type {
  DoctorCheck,
  DoctorReport,
  DriftFileState,
  DriftSummary,
  FieldSpec,
  HarnessSummary,
  ProfilePublic,
  ProviderPublic,
} from '@seaveyon/harness-switch-shared';
import { useAppStore } from '@/stores/app-store';

/**
 * Mirrors the 1M flag spec the Claude adapter emits per model tier, including the catalog
 * keys — a fixture without them would render the fallback prose and prove nothing about
 * how the real payload behaves in English.
 */
function oneMFieldFixture(role: string, key: string, labelCode?: string): FieldSpec {
  return {
    key,
    labelCode: labelCode ?? 'harness.field.claude.oneM.label',
    ...(labelCode ? {} : { params: { role } }),
    kind: 'select',
    defaultValue: 'false',
    options: [
      { value: 'false', labelCode: 'harness.field.toggle.off' },
      { value: 'true', labelCode: 'harness.field.toggle.on' },
    ],
  };
}

/**
 * A plain text field as the Claude adapter emits it. Every one of its label keys is
 * `harness.field.claude.<key>.label`, so the key is all a call site has to supply.
 */
function textFieldFixture(key: string): FieldSpec {
  return { key, labelCode: `harness.field.claude.${key}.label`, kind: 'text' };
}

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
        labelCode: 'harness.field.claude.authVar.label',
        kind: 'select',
        defaultValue: 'ANTHROPIC_AUTH_TOKEN',
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
      textFieldFixture('haikuModel'),
      textFieldFixture('haikuModelName'),
      textFieldFixture('sonnetModel'),
      textFieldFixture('sonnetModelName'),
      oneMFieldFixture('Sonnet', 'sonnetModel1m'),
      textFieldFixture('opusModel'),
      textFieldFixture('opusModelName'),
      oneMFieldFixture('Opus', 'opusModel1m'),
      textFieldFixture('fableModel'),
      textFieldFixture('fableModelName'),
      oneMFieldFixture('Fable', 'fableModel1m'),
      textFieldFixture('subagentModel'),
      oneMFieldFixture('子代理', 'subagentModel1m', 'harness.field.claude.oneM.subagentLabel'),
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
    official: {
      kind: 'account-login',
      available: true,
      active: false,
      titleCode: 'harness.official',
      hintCode: 'harness.officialHintClaude',
    },
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
    status: 'ok',
    code: 'doctor.check.installFound',
    data: { bin: 'claude' },
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
        status: 'warn',
        code: 'doctor.check.driftMismatch',
        data: { count: 2, status: 'drifted' },
      }),
    ],
    ...overrides,
  };
}
