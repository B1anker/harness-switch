import type { GitHubSyncStatus } from '@seaveyon/harness-switch-shared';
import { api, githubPath } from '@/lib/api';
import type { MessageLine } from '@/lib/messages';
import { loadResource } from '../resource';
import type { Slice } from '../types';

export type GithubSlice = {
  /** Connection + gist metadata; null until the first successful status read. */
  githubStatus: GitHubSyncStatus | null;
  githubStatusLoading: boolean;
  githubStatusError: MessageLine | null;
  /** Fetches status from the server. Safe to call again for a manual refresh. */
  loadGithubStatus: () => Promise<void>;
  /** Applies a status already returned by connect / token, without another round trip. */
  setGithubStatus: (status: GitHubSyncStatus) => void;
  disconnectGithub: () => Promise<void>;
};

export const createGithubSlice: Slice<GithubSlice> = (set) => ({
  githubStatus: null,
  githubStatusLoading: false,
  githubStatusError: null,

  loadGithubStatus: async () => {
    await loadResource(set, 'githubStatus', () => api<GitHubSyncStatus>(githubPath.status));
  },

  setGithubStatus: (status) => {
    set({ githubStatus: status, githubStatusError: null });
  },

  disconnectGithub: async () => {
    await api(githubPath.disconnect, { method: 'POST' });
    set({ githubStatus: { connected: false }, githubStatusError: null });
  },
});
