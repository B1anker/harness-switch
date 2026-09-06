import type {
  DoctorCheck,
  DoctorReport,
  DriftFileState,
  DriftSummary,
  FavoritePlan,
  FavoriteProjectionResult,
  FieldSpec,
  HarnessSummary,
  ProfilePublic,
  ProviderPublic,
} from '@seaveyon/harness-switch-shared';

export function favoriteTargetFixture(favorite: FavoriteListItem) {
  const connection = favorite.connections[0]!;
  const projection: FavoriteProjectionResult = {
    projectionVersion: 1,
    projection: {
      harness: 'pi',
      model: connection.requestModelId,
      providerId: connection.providerId,
      providerEndpoint: connection.endpointKey,
      extras: {},
    },
    ownedFields: [],
    set: {},
    remove: [],
    notRepresented: [],
    rendererDefaults: {},
    warnings: [],
    blockers: [],
  };
  return { harness: 'pi' as const, connections: [{ id: connection.id, projection }] };
}

import { createFavoriteRequestSchema, resolveFavorite } from '@seaveyon/harness-switch-shared';
import type { FavoriteListItem } from '@/stores/slices/model-favorites';

export function favoritePlanFixture(favorite: FavoriteListItem): FavoritePlan {
  const connection = favorite.connections[0]!;
  return {
    id: '00000000-0000-4000-8000-000000000010',
    expiresAt: '2026-09-05T00:10:00Z',
    favoriteRevision: favorite.revision,
    items: [
      {
        harness: 'pi',
        connectionId: connection.id,
        profile: favorite.name,
        existing: false,
        mode: 'save',
        ignorePreference: false,
        overwriteDiverged: false,
        preservedFields: [],
        liveState: 'inactive',
        authMode: 'apiKey',
        projection: favoriteTargetFixture(favorite).connections[0]!.projection,
        resolved: resolveFavorite(favorite, connection),
        diff: [{ field: 'model', before: null, after: connection.requestModelId }],
        nativeFiles: [],
      },
    ],
  };
}

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

export function favoriteFixture(name: string, model: string): FavoriteListItem {
  return {
    ...createFavoriteRequestSchema.parse({
      name,
      connections: [
        {
          id: '00000000-0000-4000-8000-000000000002',
          label: 'route',
          providerId: 'vault',
          endpointKey: 'api',
          protocol: 'openai-responses',
          requestModelId: model,
        },
      ],
    }),
    id: '00000000-0000-4000-8000-000000000001',
    revision: 1,
    createdAt: '2026-09-05T00:00:00Z',
    updatedAt: '2026-09-05T00:00:00Z',
    references: [],
  };
}
