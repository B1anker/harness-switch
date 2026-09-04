import { useAppStore } from '@/stores/app-store';

type AppState = ReturnType<typeof useAppStore.getState>;

const initialState = useAppStore.getState();

/**
 * Seeds the store for one test.
 *
 * Eight files wrote `useAppStore.setState({ … } as Partial<AppState> as never)`; the double
 * cast is there because zustand's `setState` rejects a partial that omits the actions, and
 * spelling it out at every call site invited each one to widen it a little differently.
 */
export function setStoreState(partial: Partial<AppState>): void {
  useAppStore.setState(partial as never);
}

/**
 * Replaces async actions with recorders, so a component test asserts what the component
 * asked for without touching the network.
 */
export function stubStoreActions<K extends keyof AppState>(keys: K[]): Record<K, unknown[][]> {
  const calls = {} as Record<K, unknown[][]>;
  const patch: Record<string, unknown> = {};
  for (const key of keys) {
    calls[key] = [];
    patch[key as string] = async (...args: unknown[]) => {
      calls[key].push(args);
    };
  }
  setStoreState(patch as Partial<AppState>);
  return calls;
}

/**
 * Called from the global teardown. Restoring the whole snapshot — rather than the handful
 * of keys each file happened to remember — is what lets a test seed only what it reads.
 */
export function resetStore(): void {
  useAppStore.setState(initialState, true);
}
