import { describe, expect, test } from 'bun:test';
import {
  CATALOGS,
  ERROR_CODES,
  LANGUAGES,
  VALIDATION_CODES,
} from '@seaveyon/harness-switch-shared';
import { localizeMessage } from '../src/common/localize';

describe('API error localization', () => {
  test('has a localized message for every stable error code', () => {
    for (const code of [...Object.values(ERROR_CODES), ...Object.values(VALIDATION_CODES)]) {
      if (code === ERROR_CODES.requestFailed) {
        continue;
      }
      const data = PLURAL_CODES.has(code) ? { count: 2 } : undefined;
      expect(localizeMessage('en', code, data)).not.toBe('Request failed');
      expect(localizeMessage('zh-CN', code, data)).not.toBe('请求失败');
    }
  });

  test('uses the correct plural form and interpolation data', () => {
    expect(localizeMessage('en', ERROR_CODES.providerInUse, { count: 1 })).toContain('1 profile');
    expect(localizeMessage('en', ERROR_CODES.providerInUse, { count: 2 })).toContain('2 profiles');
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

/** Codes whose catalog entry is pluralised, so they only resolve with a `count`. */
const PLURAL_CODES: ReadonlySet<string> = new Set([
  ERROR_CODES.providerInUse,
  ERROR_CODES.passwordTooShort,
]);

/** Leaf paths of a nested catalog, e.g. `error.providerInUse_one`. */ function flatKeys(
  value: Record<string, unknown>,
  prefix = '',
): string[] {
  return Object.entries(value).flatMap(([key, child]) =>
    typeof child === 'object' && child !== null && !Array.isArray(child)
      ? flatKeys(child as Record<string, unknown>, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}
