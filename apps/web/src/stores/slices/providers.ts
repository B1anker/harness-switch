import type {
  CreateProviderRequest,
  ProviderMutationResponse,
  ProviderPublic,
  ProvidersResponse,
  UpdateProviderRequest,
} from '@seaveyon/harness-switch-shared';
import { api, providerPath, providerRevealPath, providersPath } from '@/lib/api';
import type { MessageLine } from '@/lib/messages';
import { loadResource } from '../resource';
import type { Slice } from '../types';

export type ProviderSlice = {
  /** Provider Vault entries; null until the first successful load. */
  providers: ProviderPublic[] | null;
  providersLoading: boolean;
  providersError: MessageLine | null;
  loadProviders: () => Promise<void>;
  createProvider: (input: CreateProviderRequest) => Promise<void>;
  updateProvider: (id: string, input: UpdateProviderRequest) => Promise<ProviderMutationResponse>;
  deleteProvider: (id: string) => Promise<void>;
  /** Reveals the stored key material; requires a server endpoint that returns it. */
  revealProvider: (id: string) => Promise<{ apiKey: string }>;
};

export const createProviderSlice: Slice<ProviderSlice> = (set, get) => ({
  providers: null,
  providersLoading: false,
  providersError: null,

  loadProviders: async () => {
    await loadResource(set, 'providers', async () => {
      const data = await api<ProvidersResponse>(providersPath());
      return data.items;
    });
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
    return api<{ apiKey: string }>(providerRevealPath(id));
  },
});
