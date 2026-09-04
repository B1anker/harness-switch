import type {
  ActivateResponse,
  CreateProfileRequest,
  HarnessesResponse,
  HarnessId,
  HarnessSummary,
  PreviewResponse,
  PreviewTarget,
  UpdateProfileRequest,
} from '@seaveyon/harness-switch-shared';
import {
  ApiError,
  api,
  harnessesPath,
  officialActivatePath,
  officialPreviewPath,
  profileActivatePath,
  profilePath,
  profilePreviewPath,
  profilesCollectionPath,
} from '@/lib/api';
import { errorLine, messageLine } from '@/lib/messages';
import type { Slice } from '../types';

export type HarnessSlice = {
  envFile: string;
  harnesses: HarnessSummary[];
  loadHarnesses: () => Promise<void>;
  createProfile: (harnessId: HarnessId, input: CreateProfileRequest) => Promise<void>;
  updateProfile: (harnessId: HarnessId, name: string, input: UpdateProfileRequest) => Promise<void>;
  deleteProfile: (harnessId: HarnessId, name: string) => Promise<void>;
  activateProfile: (harnessId: HarnessId, name: string) => Promise<void>;
  activateOfficial: (harnessId: HarnessId) => Promise<void>;
  previewProfile: (harnessId: HarnessId, name: string) => Promise<PreviewTarget[]>;
  previewOfficial: (harnessId: HarnessId) => Promise<PreviewTarget[]>;
};

export const createHarnessSlice: Slice<HarnessSlice> = (set, get) => {
  /** A switch reports through the toast and always leaves the harness list refreshed. */
  async function activate(path: string): Promise<void> {
    const result = await api<ActivateResponse>(path, { method: 'POST' });
    set({ notice: [{ key: 'notice.switchDone' }, ...result.warnings.map(messageLine)] });
    await get().loadHarnesses();
  }

  return {
    envFile: '',
    harnesses: [],

    loadHarnesses: async () => {
      set({ loading: true, error: null });
      try {
        const data = await api<HarnessesResponse>(harnessesPath());
        set({ harnesses: data.items, envFile: data.envFile, loading: false });
        // Drift depends on the active profile, so refresh it whenever the harness
        // list changes. A drift failure must never block the harness load.
        await get().loadDrift();
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          set({ authenticated: false, loading: false, harnesses: [] });
          return;
        }
        set({ loading: false, error: errorLine(error) });
      }
    },

    createProfile: async (harnessId, input) => {
      await api(profilesCollectionPath(harnessId), {
        method: 'POST',
        body: JSON.stringify(input),
      });
      await get().loadHarnesses();
    },

    updateProfile: async (harnessId, name, input) => {
      await api(profilePath(harnessId, name), {
        method: 'PATCH',
        body: JSON.stringify(input),
      });
      await get().loadHarnesses();
    },

    deleteProfile: async (harnessId, name) => {
      await api(profilePath(harnessId, name), { method: 'DELETE' });
      await get().loadHarnesses();
    },

    activateProfile: async (harnessId, name) => {
      await activate(profileActivatePath(harnessId, name));
    },

    activateOfficial: async (harnessId) => {
      await activate(officialActivatePath(harnessId));
    },

    previewProfile: async (harnessId, name) => {
      const result = await api<PreviewResponse>(profilePreviewPath(harnessId, name));
      return result.targets;
    },

    previewOfficial: async (harnessId) => {
      const result = await api<PreviewResponse>(officialPreviewPath(harnessId));
      return result.targets;
    },
  };
};
