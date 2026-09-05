import type {
  LocalUserPublic,
  SessionResponse,
  UsersResponse,
} from '@seaveyon/harness-switch-shared';
import { ApiError, api, authPath, userSelectPath, usersPath } from '@/lib/api';
import { errorLine, type MessageLine } from '@/lib/messages';
import type { AppState, Slice } from '../types';

export type SessionSlice = {
  sessionChecked: boolean;
  authenticated: boolean;
  currentUser: string;
  users: LocalUserPublic[];
  usersLoading: boolean;
  loading: boolean;
  error: MessageLine | null;
  loadSession: () => Promise<void>;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  loadUsers: () => Promise<void>;
  switchUser: (username: string) => Promise<void>;
};

/** Everything a user switch or a sign-out invalidates, since both start from scratch. */
const USER_SCOPED: Partial<AppState> = {
  favoriteCatalogs: {},
  favoriteTargets: {},
  favoriteOperationHistory: [],
  favorites: null,
  favoritePlan: null,
  favoriteOperation: null,
  favoritesError: null,
  favoritesLoading: false,
  harnesses: [],
  backups: [],
  envFile: '',
  providers: null,
  doctor: null,
  doctorUpdatedAvailable: false,
  drift: null,
};

export const createSessionSlice: Slice<SessionSlice> = (set, get) => ({
  sessionChecked: false,
  authenticated: false,
  currentUser: '',
  users: [],
  usersLoading: false,
  loading: false,
  error: null,

  loadSession: async () => {
    try {
      const session = await api<SessionResponse>(authPath.session);
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
      const session = await api<SessionResponse>(authPath.login, {
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
    await api(authPath.logout, { method: 'POST' });
    set({ authenticated: false, currentUser: '', users: [], ...USER_SCOPED });
  },

  loadUsers: async () => {
    set({ usersLoading: true });
    try {
      const data = await api<UsersResponse>(usersPath());
      set({ users: data.items, currentUser: data.currentUser, usersLoading: false });
    } catch (error) {
      set({ usersLoading: false, error: errorLine(error) });
    }
  },

  switchUser: async (username) => {
    if (!username || username === get().currentUser) {
      return;
    }
    set({ usersLoading: true, loading: true, error: null });
    try {
      await api(userSelectPath(username), { method: 'POST' });
      set({ currentUser: username, ...USER_SCOPED });
      await get().loadUsers();
      await Promise.all([get().loadHarnesses(), get().loadBackups()]);
      set({ usersLoading: false, loading: false });
    } catch (error) {
      set({ usersLoading: false, loading: false, error: errorLine(error) });
      throw error;
    }
  },
});
