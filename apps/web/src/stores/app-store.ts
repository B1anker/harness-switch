import type {
  ActivateResponse,
  BackupDetail,
  BackupEntry,
  BackupsResponse,
  CreateProfileRequest,
  CreateProviderRequest,
  DoctorReport,
  DoctorResponse,
  DriftAdoptResponse,
  DriftFileState,
  DriftReapplyResponse,
  DriftResponse,
  DriftSummary,
  HarnessesResponse,
  HarnessId,
  HarnessSummary,
  PreviewResponse,
  PreviewTarget,
  ProviderMutationResponse,
  ProviderPublic,
  ProvidersResponse,
  UpdateProfileRequest,
  UpdateProviderRequest,
} from '@seaveyon/harness-switch-shared';
import { create } from 'zustand';
import {
  ApiError,
  api,
  backupsPath,
  doctorPath,
  driftAdoptPath,
  driftPath,
  driftReapplyPath,
  profilePath,
  profilesCollectionPath,
  providerPath,
  providersPath,
} from '@/lib/api';

type AppState = {
  sessionChecked: boolean;
  authenticated: boolean;
  loading: boolean;
  error: string | null;
  envFile: string;
  harnesses: HarnessSummary[];
  backups: BackupEntry[];
  notice: string | null;
  /** Provider Vault entries; null until the first successful load. */
  providers: ProviderPublic[] | null;
  providersLoading: boolean;
  providersError: string | null;
  /** Doctor reports, one per harness; null until the first run. */
  doctor: DoctorReport[] | null;
  /** True when a newer release exists on the registry. */
  doctorUpdatedAvailable: boolean;
  doctorLoading: boolean;
  doctorError: string | null;
  /** Drift report per harness; null until the first load. */
  drift: DriftSummary[] | null;
  driftLoading: boolean;
  driftError: string | null;
  loadSession: () => Promise<void>;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  loadHarnesses: () => Promise<void>;
  createProfile: (harnessId: HarnessId, input: CreateProfileRequest) => Promise<void>;
  updateProfile: (harnessId: HarnessId, name: string, input: UpdateProfileRequest) => Promise<void>;
  deleteProfile: (harnessId: HarnessId, name: string) => Promise<void>;
  activateProfile: (harnessId: HarnessId, name: string) => Promise<void>;
  activateOfficial: (harnessId: HarnessId) => Promise<void>;
  previewProfile: (harnessId: HarnessId, name: string) => Promise<PreviewTarget[]>;
  loadBackups: () => Promise<void>;
  loadBackupDetail: (id: string) => Promise<BackupDetail>;
  restoreBackup: (id: string) => Promise<void>;
  clearNotice: () => void;
  loadProviders: () => Promise<void>;
  createProvider: (input: CreateProviderRequest) => Promise<void>;
  updateProvider: (id: string, input: UpdateProviderRequest) => Promise<ProviderMutationResponse>;
  deleteProvider: (id: string) => Promise<void>;
  /** Reveals the stored key material; requires a server endpoint that returns it. */
  revealProvider: (id: string) => Promise<{ apiKey: string }>;
  loadDoctor: () => Promise<void>;
  loadDrift: () => Promise<void>;
  reapplyDrift: (harnessId: HarnessId) => Promise<DriftFileState[]>;
  adoptDrift: (harnessId: HarnessId) => Promise<DriftAdoptResponse>;
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
  providers: null,
  providersLoading: false,
  providersError: null,
  doctor: null,
  doctorUpdatedAvailable: false,
  doctorLoading: false,
  doctorError: null,
  drift: null,
  driftLoading: false,
  driftError: null,

  loadSession: async () => {
    try {
      await api('/api/auth/session');
      set({ authenticated: true, sessionChecked: true, error: null });
      await get().loadHarnesses();
      await get().loadDrift();
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
    set({
      authenticated: false,
      harnesses: [],
      backups: [],
      envFile: '',
      providers: null,
      doctor: null,
      doctorUpdatedAvailable: false,
      drift: null,
    });
  },

  loadHarnesses: async () => {
    set({ loading: true, error: null });
    try {
      const data = await api<HarnessesResponse>('/api/harnesses');
      set({ harnesses: data.items, envFile: data.envFile, loading: false });
      // Drift depends on the active profile, so refresh it whenever the harness
      // list changes. A drift failure must never block the harness load.
      await get().loadDrift();
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
      'Claude Code 会立即生效；Codex、Kimi Code、Pi 需要重新启动进程。',
      ...result.warnings.map((warning) => `注意：${warning}`),
    ];
    set({ notice: lines.join('\n') });
    await get().loadHarnesses();
  },

  activateOfficial: async (harnessId) => {
    const result = await api<ActivateResponse>(`/api/harnesses/${harnessId}/official/activate`, {
      method: 'POST',
    });
    const label = get().harnesses.find((item) => item.id === harnessId)?.label ?? harnessId;
    const lines = [
      `${label} 已切回官方登录，第三方 API 路由已从原生配置中移除。`,
      '如尚未登录，请在终端启动对应工具并完成一次官方登录。',
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

  loadBackupDetail: async (id) => {
    return api<BackupDetail>(backupsPath(id));
  },

  restoreBackup: async (id) => {
    await api(`${backupsPath(id)}/restore`, { method: 'POST' });
    set({ notice: '已把该历史快照的文件写回磁盘。' });
    await Promise.all([get().loadHarnesses(), get().loadBackups()]);
  },

  loadProviders: async () => {
    set({ providersLoading: true, providersError: null });
    try {
      const data = await api<ProvidersResponse>(providersPath());
      set({ providers: data.items, providersLoading: false });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        set({ authenticated: false, providersLoading: false, providers: [] });
        return;
      }
      set({ providersLoading: false, providersError: (error as Error).message });
    }
  },

  createProvider: async (input) => {
    await api(providersPath(), { method: 'POST', body: JSON.stringify(input) });
    await get().loadProviders();
  },

  updateProvider: async (id, input) => {
    const result = await api<ProviderMutationResponse>(providerPath(id), {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
    // Active profiles referencing this entry may have been re-applied, so the
    // harness list and the drift view both need a refresh.
    await get().loadProviders();
    await get().loadHarnesses();
    await get().loadDrift();
    return result;
  },

  deleteProvider: async (id) => {
    await api(providerPath(id), { method: 'DELETE' });
    await get().loadProviders();
  },

  revealProvider: async (id) => {
    return api<{ apiKey: string }>(`${providerPath(id)}/reveal`);
  },

  loadDoctor: async () => {
    set({ doctorLoading: true, doctorError: null });
    try {
      const report = await api<DoctorResponse>(doctorPath());
      set({
        doctor: report.items,
        doctorUpdatedAvailable: report.updatedAvailable,
        doctorLoading: false,
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        set({ authenticated: false, doctorLoading: false, doctor: [] });
        return;
      }
      set({ doctorLoading: false, doctorError: (error as Error).message });
    }
  },

  loadDrift: async () => {
    set({ driftLoading: true, driftError: null });
    try {
      const data = await api<DriftResponse>(driftPath());
      set({ drift: data.items ?? [], driftLoading: false });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        set({ authenticated: false, driftLoading: false, drift: [] });
        return;
      }
      set({ driftLoading: false, driftError: (error as Error).message });
    }
  },

  reapplyDrift: async (harnessId) => {
    const result = await api<DriftReapplyResponse>(driftReapplyPath(harnessId), {
      method: 'POST',
    });
    const label = get().harnesses.find((item) => item.id === harnessId)?.label ?? harnessId;
    set({ notice: `已按激活配置重新写入 ${label} 的原生配置文件。` });
    await get().loadDrift();
    return result.files;
  },

  adoptDrift: async (harnessId) => {
    const result = await api<DriftAdoptResponse>(driftAdoptPath(harnessId), {
      method: 'POST',
    });
    const label = get().harnesses.find((item) => item.id === harnessId)?.label ?? harnessId;
    set({ notice: `已把 ${label} 现场配置回填进配置档案。` });
    // Adopting mutates the profile store, so the harness list (and via it the
    // drift view) must be refreshed.
    await get().loadHarnesses();
    return result;
  },

  clearNotice: () => set({ notice: null }),
}));
