import type { HarnessId } from '@seaveyon/harness-switch-shared';
import { ERROR_CODES } from '@seaveyon/harness-switch-shared';
import { HttpError } from '../../common/errors';
import { createDecorator, inject } from '../../di';
import { IEnvironmentService } from '../environment';
import { ClaudeAdapter } from './claude';
import { CodexAdapter } from './codex';
import { DshAdapter } from './dsh';
import { KimiAdapter } from './kimi';
import { PiAdapter } from './pi';
import type { HarnessAdapter } from './types';

export type {
  AdapterProfile,
  AdapterTarget,
  CurrentFiles,
  HarnessAdapter,
  RenderedFiles,
} from './types';

export interface IAdapterRegistry {
  readonly _serviceBrand: undefined;
  get(id: HarnessId): HarnessAdapter;
  all(): HarnessAdapter[];
}

export const IAdapterRegistry = createDecorator<IAdapterRegistry>('adapterRegistry');

@inject(IEnvironmentService)
export class AdapterRegistry implements IAdapterRegistry {
  declare readonly _serviceBrand: undefined;

  private readonly adapters: Map<HarnessId, HarnessAdapter>;

  constructor(environment: IEnvironmentService) {
    const adapters: HarnessAdapter[] = [
      new ClaudeAdapter(environment),
      new CodexAdapter(environment),
      new KimiAdapter(environment),
      new PiAdapter(environment),
      new DshAdapter(environment),
    ];
    this.adapters = new Map(adapters.map((adapter) => [adapter.id, adapter]));
  }

  get(id: HarnessId): HarnessAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) {
      throw new HttpError(404, 'unknown harness', { code: ERROR_CODES.harnessNotFound });
    }
    return adapter;
  }

  all(): HarnessAdapter[] {
    return [...this.adapters.values()];
  }
}
