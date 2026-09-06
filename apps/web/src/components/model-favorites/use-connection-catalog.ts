import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/stores/app-store';

export function useConnectionCatalog(providerId: string, endpointKey: string, enabled: boolean) {
  const key = `${providerId}/${endpointKey}`;
  const catalog = useAppStore((state) => state.favoriteCatalogs[key]);
  const load = useAppStore((state) => state.loadFavoriteCatalog);
  const active = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'failed'>('idle');
  const retry = useCallback(async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setStatus('loading');
    try {
      const result = await load(providerId, endpointKey, controller.signal);
      if (active.current === controller) {
        setStatus(result?.ok === false ? 'failed' : 'idle');
      }
    } catch {
      if (active.current === controller) {
        setStatus('failed');
      }
    }
  }, [load, providerId, endpointKey]);

  useEffect(() => {
    setStatus('idle');
    if (enabled && endpointKey && !useAppStore.getState().favoriteCatalogs[key]) {
      void retry();
    }
    // Each effect setup owns a request, including the second StrictMode setup.
    return () => {
      active.current?.abort();
      active.current = null;
    };
  }, [key, endpointKey, enabled, retry]);

  return { catalog, loading: status === 'loading', failed: status === 'failed', retry };
}
