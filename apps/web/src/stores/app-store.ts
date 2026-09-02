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
  LocalUserPublic,
  MessageParams,
  OperationReceipt,
  OperationsResponse,
  OperationUndoResponse,
  PreviewResponse,
  PreviewTarget,
  ProbeRequest,
  ProbeResult,
  ProviderMutationResponse,
  ProviderPublic,
  ProvidersResponse,
  ScanHarnessResult,
  ScanImportResponse,
  ScanImportSelection,
  ScanResponse,
  SessionResponse,
  UpdateProfileRequest,
  UpdateProviderRequest,
  UsersResponse,
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
  officialPreviewPath,
  operationsPath,
  operationUndoPath,
  probePath,
  profilePath,
  profileProbePath,
  profilesCollectionPath,
  providerPath,
  providerProbePath,
  providersPath,
  scanImportPath,
  scanPath,
} from '@/lib/api';
import { errorLine, type MessageLine, messageLine } from '@/lib/messages';

type AppState = {
  sessionChecked: boolean;
  authenticated: boolean;
  currentUser: string;
  users: LocalUserPublic[];
  usersLoading: boolean;
  loading: boolean;
  error: MessageLine | null;
  envFile: string;
  harnesses: HarnessSummary[];
  backups: BackupEntry[];
  /**
   * Lines for the toast. Kept as keys rather than sentences because these are built
   * outside React, where there is no `t` — and because an open toast should follow a
   * language switch.
   */
  notice: MessageLine[] | null;
  /** Provider Vault entries; null until the first successful load. */
  providers: ProviderPublic[] | null;
  providersLoading: boolean;
  providersError: MessageLine | null;
  /** Doctor reports, one per harness; null until the first run. */
  doctor: DoctorReport[] | null;
  /** True when a newer release exists on the registry. */
  doctorUpdatedAvailable: boolean;
  doctorLoading: boolean;
  doctorError: MessageLine | null;
  /** Drift report per harness; null until the first load. */
  drift: DriftSummary[] | null;
  driftLoading: boolean;
  driftError: MessageLine | null;
  /** Configuration found on disk for the import wizard; null until the first scan. */
  scan: ScanHarnessResult[] | null;
  scanLoading: boolean;
  scanError: MessageLine | null;
  /** Operation receipts, newest first; null until the first load. */
  operations: OperationReceipt[] | null;
  operationsLoading: boolean;
  operationsError: MessageLine | null;
  loadSession: () => Promise<void>;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  loadUsers: () => Promise<void>;
  switchUser: (username: string) => Promise<void>;
  loadHarnesses: () => Promise<void>;
  createProfile: (harnessId: HarnessId, input: CreateProfileRequest) => Promise<void>;
  updateProfile: (harnessId: HarnessId, name: string, input: UpdateProfileRequest) => Promise<void>;
  deleteProfile: (harnessId: HarnessId, name: string) => Promise<void>;
  activateProfile: (harnessId: HarnessId, name: string) => Promise<void>;
  activateOfficial: (harnessId: HarnessId) => Promise<void>;
  previewProfile: (harnessId: HarnessId, name: string) => Promise<PreviewTarget[]>;
  previewOfficial: (harnessId: HarnessId) => Promise<PreviewTarget[]>;
  loadBackups: () => Promise<void>;
  loadBackupDetail: (id: string) => Promise<BackupDetail>;
  restoreBackup: (id: string) => Promise<void>;
  /** Lets a dialog hand its success message to the toast so it can close itself. */
  setNotice: (notice: MessageLine[]) => void;
  clearNotice: () => void;
  loadProviders: () => Promise<void>;
  createProvider: (input: CreateProviderRequest) => Promise<void>;
  updateProvider: (id: string, input: UpdateProviderRequest) => Promise<ProviderMutationResponse>;
  deleteProvider: (id: string) => Promise<void>;
  /** Reveals the stored key material; requires a server endpoint that returns it. */
  revealProvider: (id: string) => Promise<{ apiKey: string }>;
  /** Tests unsaved form values; the credential is inline or resolved from the vault. */
  probeDraft: (input: ProbeRequest) => Promise<ProbeResult>;
  /** Tests a saved profile with its stored credential. */
  probeProfile: (harnessId: HarnessId, name: string) => Promise<ProbeResult>;
  /** Tests a vault entry's credential against one of its endpoints. */
  probeVaultEntry: (id: string, endpoint?: string) => Promise<ProbeResult>;
  loadDoctor: (harnessId: HarnessId) => Promise<void>;
  loadDrift: () => Promise<void>;
  reapplyDrift: (harnessId: HarnessId) => Promise<DriftFileState[]>;
  adoptDrift: (harnessId: HarnessId) => Promise<DriftAdoptResponse>;
  /** Reads what the five tools already have configured; never writes anything. */
  loadScan: () => Promise<void>;
  importScan: (selections: ScanImportSelection[]) => Promise<ScanImportResponse>;
  loadOperations: (harnessId: HarnessId) => Promise<void>;
  undoOperation: (id: string) => Promise<void>;
};

/**
 * The `user` interpolation for an activation notice. A username is data; the stand-in
 * for "the current user" is copy, so it travels as a key and is translated on render.
 */
function activationLine(key: string, username: string, params: MessageParams): MessageLine {
  return username
    ? { key, params: { ...params, user: username } }
    : { key, params, paramKeys: { user: 'notice.currentUser' } };
}

export const useAppStore = create<AppState>((set, get) => ({
  sessionChecked: false,
  authenticated: false,
  currentUser: '',
  users: [],
  usersLoading: false,
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
  scan: null,
  scanLoading: false,
  scanError: null,
  operations: null,
  operationsLoading: false,
  operationsError: null,

  loadSession: async () => {
    try {
      const session = await api<SessionResponse>('/api/auth/session');
      set({
        authenticated: true,
        sessionChecked: true,
        currentUser: session.currentUser,
        error: null,
      });
      await get().loadUsers();
      await Promise.all([get().loadHarnesses(), get().loadBackups()]);
      await get().loadDrift();
    } catch (error) {
      set({
        authenticated: false,
        sessionChecked: true,
        error: error instanceof ApiError && error.status === 401 ? null : errorLine(error),
      });
    }
  },

  login: async (password) => {
    set({ loading: true, error: null });
    try {
      const session = await api<SessionResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      set({ authenticated: true, loading: false, currentUser: session.currentUser });
      await get().loadUsers();
      await get().loadHarnesses();
    } catch (error) {
      set({ loading: false, error: errorLine(error) });
      throw error;
    }
  },

  logout: async () => {
    await api('/api/auth/logout', { method: 'POST' });
    set({
      authenticated: false,
      currentUser: '',
      users: [],
      harnesses: [],
      backups: [],
      envFile: '',
      providers: null,
      doctor: null,
      doctorUpdatedAvailable: false,
      drift: null,
    });
  },

  loadUsers: async () => {
    set({ usersLoading: true });
    try {
      const data = await api<UsersResponse>('/api/users');
      set({ users: data.items, currentUser: data.currentUser, usersLoading: false });
    } catch (error) {
      set({ usersLoading: false, error: errorLine(error) });
    }
  },

  switchUser: async (username) => {
    if (!username || username === get().currentUser) return;
    set({ usersLoading: true, loading: true, error: null });
    try {
      await api(`/api/users/${encodeURIComponent(username)}/select`, { method: 'POST' });
      set({
        currentUser: username,
        harnesses: [],
        backups: [],
        envFile: '',
        providers: null,
        doctor: null,
        doctorUpdatedAvailable: false,
        drift: null,
      });
      await get().loadUsers();
      await Promise.all([get().loadHarnesses(), get().loadBackups()]);
      set({ usersLoading: false, loading: false });
    } catch (error) {
      set({ usersLoading: false, loading: false, error: errorLine(error) });
      throw error;
    }
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
    const result = await api<ActivateResponse>(`${profilePath(harnessId, name)}/activate`, {
      method: 'POST',
    });
    const label = get().harnesses.find((item) => item.id === harnessId)?.label ?? harnessId;
    set({
      notice: [
        activationLine('notice.activated', get().currentUser, { harness: label, profile: name }),
        { key: 'notice.activatedHint' },
        ...result.warnings.map(messageLine),
      ],
    });
    await get().loadHarnesses();
  },

  activateOfficial: async (harnessId) => {
    const result = await api<ActivateResponse>(`/api/harnesses/${harnessId}/official/activate`, {
      method: 'POST',
    });
    const label = get().harnesses.find((item) => item.id === harnessId)?.label ?? harnessId;
    set({
      notice: [
        activationLine('notice.officialRestored', get().currentUser, { harness: label }),
        { key: 'notice.officialHint' },
        ...result.warnings.map(messageLine),
      ],
    });
    await get().loadHarnesses();
  },

  previewProfile: async (harnessId, name) => {
    const result = await api<PreviewResponse>(`${profilePath(harnessId, name)}/preview`);
    return result.targets;
  },

  previewOfficial: async (harnessId) => {
    const result = await api<PreviewResponse>(officialPreviewPath(harnessId));
    return result.targets;
  },

  loadBackups: async () => {
    try {
      const data = await api<BackupsResponse>(backupsPath());
      set({ backups: data.items });
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) {
        set({ error: errorLine(error) });
      }
    }
  },

  loadBackupDetail: async (id) => {
    return api<BackupDetail>(backupsPath(id));
  },

  restoreBackup: async (id) => {
    await api(`${backupsPath(id)}/restore`, { method: 'POST' });
    set({ notice: [{ key: 'backup.written' }] });
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
      set({ providersLoading: false, providersError: errorLine(error) });
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

  probeDraft: async (input) => {
    const result = await api<{ result: ProbeResult }>(probePath(), {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return result.result;
  },

  probeProfile: async (harnessId, name) => {
    const result = await api<{ result: ProbeResult }>(profileProbePath(harnessId, name), {
      method: 'POST',
      body: JSON.stringify({}),
    });
    return result.result;
  },

  probeVaultEntry: async (id, endpoint) => {
    const result = await api<{ result: ProbeResult }>(providerProbePath(id), {
      method: 'POST',
      body: JSON.stringify(endpoint ? { endpoint } : {}),
    });
    return result.result;
  },

  loadDoctor: async (harnessId) => {
    set({ doctorLoading: true, doctorError: null });
    try {
      const report = await api<DoctorResponse>(doctorPath(harnessId));
      const previous = get().doctor ?? [];
      const merged = [
        ...previous.filter((item) => item.harness !== harnessId),
        ...report.items.filter((item) => item.harness === harnessId),
      ];
      set({
        doctor: merged,
        doctorUpdatedAvailable: report.updatedAvailable,
        doctorLoading: false,
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        set({ authenticated: false, doctorLoading: false, doctor: [] });
        return;
      }
      set({ doctorLoading: false, doctorError: errorLine(error) });
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
      set({ driftLoading: false, driftError: errorLine(error) });
    }
  },

  reapplyDrift: async (harnessId) => {
    const result = await api<DriftReapplyResponse>(driftReapplyPath(harnessId), {
      method: 'POST',
    });
    const label = get().harnesses.find((item) => item.id === harnessId)?.label ?? harnessId;
    set({ notice: [{ key: 'drift.reapplied', params: { harness: label } }] });
    await get().loadDrift();
    return result.files;
  },

  adoptDrift: async (harnessId) => {
    const result = await api<DriftAdoptResponse>(driftAdoptPath(harnessId), {
      method: 'POST',
    });
    const label = get().harnesses.find((item) => item.id === harnessId)?.label ?? harnessId;
    set({ notice: [{ key: 'drift.adopted', params: { harness: label } }] });
    // Adopting mutates the profile store, so the harness list (and via it the
    // drift view) must be refreshed.
    await get().loadHarnesses();
    return result;
  },

  loadScan: async () => {
    set({ scanLoading: true, scanError: null });
    try {
      const data = await api<ScanResponse>(scanPath());
      set({ scan: data.items, scanLoading: false });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        set({ authenticated: false, scanLoading: false, scan: [] });
        return;
      }
      set({ scanLoading: false, scanError: errorLine(error) });
    }
  },

  importScan: async (selections) => {
    const result = await api<ScanImportResponse>(scanImportPath(), {
      method: 'POST',
      body: JSON.stringify({ selections }),
    });
    // The import only writes to this manager's own store, so nothing on the tool side
    // changed and only the profile list needs refreshing.
    await Promise.all([get().loadHarnesses(), get().loadProviders(), get().loadScan()]);
    return result;
  },

  loadOperations: async (harnessId) => {
    set({ operationsLoading: true, operationsError: null });
    try {
      const data = await api<OperationsResponse>(operationsPath(harnessId));
      const previous = get().operations ?? [];
      const merged = [
        ...previous.filter((item) => item.harness !== harnessId),
        ...data.items.filter((item) => item.harness === harnessId),
      ];
      set({ operations: merged, operationsLoading: false });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        set({ authenticated: false, operationsLoading: false, operations: [] });
        return;
      }
      set({ operationsLoading: false, operationsError: errorLine(error) });
    }
  },

  undoOperation: async (id) => {
    const { receipt } = await api<OperationUndoResponse>(operationUndoPath(id), {
      method: 'POST',
    });
    const label =
      get().harnesses.find((item) => item.id === receipt.harness)?.label ?? receipt.harness;
    set({ notice: [{ key: 'operations.undone', params: { harness: label } }] });
    await Promise.all([
      get().loadHarnesses(),
      get().loadBackups(),
      get().loadOperations(receipt.harness),
    ]);
  },

  setNotice: (notice) => set({ notice }),

  clearNotice: () => set({ notice: null }),
}));
