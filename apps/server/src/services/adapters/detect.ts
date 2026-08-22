import type { AdapterProfile } from './types';

/**
 * One provider an adapter recognised in the tool's own config files.
 *
 * Detection reuses each adapter's `backfill`, which reads a provider entry back into
 * profile values. The difference is that backfill knows which entry to look at because a
 * profile already names it, while a scan has to enumerate what is there first.
 */
export type DetectedProfile = {
  /** The provider id in the tool's own file; it also makes the best profile name. */
  key: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  extras: Record<string, string>;
  /** True when the tool is currently pointed at this provider. */
  active: boolean;
};

/** A throwaway profile that only exists to tell `backfill` which entry to read. */
export function seedProfile(extras: Record<string, string> = {}): AdapterProfile {
  return { name: '', baseUrl: '', apiKey: '', model: '', extras };
}

/**
 * Turns backfilled values into a candidate, dropping entries with neither an endpoint
 * nor a credential: those carry nothing worth importing and would only be noise in the
 * wizard.
 */
export function toCandidate(
  key: string,
  seed: AdapterProfile,
  values: Partial<AdapterProfile>,
  active: boolean,
): DetectedProfile | null {
  const baseUrl = values.baseUrl ?? '';
  const apiKey = values.apiKey ?? '';
  if (!baseUrl && !apiKey) {
    return null;
  }
  return {
    key,
    baseUrl,
    apiKey,
    model: values.model ?? '',
    extras: { ...seed.extras, ...values.extras },
    active,
  };
}

export function compact(candidates: Array<DetectedProfile | null>): DetectedProfile[] {
  return candidates.filter((candidate): candidate is DetectedProfile => candidate !== null);
}
