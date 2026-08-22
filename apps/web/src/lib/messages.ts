import type { LocalizedMessage, MessageParams } from '@seaveyon/harness-switch-shared';
import type { TFunction } from 'i18next';
import { ApiError } from '@/lib/api';

/**
 * A message the app can hold without having picked a language yet: a catalog key
 * plus the values it interpolates.
 *
 * The store and the toast both need this. Zustand actions run outside React, so
 * they cannot call `t` — they record the key and let the component that renders
 * the message resolve it, which is also what makes an open toast follow a
 * language switch.
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

/**
 * Catalog key for a server-reported code.
 *
 * Warning codes already carry their `warning.` namespace, so they map straight to
 * a key; error codes are bare (`adapter.modelRequired`) and get the `error.` prefix.
 */
export function catalogKey(code: string): string {
  if (code.startsWith('warning.') || code.startsWith('error.')) {
    return code;
  }
  return `error.${code}`;
}

/** Turns a server-reported message into a line, preferring its code over its prose. */
export function messageLine(message: LocalizedMessage): MessageLine {
  return message.code
    ? {
        key: catalogKey(message.code),
        params: message.params,
        scope: message.scope,
        fallback: message.message,
      }
    : // No code means an older server, or a message not part of the contract yet.
      { key: 'error.unknown', fallback: message.message, scope: message.scope };
}

/**
 * Turns anything thrown by a request into a line. `ApiError` carries the server's
 * code; every other failure (a dropped connection, a bug) falls back to its own text.
 */
export function errorLine(error: unknown): MessageLine {
  if (error instanceof ApiError) {
    return messageLine({ message: error.message, code: error.code, params: error.params });
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

/**
 * Resolves a line in the current language, falling back to the server's prose for a
 * code this build does not know, and prefixing the untranslated scope when there is one.
 */
/** Generic failure buckets that wrap a more specific server or thrown message. */
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
  const text = t(line.key, {
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
