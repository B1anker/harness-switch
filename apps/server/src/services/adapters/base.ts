import type { ErrorCode, HarnessId } from '@seaveyon/harness-switch-shared';
import { ERROR_CODES, HARNESS_LABELS } from '@seaveyon/harness-switch-shared';
import { HttpError } from '../../common/errors';
import type { IEnvironmentService } from '../environment';
import type { AdapterProfile } from './types';

/** A profile value a harness cannot render without. */
export type RequiredValue = 'model' | 'apiKey';

const REQUIRED_CODES: Record<RequiredValue, ErrorCode> = {
  model: ERROR_CODES.adapterModelRequired,
  apiKey: ERROR_CODES.adapterApiKeyRequired,
};

/** Fallback prose only. What the user sees comes from the catalog entry for the code. */
const REQUIRED_PROSE: Record<RequiredValue, string> = {
  model: '需要填写模型名称',
  apiKey: '需要填写 API key',
};

/**
 * What every adapter shares: the environment handle its targets resolve against, and the
 * up-front check that a profile carries the values this harness cannot render without.
 *
 * `validate` runs before anything is stored or written, so a profile that could only
 * produce a half-usable config file never reaches one.
 */
export abstract class BaseAdapter {
  abstract readonly id: HarnessId;

  /** Values this harness refuses to render without. Empty means nothing is mandatory. */
  protected readonly requires: readonly RequiredValue[] = [];

  constructor(protected readonly environment: IEnvironmentService) {}

  validate(profile: AdapterProfile): void {
    const harness = HARNESS_LABELS[this.id];
    for (const value of this.requires) {
      if (profile[value].trim()) {
        continue;
      }
      throw new HttpError(400, `${harness} ${REQUIRED_PROSE[value]}`, {
        code: REQUIRED_CODES[value],
        params: { harness },
      });
    }
  }
}
