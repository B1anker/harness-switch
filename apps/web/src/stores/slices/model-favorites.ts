import type {
  FavoriteBackupEntry,
  FavoriteBackupPreview,
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
import { ERROR_CODES } from '@seaveyon/harness-switch-shared';
import {
  ApiError,
  api,
  favoriteApplyPath,
  favoriteBackupPreviewPath,
  favoriteBackupsPath,
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
  favoriteBackups: FavoriteBackupEntry[];
  favoriteBackupPreview: FavoriteBackupPreview | null;
  previewFavoriteBackup(id: string): Promise<void>;
  loadFavoriteBackups(): Promise<void>;
  createFavoriteBackup(): Promise<void>;
  restoreFavoriteBackup(id: string, fingerprint: string): Promise<void>;
  favoriteTargets: Record<
    string,
    Array<{
      harness: HarnessId;
      connections: Array<{ id: string; projection: FavoriteProjectionResult }>;
    }>
  >;
  loadFavoriteTargets(id: string): Promise<void>;
  favoriteCatalogs: Record<string, ProbeResult>;
  loadFavoriteCatalog(providerId: string, endpointKey: string): Promise<ProbeResult>;
  favorites: FavoriteListItem[] | null;
  favoritesLoading: boolean;
  favoritesError: MessageLine | null;
  favoritePlan: FavoritePlan | null;
  favoriteOperation: FavoriteOperation | null;
  favoriteOperationHistory: FavoriteOperation[];
  loadFavorites(): Promise<void>;
  saveFavorite(input: FavoriteInput, existing?: ModelFavorite): Promise<ModelFavorite>;
  deleteFavorite(favorite: ModelFavorite): Promise<void>;
  captureFavorite(
    harness: HarnessId,
    name: string,
    favoriteName: string,
    extractCredential: boolean,
    linkSource: boolean,
  ): Promise<void>;
  planFavorite(request: FavoritePlanRequest): Promise<void>;
  applyFavorite(requestId: string): Promise<FavoriteOperation | undefined>;
  detachFavorite(harness: HarnessId, name: string): Promise<void>;
  clearFavoritePlan(): void;
};
export const createFavoriteSlice: Slice<FavoriteSlice> = (set, get) => {
  let previewRequest = 0;
  let planRequest = 0;
  return {
    favoriteBackups: [],
    favoriteBackupPreview: null,
    previewFavoriteBackup: async (id) => {
      const request = ++previewRequest;
      const user = get().currentUser;
      set({ favoriteBackupPreview: null });
      const result = await api<{ data: FavoriteBackupPreview }>(favoriteBackupPreviewPath(id));
      if (user === get().currentUser && request === previewRequest) {
        set({ favoriteBackupPreview: result.data });
      }
    },
    loadFavoriteBackups: async () => {
      const user = get().currentUser;
      const result = await api<{ data: FavoriteBackupEntry[] }>(favoriteBackupsPath());
      if (user === get().currentUser) {
        set({ favoriteBackups: result.data });
      }
    },
    createFavoriteBackup: async () => {
      await api(favoriteBackupsPath(), { method: 'POST' });
      await get().loadFavoriteBackups();
    },
    restoreFavoriteBackup: async (id, fingerprint) => {
      previewRequest++;
      planRequest++;
      const user = get().currentUser;
      await api(favoriteBackupsPath(id), { method: 'POST', body: JSON.stringify({ fingerprint }) });
      if (user !== get().currentUser) {
        return;
      }
      set({
        favoritePlan: null,
        favoriteBackupPreview: null,
        favoriteOperation: null,
        favoriteOperationHistory: [],
        favoriteTargets: {},
        favoriteCatalogs: {},
      });
      await Promise.all([
        get().loadFavoriteBackups(),
        get().loadFavorites(),
        get().loadHarnesses(),
        get().loadProviders(),
        get().loadBackups(),
      ]);
    },
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
      return result.result;
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
      const result = await api<{ data: ModelFavorite }>(
        existing ? favoritePath(existing.id) : favoritesPath(),
        {
          method: existing ? 'PATCH' : 'POST',
          body: JSON.stringify(body),
        },
      );
      await get().loadFavorites();
      return result.data;
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
      const sequence = ++planRequest;
      const user = get().currentUser;
      set({ favoritePlan: null, favoriteOperation: null });
      const result = await api<{ data: FavoritePlan }>(favoritePlansPath(), {
        method: 'POST',
        body: JSON.stringify(request),
      });
      if (user === get().currentUser && sequence === planRequest) {
        set({ favoritePlan: result.data });
      }
    },
    applyFavorite: async (requestId) => {
      const plan = get().favoritePlan;
      const user = get().currentUser;
      const sequence = planRequest;
      if (!plan) {
        return;
      }
      const submit = () =>
        api<{ data: FavoriteOperation }>(favoriteApplyPath(plan.id), {
          method: 'POST',
          body: JSON.stringify({ requestId }),
        });
      let result: { data: FavoriteOperation };
      try {
        result = await submit();
      } catch (error) {
        if (user !== get().currentUser || sequence !== planRequest) {
          return;
        }
        // A stale fingerprint can be detected after earlier tools were written. Reuse
        // the request to recover their receipts before allowing a fresh preview.
        if (error instanceof ApiError && error.code === ERROR_CODES.favoritePlanStale) {
          result = await submit();
        } else {
          throw error;
        }
      }
      if (user !== get().currentUser || sequence !== planRequest) {
        return;
      }
      const operation: FavoriteOperation = {
        requestId: result.data.requestId,
        items: plan.items.map(
          (item) =>
            result.data.items.find((entry) => entry.harness === item.harness) ?? {
              harness: item.harness,
              profile: item.profile,
              status: 'skipped',
            },
        ),
      };
      const saved = operation.items.filter(
        (item) =>
          item.status === 'applied' &&
          plan.items.find((entry) => entry.harness === item.harness)?.mode === 'save',
      ).length;
      const activated = operation.items.filter(
        (item) =>
          item.status === 'applied' &&
          plan.items.find((entry) => entry.harness === item.harness)?.mode === 'activate',
      ).length;
      const counts = [
        ['favorites.resultNoticeSaved', saved],
        ['favorites.resultNoticeActivated', activated],
        [
          'favorites.resultNoticeUnchanged',
          operation.items.filter((item) => item.status === 'unchanged').length,
        ],
        [
          'favorites.resultNoticeFailed',
          operation.items.filter((item) => item.status === 'failed').length,
        ],
        [
          'favorites.resultNoticeSkipped',
          operation.items.filter((item) => item.status === 'skipped').length,
        ],
      ] as const;
      set({
        favoriteOperation: operation,
        favoriteOperationHistory: [
          ...get().favoriteOperationHistory.filter((entry) => entry.requestId !== requestId),
          operation,
        ].slice(-10),
        notice: counts
          .filter(([, count]) => count > 0)
          .map(([key, count]) => ({ key, params: { count } })),
      });
      await Promise.all([get().loadFavorites(), get().loadHarnesses()]);
      if (user === get().currentUser && sequence === planRequest) {
        return operation;
      }
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
    clearFavoritePlan: () => {
      planRequest++;
      set({ favoritePlan: null, favoriteOperation: null });
    },
  };
};
