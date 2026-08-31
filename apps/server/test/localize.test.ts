import { describe, expect, test } from 'bun:test';
import { ERROR_CODES } from '@seaveyon/harness-switch-shared';
import { localizeError } from '../src/common/localize';

describe('API error localization', () => {
  test('has a localized message for every stable error code', () => {
    for (const code of Object.values(ERROR_CODES)) {
      if (code === ERROR_CODES.requestFailed) continue;
      const data = code === ERROR_CODES.providerInUse ? { count: 2 } : undefined;
      expect(localizeError('en', code, data)).not.toBe('Request failed');
      expect(localizeError('zh-CN', code, data)).not.toBe('请求失败');
    }
  });

  test('uses the correct plural form and interpolation data', () => {
    expect(localizeError('en', ERROR_CODES.providerInUse, { count: 1 })).toContain('1 profile');
    expect(localizeError('en', ERROR_CODES.providerInUse, { count: 2 })).toContain('2 profiles');
  });
});
