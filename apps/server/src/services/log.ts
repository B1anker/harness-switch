import { createDecorator } from '../di';

export interface ILogService {
  readonly _serviceBrand: undefined;
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
}

export const ILogService = createDecorator<ILogService>('logService');

export class LogService implements ILogService {
  declare readonly _serviceBrand: undefined;

  info(message: string): void {
    console.log(`[harness-switch] ${message}`);
  }

  warn(message: string): void {
    console.warn(`[harness-switch] ${message}`);
  }

  error(message: string, error?: unknown): void {
    // Keep an error on one line. The dev task runner elides long multi-line stack
    // traces, which can hide the errno and path needed to diagnose filesystem errors.
    console.error(`[harness-switch] ${message}${formatError(error)}`);
  }
}

function formatError(error: unknown): string {
  if (error === undefined) {
    return '';
  }
  if (!(error instanceof Error)) {
    return ` | thrown=${String(error)}`;
  }

  const errno = error as NodeJS.ErrnoException;
  const details = [`${error.name}: ${error.message}`];
  if (errno.code) {
    details.push(`code=${errno.code}`);
  }
  if (errno.syscall) {
    details.push(`syscall=${errno.syscall}`);
  }
  if (errno.path) {
    details.push(`path=${errno.path}`);
  }
  return ` | ${details.join(' | ')}`;
}
