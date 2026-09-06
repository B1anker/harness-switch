import { expect, test } from 'bun:test';
import { favoriteNativePreview } from '../src/services/model-favorite-preview';

test('native preview preserves model env and settings while hiding credentials', () => {
  const preview = JSON.parse(
    favoriteNativePreview(
      'json',
      JSON.stringify({
        env: {
          ANTHROPIC_MODEL: 'opus',
          CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet',
          ANTHROPIC_API_KEY: 'fake-key',
          ANTHROPIC_AUTH_TOKEN: 'fake-token',
        },
        baseUrl: 'https://example.com/v1',
        authMode: 'apiKey',
        max_tokens: 8192,
        headers: {
          Authorization: 'Bearer fake-token',
          'X-Api-Key': 'fake-key',
          'X-Client': 'desktop',
        },
        tokens: { access_token: 'fake-access', refresh_token: 'fake-refresh' },
        customCredential: 'custom-value',
        theme: 'dark',
      }),
      ['custom-value'],
    )!,
  );
  expect(preview.env).toEqual({
    ANTHROPIC_MODEL: 'opus',
    CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet',
    ANTHROPIC_API_KEY: '[redacted]',
    ANTHROPIC_AUTH_TOKEN: '[redacted]',
  });
  expect(preview).toMatchObject({
    baseUrl: 'https://example.com/v1',
    authMode: 'apiKey',
    max_tokens: 8192,
    theme: 'dark',
    customCredential: '[redacted]',
  });
  expect(preview.headers).toEqual({
    Authorization: '[redacted]',
    'X-Api-Key': '[redacted]',
    'X-Client': 'desktop',
  });
  expect(JSON.stringify(preview)).not.toContain('fake-');
});

test('TOML and YAML preserve normal settings and redact secrets and URL credentials', () => {
  const toml = favoriteNativePreview(
    'toml',
    'model = "gpt-test"\napi_key = "fake-key"\nmodel_reasoning_effort = "high"',
  );
  expect(toml).toContain('gpt-test');
  expect(toml).toContain('high');
  expect(toml).not.toContain('fake-key');
  const yaml = favoriteNativePreview(
    'yaml',
    'model: kimi-test\npassword: fake-password\nbase_url: https://user:fake-password@example.com/v1?api_key=fake-key&version=2',
  );
  expect(yaml).toContain('kimi-test');
  expect(yaml).toContain('example.com/v1');
  expect(yaml).toContain('version=2');
  expect(yaml).not.toContain('fake-');
  expect(favoriteNativePreview('json', undefined)).toBeNull();
});
