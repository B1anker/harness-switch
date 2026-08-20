import { expect, test } from '@rstest/core';
import { HARNESS_IDS } from '@seaveyon/harness-switch-shared';
import {
  backupsPath,
  doctorPath,
  driftAdoptPath,
  driftPath,
  driftReapplyPath,
  profilePath,
  profilesCollectionPath,
  providerPath,
  providersPath,
} from '@/lib/api';
import { PRESETS } from '@/lib/presets';
import { cn } from '@/lib/utils';

test('cn merges tailwind classes', () => {
  expect(cn('px-2', 'px-4')).toBe('px-4');
  expect(cn('text-sm', undefined, 'font-medium')).toBe('text-sm font-medium');
});

test('profilePath encodes profile names', () => {
  expect(profilesCollectionPath('claude')).toBe('/api/harnesses/claude/profiles');
  expect(profilePath('claude', 'openrouter-main')).toBe(
    '/api/harnesses/claude/profiles/openrouter-main',
  );
  expect(profilePath('kimi', 'prod key')).toBe('/api/harnesses/kimi/profiles/prod%20key');
});

test('backupsPath encodes backup ids', () => {
  expect(backupsPath()).toBe('/api/backups');
  expect(backupsPath('2026-08-13T00-00-00-000Z-claude-main')).toBe(
    '/api/backups/2026-08-13T00-00-00-000Z-claude-main',
  );
});

test('provider vault, drift and doctor helpers build the api paths', () => {
  expect(providersPath()).toBe('/api/providers');
  expect(providerPath('openrouter')).toBe('/api/providers/openrouter');
  expect(providerPath('prod key')).toBe('/api/providers/prod%20key');
  expect(driftPath()).toBe('/api/drift');
  expect(driftPath('claude')).toBe('/api/drift/claude');
  expect(driftReapplyPath('claude')).toBe('/api/drift/claude/reapply');
  expect(driftAdoptPath('claude')).toBe('/api/drift/claude/adopt');
  expect(doctorPath()).toBe('/api/doctor');
});

test('every harness has presets so the quick-fill row never renders empty', () => {
  for (const id of HARNESS_IDS) {
    expect(PRESETS[id]?.length).toBeGreaterThan(0);
  }
});
