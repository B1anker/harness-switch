import { expect } from 'bun:test';
import type { ErrorCode } from '@seaveyon/harness-switch-shared';
import { HttpError } from '../../src/common/errors';

/**
 * Asserts the stable code rather than the prose, so rewording a message never
 * breaks a test while renaming a code — a contract the web UI depends on — always does.
 */
export function expectHttpError(run: () => unknown, code: ErrorCode, status?: number): HttpError {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(HttpError);
  const error = thrown as HttpError;
  expect(error.code).toBe(code);
  if (status !== undefined) {
    expect(error.status).toBe(status);
  }
  return error;
}
