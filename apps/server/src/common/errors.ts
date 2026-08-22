import type { ErrorCode, MessageParams } from '@seaveyon/harness-switch-shared';

export type HttpErrorOptions = {
  /** Stable identifier the web UI translates instead of showing `message`. */
  code?: ErrorCode;
  /** Values the translated message interpolates. */
  params?: MessageParams;
};

export class HttpError extends Error {
  readonly code?: ErrorCode;
  readonly params?: MessageParams;

  constructor(
    readonly status: number,
    message: string,
    options: HttpErrorOptions = {},
  ) {
    super(message);
    this.name = 'HttpError';
    this.code = options.code;
    this.params = options.params;
  }
}
