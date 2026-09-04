import type { Language } from '@seaveyon/harness-switch-shared';
import { isMessageCode } from '@seaveyon/harness-switch-shared';
import type { MiddlewareHandler } from 'hono';
import { isRecord } from '../common/guards';
import { localizeMessage, requestLanguage } from '../common/localize';

/**
 * Resolves the `msg` of every server-reported `code` in a JSON response against the
 * caller's `Accept-Language`, so route handlers only ever emit codes.
 */
export function createLocalizeMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    const contentType = c.res.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json') || !c.res.ok) return;
    const payload = await c.res
      .clone()
      .json()
      .catch(() => undefined);
    if (payload === undefined) return;
    const localized = localizeResponsePayload(
      payload,
      requestLanguage(c.req.header('Accept-Language')),
    );
    c.res = new Response(JSON.stringify(localized), c.res);
  };
}

/**
 * Adds the `msg` beside every message code in the payload.
 *
 * Codes travel in families — `code`/`data`/`msg`, and the same triple under a `note` or
 * `block` prefix for nodes that carry a second, subordinate message. Resolving them by
 * suffix keeps this one walk correct as new families appear, and `isMessageCode` is what
 * separates a message node from a record that happens to have a `code` column.
 */
function localizeResponsePayload(value: unknown, language: Language): unknown {
  if (Array.isArray(value)) return value.map((item) => localizeResponsePayload(item, language));
  if (!isRecord(value)) return value;
  const next = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, localizeResponsePayload(child, language)]),
  ) as Record<string, unknown>;
  for (const [key, code] of Object.entries(value)) {
    const prefix = codeFieldPrefix(key);
    if (prefix === undefined || !isMessageCode(code)) continue;
    const raw = value[sibling(prefix, 'data')];
    next[sibling(prefix, 'msg')] = localizeMessage(
      language,
      code,
      isMessageParams(raw) ? raw : undefined,
    );
  }
  return next;
}

/** The family a code field names: `code` heads the bare one, `noteCode` the `note` one. */
function codeFieldPrefix(key: string): string | undefined {
  if (key === 'code') return '';
  return key.endsWith('Code') ? key.slice(0, -'Code'.length) : undefined;
}

function sibling(prefix: string, name: 'data' | 'msg'): string {
  return prefix === '' ? name : `${prefix}${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

function isMessageParams(value: unknown): value is Record<string, string | number | boolean> {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (item) => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean',
    )
  );
}
