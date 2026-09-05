import type { ConfigFormat } from '@seaveyon/harness-switch-shared';
import { z } from 'zod';
import { parseJsonObject, parseTomlObject, parseYamlDocument } from './adapters/serialize';

const nativeValueSchema = z.json();
type NativeValue = z.infer<typeof nativeValueSchema>;
const DISPLAY_FIELDS = new Set([
  'model',
  'id',
  'api',
  'type',
  'contextWindow',
  'maxTokens',
  'max_context_size',
  'model_reasoning_effort',
  'reasoning',
  'reasoningEfforts',
  'model_provider',
]);

/** Unknown string values are hidden, including custom authentication field names. */
export function favoriteNativePreview(
  format: ConfigFormat,
  content: string | undefined,
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
  return JSON.stringify(redact(value), null, 2);
}

function redact(value: NativeValue, field = '', secret = false): NativeValue {
  if (typeof value === 'string') {
    return !secret && DISPLAY_FIELDS.has(field) ? value : '[redacted]';
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, field, secret));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        redact(
          item,
          key,
          secret || /auth|token|key|secret|password|credential|header|^env$/i.test(key),
        ),
      ]),
    );
  }
  return secret && value !== null ? '[redacted]' : value;
}
