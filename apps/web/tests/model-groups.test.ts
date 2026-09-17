import { expect, test } from '@rstest/core';
import type { FavoriteConnection, FavoriteInput } from '@seaveyon/harness-switch-shared';
import {
  accountClusterId,
  accountClusters,
  pruneFavoriteDraft,
} from '@/components/model-favorites/editor/model-groups';

function connection(id: string, model: string, patch: Partial<FavoriteConnection> = {}) {
  return {
    id,
    label: 'route',
    providerId: '00000000-0000-4000-8000-0000000000aa',
    endpointKey: 'api',
    protocol: 'openai-chat' as const,
    protocols: ['openai-chat' as const],
    requestModelId: model,
    factOverrides: {},
    preferenceOverrides: {},
    ...patch,
  } satisfies FavoriteConnection;
}

test('pruneFavoriteDraft keeps an explicit empty modelIds selection', () => {
  const a = connection('00000000-0000-4000-8000-000000000001', 'vendor/a');
  const b = connection('00000000-0000-4000-8000-000000000002', 'vendor/b', {
    groupId: a.id,
  });
  const draft = {
    name: 'daily',
    notes: '',
    defaults: {},
    preferences: {},
    connections: [a, { ...b, groupId: a.id }],
    toolBindings: {
      dsh: { modelIds: [] },
    },
  } satisfies FavoriteInput;
  const pruned = pruneFavoriteDraft(draft);
  expect(pruned.toolBindings?.dsh?.modelIds).toEqual([]);
});

test('pruneFavoriteDraft keeps incomplete Claude tiers for validation', () => {
  const a = connection('00000000-0000-4000-8000-000000000001', 'vendor/opus', {
    protocol: 'anthropic-messages',
    protocols: ['anthropic-messages'],
  });
  const draft = {
    name: 'daily',
    notes: '',
    defaults: {},
    preferences: {},
    connections: [a],
    toolBindings: {
      claude: {
        mode: 'tiers' as const,
        tiers: { opus: a.id },
      },
    },
  } satisfies FavoriteInput;
  const pruned = pruneFavoriteDraft(draft);
  expect(pruned.toolBindings?.claude).toEqual({
    mode: 'tiers',
    tiers: { opus: a.id, sonnet: undefined, haiku: undefined },
  });
});

test('accountClusterId stays unique when clusters share a provider without groupId', () => {
  const left = connection('00000000-0000-4000-8000-000000000001', 'vendor/a');
  const right = connection('00000000-0000-4000-8000-000000000002', 'vendor/b', {
    endpointKey: 'other',
  });
  const clusters = accountClusters([left, right]);
  expect(clusters).toHaveLength(2);
  expect(accountClusterId(clusters[0]!)).not.toBe(accountClusterId(clusters[1]!));
  expect(new Set(clusters.map(accountClusterId)).size).toBe(2);
});
