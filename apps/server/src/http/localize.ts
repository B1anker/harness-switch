import type { Language } from '@seaveyon/harness-switch-shared';
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

/** Adds the standard { code, data, msg } contract to nested success messages.
 *
 * Old `message`/`label`/`params` fields remain during the compatibility window so
 * existing web and CLI releases keep working. New clients can consistently prefer
 * `msg` and `data` whenever a server-reported `code` is present.
 */
function localizeResponsePayload(value: unknown, language: Language): unknown {
  if (Array.isArray(value)) return value.map((item) => localizeResponsePayload(item, language));
  if (!isRecord(value)) return value;
  const next = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, localizeResponsePayload(child, language)]),
  ) as Record<string, unknown>;
  const code = typeof value.code === 'string' ? value.code : undefined;
  const params = isMessageParams(value.params) ? value.params : undefined;
  if (code && (typeof value.message === 'string' || typeof value.label === 'string')) {
    next.data = params;
    next.msg = localizeMessage(language, code, params);
  }
  if (typeof value.noteCode === 'string' && typeof value.note === 'string') {
    next.noteData = params;
    next.noteMsg = localizeMessage(language, value.noteCode, params);
  }
  return next;
}

function isMessageParams(value: unknown): value is Record<string, string | number | boolean> {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (item) => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean',
    )
  );
}
