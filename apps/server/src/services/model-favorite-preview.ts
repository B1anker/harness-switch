import type { ConfigFormat } from '@seaveyon/harness-switch-shared';
import { z } from 'zod';
import { parseJsonObject, parseTomlObject, parseYamlDocument } from './adapters/serialize';

const nativeValueSchema = z.json();
type NativeValue = z.infer<typeof nativeValueSchema>;
// Match credential fields, not containers such as env or settings such as max_tokens.
const CREDENTIAL_FIELD =
  /(?:api[_-]?key|(?:^|[_-])(?:key|token|secret|password|passwd|credentials?|authorization|cookie)$|^tokens$|accessToken$|refreshToken$|idToken$|authToken$|clientSecret$|privateKey$)/i;

export function favoriteNativePreview(
  format: ConfigFormat,
  content: string | undefined,
  credentials: readonly string[] = [],
): string | null {
  if (content === undefined) {
    return null;
  }
  const parsed =
    format === 'json'
      ? parseJsonObject(content)
      : format === 'toml'
        ? parseTomlObject(content)
        : format === 'yaml'
          ? parseYamlDocument(content).toJSON()
          : null;
  const value = nativeValueSchema.parse(JSON.parse(JSON.stringify(parsed)));
  return JSON.stringify(redact(value, credentials), null, 2);
}

function redact(value: NativeValue, credentials: readonly string[], secret = false): NativeValue {
  if (typeof value === 'string') {
    if (secret || credentials.some((credential) => credential && value.includes(credential))) {
      return '[redacted]';
    }
    // Public endpoints remain useful; URL-embedded authentication is still a credential.
    try {
      const url = new URL(value);
      if (url.username || url.password) {
        url.username = '[redacted]';
        url.password = '';
      }
      for (const key of url.searchParams.keys()) {
        if (CREDENTIAL_FIELD.test(key)) {
          url.searchParams.set(key, '[redacted]');
        }
      }
      return url.href === new URL(value).href ? value : url.href;
    } catch {
      return value;
    }
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, credentials, secret));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        redact(item, credentials, secret || CREDENTIAL_FIELD.test(key)),
      ]),
    );
  }
  return secret && value !== null ? '[redacted]' : value;
}
