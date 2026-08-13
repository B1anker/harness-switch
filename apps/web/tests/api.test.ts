import { expect, test } from '@rstest/core';
import { profilePath, profilesCollectionPath } from '@/lib/api';
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
