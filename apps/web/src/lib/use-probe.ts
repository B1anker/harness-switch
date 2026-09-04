import type { ProbeResult } from '@seaveyon/harness-switch-shared';
import { useEffect, useState } from 'react';

export type Probe = {
  pending: boolean;
  result: ProbeResult | null;
  /** Runs the request and keeps its verdict. Rethrows, so the caller places the failure. */
  run: (request: () => Promise<ProbeResult>) => Promise<void>;
};

/**
 * A connectivity probe and the verdict it left behind.
 *
 * A verdict describes one exact combination of URL and credential, so it is dropped as soon
 * as `signature` changes rather than left sitting beside values it never saw. Doing that
 * during render rather than in an effect means a stale "reachable" is never painted, not
 * even for the frame before the effect runs.
 *
 * Failures are rethrown rather than stored: the profile dialog reports them in its
 * form-level banner and the vault editor inline beside the button, and neither placement is
 * this hook's business.
 */
export function useProbe(signature: string): Probe {
  const [pending, setPending] = useState(false);
  const [held, setHeld] = useState<{ signature: string; result: ProbeResult | null }>({
    signature,
    result: null,
  });

  return {
    pending,
    result: held.signature === signature ? held.result : null,
    run: async (request) => {
      setPending(true);
      setHeld({ signature, result: null });
      try {
        setHeld({ signature, result: await request() });
      } finally {
        setPending(false);
      }
    },
  };
}

/**
 * Loads a collection the first time a dialog needs it.
 *
 * `null` is the store's "never loaded" for these, distinct from an empty list, so this must
 * not re-fire once a load has come back with nothing. `enabled` is for the dialogs that
 * stay mounted while closed and should not fetch until they are shown.
 */
export function useEnsureLoaded(value: unknown, load: () => Promise<void>, enabled = true): void {
  useEffect(() => {
    if (enabled && value === null) {
      void load();
    }
  }, [enabled, value, load]);
}
