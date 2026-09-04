/**
 * A plain JSON object. Arrays are excluded deliberately: every caller here is about to
 * read named fields off the value, and `[]` would pass a bare `typeof === 'object'`.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
