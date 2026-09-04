import type { HarnessId } from '@seaveyon/harness-switch-shared';
import type { AppState } from '../types';

/**
 * Folds a per-harness response into the collection already held.
 *
 * Doctor and operations are both loaded one harness at a time into a list that spans all
 * of them, so a fresh read has to replace that harness's entries without disturbing the
 * others'.
 */
export function byHarness<T extends { harness: string }>(
  previous: T[] | null,
  incoming: T[],
  harnessId: HarnessId,
): T[] {
  return [
    ...(previous ?? []).filter((item) => item.harness !== harnessId),
    ...incoming.filter((item) => item.harness === harnessId),
  ];
}

/** The display name for a toast, falling back to the id before the list has loaded. */
export function harnessLabel(state: AppState, harnessId: string): string {
  return state.harnesses.find((item) => item.id === harnessId)?.label ?? harnessId;
}
