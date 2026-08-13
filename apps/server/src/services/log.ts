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
    if (error) {
      console.error(`[harness-switch] ${message}`, error);
      return;
    }
    console.error(`[harness-switch] ${message}`);
  }
}
