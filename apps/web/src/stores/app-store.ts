import type {
  ActivateResponse,
  BackupEntry,
  BackupsResponse,
  CreateProfileRequest,
  HarnessesResponse,
  HarnessId,
  HarnessSummary,
  PreviewResponse,
  PreviewTarget,
  UpdateProfileRequest,
} from '@seaveyon/harness-switch-shared';
import { create } from 'zustand';
import { ApiError, api, backupsPath, profilePath, profilesCollectionPath } from '@/lib/api';

type AppState = {
  sessionChecked: boolean;
  authenticated: boolean;
  loading: boolean;
  error: string | null;
  envFile: string;
  harnesses: HarnessSummary[];
  backups: BackupEntry[];
  notice: string | null;
  loadSession: () => Promise<void>;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  loadHarnesses: () => Promise<void>;
  createProfile: (harnessId: HarnessId, input: CreateProfileRequest) => Promise<void>;
  updateProfile: (harnessId: HarnessId, name: string, input: UpdateProfileRequest) => Promise<void>;
  deleteProfile: (harnessId: HarnessId, name: string) => Promise<void>;
  activateProfile: (harnessId: HarnessId, name: string) => Promise<void>;
  previewProfile: (harnessId: HarnessId, name: string) => Promise<PreviewTarget[]>;
  loadBackups: () => Promise<void>;
  restoreBackup: (id: string) => Promise<void>;
  clearNotice: () => void;
};

export const useAppStore = create<AppState>((set, get) => ({
  sessionChecked: false,
  authenticated: false,
  loading: false,
  error: null,
  envFile: '',
  harnesses: [],
  backups: [],
  notice: null,

  loadSession: async () => {
    try {
      await api('/api/auth/session');
      set({ authenticated: true, sessionChecked: true, error: null });
      await get().loadHarnesses();
    } catch (error) {
      set({
        authenticated: false,
        sessionChecked: true,
        error: error instanceof ApiError && error.status === 401 ? null : (error as Error).message,
      });
    }
  },

  login: async (password) => {
    set({ loading: true, error: null });
    try {
      await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      set({ authenticated: true, loading: false });
      await get().loadHarnesses();
    } catch (error) {
      set({ loading: false, error: (error as Error).message });
      throw error;
    }
  },

  logout: async () => {
    await api('/api/auth/logout', { method: 'POST' });
    set({ authenticated: false, harnesses: [], backups: [], envFile: '' });
  },

  loadHarnesses: async () => {
    set({ loading: true, error: null });
    try {
      const data = await api<HarnessesResponse>('/api/harnesses');
      set({ harnesses: data.items, envFile: data.envFile, loading: false });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        set({ authenticated: false, loading: false, harnesses: [] });
        return;
      }
      set({ loading: false, error: (error as Error).message });
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
    const result = await api<ActivateResponse>(`${profilePath(harnessId, name)}/activate`, {
      method: 'POST',
    });
    const label = get().harnesses.find((item) => item.id === harnessId)?.label ?? harnessId;
    const lines = [
      `${label} 已切换到「${name}」，原生配置文件已写入。`,
      'Claude Code 会立即生效；Codex、Kimi Code、oh-my-pi 需要重新启动进程。',
      ...result.warnings.map((warning) => `注意：${warning}`),
    ];
    set({ notice: lines.join('\n') });
    await get().loadHarnesses();
  },

  previewProfile: async (harnessId, name) => {
    const result = await api<PreviewResponse>(`${profilePath(harnessId, name)}/preview`);
    return result.targets;
  },

  loadBackups: async () => {
    try {
      const data = await api<BackupsResponse>(backupsPath());
      set({ backups: data.items });
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) {
        set({ error: (error as Error).message });
      }
    }
  },

  restoreBackup: async (id) => {
    await api(`${backupsPath(id)}/restore`, { method: 'POST' });
    set({ notice: '已把备份中的原始文件写回磁盘。' });
    await get().loadHarnesses();
  },

  clearNotice: () => set({ notice: null }),
}));
