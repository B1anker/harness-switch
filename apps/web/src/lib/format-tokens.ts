const TOKEN_FIELD_KEYS = new Set([
  'contextWindow',
  'maxOutputTokens',
  'maxTokens',
  'maxContextSize',
]);

/**
 * Display-only rendering of token counts: exact multiples of 1024 read as `NK`
 * (262144 → "256K"); anything else falls back to the plain digits. Editable
 * inputs and stored values always keep the raw number.
 */
export function formatTokens(value: number): string {
  return value !== 0 && value % 1024 === 0 ? `${value / 1024}K` : String(value);
}

/**
 * Formats a plan diff or renderer-default value as `NK` when the field holds a token
 * count and the value is a plain integer; everything else passes through untouched.
 */
export function formatTokenField(field: string, value: string | null): string | null {
  const leaf = field.startsWith('extras.') ? field.slice('extras.'.length) : field;
  if (value === null || !TOKEN_FIELD_KEYS.has(leaf) || !/^\d+$/.test(value)) {
    return value;
  }
  return formatTokens(Number(value));
}
