import type { FieldSpec, LocalizedMessage, MessageParams } from '@seaveyon/harness-switch-shared';
import { catalogKey } from '@seaveyon/harness-switch-shared';
import type { TFunction } from 'i18next';
import { ApiError } from '@/lib/api';

/**
 * A message the app can hold without having picked a language yet: a catalog key
 * plus the values it interpolates.
 *
 * The store and the toast both need this. Zustand actions run outside React, so
 * they cannot call `t` — they record the key and let the component that renders
 * the message resolve it.
 */
export type MessageLine = {
  /** Catalog key, resolved when the message is rendered. */
  key: string;
  params?: MessageParams;
  /**
   * Params whose values are themselves catalog keys, translated before interpolation.
   *
   * Only the app sets this — a server-supplied `params` is always data, never a key,
   * so a payload can never steer the UI to an arbitrary catalog entry.
   */
  paramKeys?: Record<string, string>;
  /**
   * Untranslated prefix carrying user data, e.g. `codex/my-profile`. Rendered
   * verbatim before the translated text.
   */
  scope?: string;
  /** The server's own prose, shown when this build has no entry for `key`. */
  fallback?: string;
};

/** Turns a server-reported message into a line, rendered from its code. */
export function messageLine(message: LocalizedMessage): MessageLine {
  return { key: catalogKey(message.code), params: message.data, scope: message.scope };
}

/**
 * Turns anything thrown by a request into a line. `ApiError` carries the server's
 * code; every other failure (a dropped connection, a bug) falls back to its own text.
 */
export function errorLine(error: unknown): MessageLine {
  if (error instanceof ApiError && error.code) {
    return messageLine({ code: error.code, data: error.data });
  }
  const text = error instanceof Error ? error.message : String(error);
  return { key: 'error.unknown', fallback: text };
}

/**
 * Like {@link errorLine}, but for a call site with a more specific catalog entry than
 * the generic unknown-error text. A failure that carries a server code still uses it —
 * `fallbackKey` only covers the codeless case (a dropped connection, a client bug),
 * where the raw text stays in `fallback` so it shows if this build lacks the key.
 */
export function errorLineWith(error: unknown, fallbackKey: string): MessageLine {
  const line = errorLine(error);
  return line.key === 'error.unknown' ? { ...line, key: fallbackKey } : line;
}

/** Generic failure buckets that wrap a more specific locally-thrown message. */
const GENERIC_FAILURE_KEYS = new Set([
  'drift.adoptFailed',
  'drift.reapplyFailed',
  'vault.deleteFailed',
  'vault.saveFailed',
  'vault.revealFailed',
  'operations.undoFailed',
  'import.failed',
  'activate.loadFailed',
  'backup.loadFailed',
  'backup.diffFailed',
]);

function shouldPreferFallback(line: MessageLine): boolean {
  if (!line.fallback) {
    return false;
  }
  if (line.key === 'error.unknown') {
    return true;
  }
  return GENERIC_FAILURE_KEYS.has(line.key);
}

export function lineText(t: TFunction, line: MessageLine): string {
  if (shouldPreferFallback(line)) {
    const text = line.fallback ?? line.key;
    return line.scope ? `${line.scope}: ${text}` : text;
  }

  const resolved = Object.fromEntries(
    Object.entries(line.paramKeys ?? {}).map(([name, key]) => [name, t(key)]),
  );
  // A code this build has no entry for still has to read as a sentence, so the generic
  // failure is tried before the key itself is ever shown.
  const text = t([line.key, 'error.unknown'], {
    ...line.params,
    ...resolved,
    defaultValue: line.fallback ?? line.key,
  });
  return line.scope ? `${line.scope}: ${text}` : text;
}

/** Convenience for the common case of rendering whatever a request threw. */
export function errorText(t: TFunction, error: unknown): string {
  return lineText(t, errorLine(error));
}

/**
 * Renders one piece of adapter-supplied form prose — a field label, its help text, a
 * select option — in the reader's language.
 *
 * The server sends both its own wording and, where the wording is prose rather than a
 * file name or a protocol id, the catalog key naming the same string. This prefers the
 * key and falls back to the wording, so an adapter that has not been given a key yet
 * still renders, just untranslated.
 */
export function specText(
  t: TFunction,
  code: string | undefined,
  fallback: string,
  params?: MessageParams,
): string {
  return code ? lineText(t, { key: code, params, fallback }) : fallback;
}

/** A field's own wording. Adapters name their fields by key, so this is a plain lookup. */
export function fieldText(t: TFunction, code: string, params?: MessageParams): string {
  return t(code, { ...params });
}

/**
 * A field's placeholder: its catalog entry when the hint is prose, and otherwise the
 * literal example the adapter supplied, which is an env var or a model id either way.
 */
export function placeholderText(t: TFunction, field: FieldSpec): string | undefined {
  return field.placeholderCode
    ? fieldText(t, field.placeholderCode, field.params)
    : field.placeholder;
}
