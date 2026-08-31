import type {
  TransferConflictPolicy,
  TransferImportResponse,
  TransferPreview,
} from '@seaveyon/harness-switch-shared';
import { useCallback, useState } from 'react';
import { errorLine, type MessageLine } from '@/lib/messages';

/** The two options the server folds into a preview, and that invalidate it when changed. */
export type TransferImportOptions = {
  conflictPolicy: TransferConflictPolicy;
  restoreActive: boolean;
};

type UseTransferImportArgs = {
  fetchPreview: (options: TransferImportOptions) => Promise<TransferPreview>;
  runImport: (options: TransferImportOptions) => Promise<TransferImportResponse>;
  onImported: (result: TransferImportResponse) => void | Promise<void>;
};

/**
 * The inspect-then-import state machine shared by every source that speaks
 * `TransferPreview` — the encrypted file and the GitHub Gist.
 *
 * A preview is only valid for the options it was calculated with, so changing either
 * one marks it stale rather than silently importing under options the server never
 * saw. Callers supply the two requests; everything around them is identical.
 */
export function useTransferImport({ fetchPreview, runImport, onImported }: UseTransferImportArgs) {
  const [preview, setPreview] = useState<TransferPreview | null>(null);
  const [stale, setStale] = useState(false);
  const [conflictPolicy, setConflictPolicy] = useState<TransferConflictPolicy>('skip');
  const [restoreActive, setRestoreActive] = useState(true);
  const [pending, setPending] = useState<'preview' | 'import' | null>(null);
  const [error, setError] = useState<MessageLine | null>(null);

  /** Drops a preview that no longer describes what would be imported. */
  const invalidate = useCallback(() => {
    setPreview(null);
    setStale(false);
  }, []);

  const reset = useCallback(() => {
    invalidate();
    setError(null);
    setPending(null);
  }, [invalidate]);

  const inspect = useCallback(async () => {
    setPending('preview');
    setError(null);
    try {
      const result = await fetchPreview({ conflictPolicy, restoreActive });
      setPreview(result);
      setStale(false);
    } catch (caught) {
      setPreview(null);
      setError(errorLine(caught));
    } finally {
      setPending(null);
    }
  }, [fetchPreview, conflictPolicy, restoreActive]);

  const confirm = useCallback(async () => {
    if (!preview || stale) {
      return;
    }
    setPending('import');
    setError(null);
    try {
      const result = await runImport({ conflictPolicy, restoreActive });
      invalidate();
      await onImported(result);
    } catch (caught) {
      setError(errorLine(caught));
    } finally {
      setPending(null);
    }
  }, [preview, stale, runImport, conflictPolicy, restoreActive, invalidate, onImported]);

  // The server echoes the options it used; a mismatch means this preview predates an
  // edit the request has not been re-run with.
  const previewMatchesOptions =
    preview?.conflictPolicy === conflictPolicy && preview?.restoreActive === restoreActive;

  return {
    preview,
    conflictPolicy,
    restoreActive,
    pending,
    error,
    setError,
    /** True when the options moved on from the preview and it has to be re-checked. */
    stale: stale || (preview !== null && !previewMatchesOptions),
    canImport: preview !== null && previewMatchesOptions && !stale && pending === null,
    inspect,
    confirm,
    invalidate,
    reset,
    changePolicy: useCallback((next: TransferConflictPolicy) => {
      setConflictPolicy(next);
      setStale(true);
    }, []),
    changeRestoreActive: useCallback((next: boolean) => {
      setRestoreActive(next);
      setStale(true);
    }, []),
  };
}
