import { describe, expect, test } from 'bun:test';
import { CATALOGS, ERROR_CODES, LANGUAGES } from '@seaveyon/harness-switch-shared';
import { localizeError } from '../src/common/localize';

describe('API error localization', () => {
  test('has a localized message for every stable error code', () => {
    for (const code of Object.values(ERROR_CODES)) {
      if (code === ERROR_CODES.requestFailed) {
        continue;
      }
      const data = code === ERROR_CODES.providerInUse ? { count: 2 } : undefined;
      expect(localizeError('en', code, data)).not.toBe('Request failed');
      expect(localizeError('zh-CN', code, data)).not.toBe('请求失败');
    }
  });

  test('uses the correct plural form and interpolation data', () => {
    expect(localizeError('en', ERROR_CODES.providerInUse, { count: 1 })).toContain('1 profile');
    expect(localizeError('en', ERROR_CODES.providerInUse, { count: 2 })).toContain('2 profiles');
  });

  test('every catalog carries the same keys', () => {
    // A key added to one catalog and forgotten in the other falls back to the whole language's
    // default — for the API that means the terse "Request failed", and in the UI the raw key
    // shows through. Comparing the flattened key sets catches the omission at the source.
    const [reference, ...others] = LANGUAGES;
    const expected = flatKeys(CATALOGS[reference]);

    for (const language of others) {
      const actual = flatKeys(CATALOGS[language]);
      expect(actual.filter((key) => !expected.includes(key))).toEqual([]);
      expect(expected.filter((key) => !actual.includes(key))).toEqual([]);
    }
  });
});

/** Leaf paths of a nested catalog, e.g. `error.providerInUse_one`. */
function flatKeys(value: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, child]) =>
    typeof child === 'object' && child !== null && !Array.isArray(child)
      ? flatKeys(child as Record<string, unknown>, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}
