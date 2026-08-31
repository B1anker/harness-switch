import {
  ERROR_CODES,
  HARNESS_IDS,
  HARNESS_LABELS,
  type HarnessId,
  isHarnessId,
} from '@seaveyon/harness-switch-shared';
import { HttpError } from '../common/errors';
import { createDecorator } from '../di';

export type HarnessDefinition = {
  id: HarnessId;
  label: string;
};

export interface IHarnessRegistry {
  readonly _serviceBrand: undefined;
  list(): HarnessDefinition[];
  has(id: string): id is HarnessId;
  require(id: string): HarnessId;
  label(id: HarnessId): string;
}

export const IHarnessRegistry = createDecorator<IHarnessRegistry>('harnessRegistry');

export class HarnessRegistry implements IHarnessRegistry {
  declare readonly _serviceBrand: undefined;

  list(): HarnessDefinition[] {
    return HARNESS_IDS.map((id) => ({ id, label: HARNESS_LABELS[id] }));
  }

  has(id: string): id is HarnessId {
    return isHarnessId(id);
  }

  require(id: string): HarnessId {
    if (!this.has(id)) {
      throw new HttpError(404, 'unknown harness', { code: ERROR_CODES.harnessNotFound });
    }
    return id;
  }

  label(id: HarnessId): string {
    return HARNESS_LABELS[id];
  }
}
