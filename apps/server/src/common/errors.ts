import { ERROR_CODES, type ErrorCode, type MessageParams } from '@seaveyon/harness-switch-shared';

export type HttpErrorOptions = {
  /** Stable identifier the web UI translates instead of showing `message`. */
  code?: ErrorCode;
  /** Values the translated message interpolates. */
  params?: MessageParams;
};

export class HttpError extends Error {
  readonly code: ErrorCode;
  readonly params?: MessageParams;

  constructor(
    readonly status: number,
    message: string,
    options: HttpErrorOptions = {},
  ) {
    super(message);
    this.name = 'HttpError';
    // A code is mandatory at the HTTP boundary. Older call sites deliberately fall
    // back to a safe generic code until they gain a more specific one.
    this.code = options.code ?? ERROR_CODES.requestFailed;
    this.params = options.params;
  }
}
