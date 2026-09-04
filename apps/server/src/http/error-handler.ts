import type { ErrorCode, ErrorResponse, MessageParams } from '@seaveyon/harness-switch-shared';
import { ERROR_CODES } from '@seaveyon/harness-switch-shared';
import type { Context, Hono } from 'hono';
import { HttpError } from '../common/errors';
import { localizeMessage, requestLanguage } from '../common/localize';
import type { ILogService } from '../services/log';

/** Turns every unmatched route and every thrown error into the `{ code, data, msg }` contract. */
export function registerErrorHandlers(app: Hono, log: ILogService): void {
  app.notFound((c) => fail(c, ERROR_CODES.requestFailed, 404));

  app.onError((error, c) => {
    const request = `${c.req.method} ${new URL(c.req.url).pathname}`;
    if (error instanceof HttpError) {
      // A 4xx is a normal answer to a bad request and stays silent; a 5xx is a server
      // fault that has to leave a trace even when the response body is deliberately terse.
      if (error.status >= 500) {
        log.error(`${request} failed with ${error.status}: ${error.message}`, error);
      }
      return fail(c, error.code, error.status, error.params);
    }
    log.error(`unhandled error on ${request}`, error);
    return fail(c, ERROR_CODES.internalServerError, 500);
  });
}

function fail(c: Context, code: ErrorCode, status: number, data?: MessageParams): Response {
  return c.json(
    {
      code,
      ...(data ? { data } : {}),
      msg: localizeMessage(requestLanguage(c.req.header('Accept-Language')), code, data),
    } satisfies ErrorResponse,
    status as 400,
  );
}
