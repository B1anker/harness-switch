import type {
  FavoriteInput,
  FavoriteOperation,
  FavoritePlan,
  FavoritePlanRequest,
  FavoriteProjectionResult,
  HarnessId,
  ModelFavorite,
  ProbeResult,
  UpdateFavoriteRequest,
} from '@seaveyon/harness-switch-shared';
import {
  api,
  favoriteApplyPath,
  favoritePath,
  favoritePlansPath,
  favoriteSourcePath,
  favoritesPath,
  favoriteTargetsPath,
  providerProbePath,
} from '@/lib/api';
import type { MessageLine } from '@/lib/messages';
import { loadResource } from '../resource';
import type { Slice } from '../types';

export type FavoriteListItem = ModelFavorite & {
  references: Array<{
    harness: HarnessId;
    name: string;
    needsUpdate: boolean;
    diverged: boolean;
    sourceMissing: boolean;
    connectionMissing: boolean;
  }>;
};
export type FavoriteSlice = {
  favoriteTargets: Record<
    string,
    Array<{
      harness: HarnessId;
      connections: Array<{ id: string; projection: FavoriteProjectionResult }>;
    }>
  >;
  loadFavoriteTargets(id: string): Promise<void>;
  favoriteCatalogs: Record<string, ProbeResult>;
  loadFavoriteCatalog(providerId: string, endpointKey: string): Promise<void>;
  favorites: FavoriteListItem[] | null;
  favoritesLoading: boolean;
  favoritesError: MessageLine | null;
  favoritePlan: FavoritePlan | null;
  favoriteOperation: FavoriteOperation | null;
  favoriteOperationHistory: FavoriteOperation[];
  loadFavorites(): Promise<void>;
  saveFavorite(input: FavoriteInput, existing?: ModelFavorite): Promise<void>;
  deleteFavorite(favorite: ModelFavorite): Promise<void>;
  captureFavorite(
    harness: HarnessId,
    name: string,
    favoriteName: string,
    extractCredential: boolean,
    linkSource: boolean,
  ): Promise<void>;
  planFavorite(request: FavoritePlanRequest): Promise<void>;
  applyFavorite(requestId: string): Promise<void>;
  detachFavorite(harness: HarnessId, name: string): Promise<void>;
  clearFavoritePlan(): void;
};
export const createFavoriteSlice: Slice<FavoriteSlice> = (set, get) => ({
  favoriteTargets: {},
  loadFavoriteTargets: async (id) => {
    const user = get().currentUser;
    const result = await api<{ data: FavoriteSlice['favoriteTargets'][string] }>(
      favoriteTargetsPath(id),
    );
    if (user === get().currentUser) {
      set({ favoriteTargets: { ...get().favoriteTargets, [id]: result.data } });
    }
  },
  favoriteCatalogs: {},
  loadFavoriteCatalog: async (providerId, endpointKey) => {
    const user = get().currentUser;
    const result = await api<{ result: ProbeResult }>(providerProbePath(providerId), {
      method: 'POST',
      body: JSON.stringify({ endpoint: endpointKey, completion: false }),
    });
    if (get().currentUser === user) {
      set({
        favoriteCatalogs: {
          ...get().favoriteCatalogs,
          [`${providerId}/${endpointKey}`]: result.result,
        },
      });
    }
  },
  favorites: null,
  favoritesLoading: false,
  favoritesError: null,
  favoritePlan: null,
  favoriteOperation: null,
  favoriteOperationHistory: [],
  loadFavorites: async () => {
    if (get().favoritesLoading) {
      return;
    }
    const user = get().currentUser;
    await loadResource(set, 'favorites', async () => {
      const result = await api<{ data: FavoriteListItem[] }>(favoritesPath());
      return user === get().currentUser ? result.data : get().favorites;
    });
  },
  saveFavorite: async (input, existing) => {
    const body: FavoriteInput | UpdateFavoriteRequest = existing
      ? { ...input, expectedRevision: existing.revision }
      : input;
    await api(existing ? favoritePath(existing.id) : favoritesPath(), {
      method: existing ? 'PATCH' : 'POST',
      body: JSON.stringify(body),
    });
    await get().loadFavorites();
  },
  deleteFavorite: async (favorite) => {
    await api(favoritePath(favorite.id), {
      method: 'DELETE',
      body: JSON.stringify({ expectedRevision: favorite.revision }),
    });
    await get().loadFavorites();
  },
  captureFavorite: async (harness, name, favoriteName, extractCredential, linkSource) => {
    const source = await api<{ data: { sourceFingerprint: string } }>(
      favoriteSourcePath(harness, name),
    );
    await api(favoritesPath('from-profile'), {
      method: 'POST',
      body: JSON.stringify({
        harness,
        name,
        favoriteName,
        extractCredential,
        linkSource,
        ...source.data,
      }),
    });
    await Promise.all([get().loadFavorites(), get().loadHarnesses(), get().loadProviders()]);
  },
  planFavorite: async (request) => {
    const user = get().currentUser;
    set({ favoritePlan: null, favoriteOperation: null });
    const result = await api<{ data: FavoritePlan }>(favoritePlansPath(), {
      method: 'POST',
      body: JSON.stringify(request),
    });
    if (user === get().currentUser) {
      set({ favoritePlan: result.data });
    }
  },
  applyFavorite: async (requestId) => {
    const plan = get().favoritePlan;
    const user = get().currentUser;
    if (!plan) {
      return;
    }
    const result = await api<{ data: FavoriteOperation }>(favoriteApplyPath(plan.id), {
      method: 'POST',
      body: JSON.stringify({ requestId }),
    });
    if (user !== get().currentUser) {
      return;
    }
    set({
      favoriteOperation: result.data,
      favoriteOperationHistory: [...get().favoriteOperationHistory, result.data].slice(-10),
    });
    await Promise.all([get().loadFavorites(), get().loadHarnesses()]);
  },
  detachFavorite: async (harness, name) => {
    const source = await api<{ data: { sourceFingerprint: string } }>(
      favoriteSourcePath(harness, name),
    );
    await api(favoriteSourcePath(harness, name, true), {
      method: 'POST',
      body: JSON.stringify(source.data),
    });
    await Promise.all([get().loadFavorites(), get().loadHarnesses()]);
  },
  clearFavoritePlan: () => set({ favoritePlan: null, favoriteOperation: null }),
});
