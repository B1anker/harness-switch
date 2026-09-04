import { ApiError } from '@/lib/api';
import { errorLine, type MessageLine } from '@/lib/messages';
import type { AppState, SetState } from './types';

/** The collections that carry their own `{ x, xLoading, xError }` triple. */
type ResourceName = 'providers' | 'doctor' | 'drift' | 'scan' | 'operations' | 'githubStatus';

/**
 * Runs one load into a `{ x, xLoading, xError }` triple.
 *
 * Five actions spelled out the same four steps — raise the flag, read, lower it, translate
 * the failure — and the one interesting line sat in the middle of them. An expired session
 * is not a failure the panel should render: it drops the user back to the login screen and
 * empties the collection, so a stale list is not left for whoever logs in next.
 */
export async function loadResource<N extends ResourceName>(
  set: SetState,
  name: N,
  read: () => Promise<AppState[N]>,
): Promise<void> {
  set(flags(name, true, null));
  try {
    const value = await read();
    set({ ...assign(name, value), ...flags(name, false, null) });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      // Arrays go back to `[]` so list UIs stay typed; the single github status object
      // has no empty list shape, so it clears to null like an unread cache.
      set({
        authenticated: false,
        ...assign(name, name === 'githubStatus' ? null : []),
        ...flags(name, false, null),
      });
      return;
    }
    set(flags(name, false, errorLine(error)));
  }
}

// Spreading a computed key drops the tie between `providers` and `providersLoading` as far
// as the checker is concerned; the casts stay here rather than at every call site.
function assign(name: ResourceName, value: unknown): Partial<AppState> {
  return { [name]: value } as Partial<AppState>;
}

function flags(name: ResourceName, loading: boolean, error: MessageLine | null): Partial<AppState> {
  return { [`${name}Loading`]: loading, [`${name}Error`]: error } as Partial<AppState>;
}
