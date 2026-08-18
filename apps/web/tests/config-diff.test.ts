import { expect, test } from '@rstest/core';
import type { BackupFileDetail } from '@seaveyon/harness-switch-shared';
import { changeKind } from '@/components/config-diff';

function file(overrides: Partial<BackupFileDetail>): BackupFileDetail {
  return {
    path: '/tmp/a.json',
    existed: true,
    content: '{"a":1}',
    currentContent: '{"a":2}',
    ...overrides,
  };
}

test('classifies restore diffs against the live files', () => {
  expect(changeKind(file({}))).toBe('replace');
  expect(changeKind(file({ content: '{"a":2}' }))).toBe('same');
  expect(changeKind(file({ content: null, existed: false }))).toBe('delete');
  expect(changeKind(file({ currentContent: null }))).toBe('create');
});
