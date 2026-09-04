import type {
  HarnessId,
  ProbeRequest,
  ProbeResult,
  ProbeStoredRequest,
} from '@seaveyon/harness-switch-shared';
import { api, probePath, profileProbePath, providerProbePath } from '@/lib/api';
import type { Slice } from '../types';

export type ProbeSlice = {
  /** Tests unsaved form values; the credential is inline or resolved from the vault. */
  probeDraft: (input: ProbeRequest) => Promise<ProbeResult>;
  /** Tests a saved profile with its stored credential. */
  probeProfile: (
    harnessId: HarnessId,
    name: string,
    options?: ProbeStoredRequest,
  ) => Promise<ProbeResult>;
  /** Tests a vault entry's credential against one of its endpoints. */
  probeVaultEntry: (id: string, options?: ProbeStoredRequest) => Promise<ProbeResult>;
};

export const createProbeSlice: Slice<ProbeSlice> = () => ({
  probeDraft: async (input) => post(probePath(), input),
  probeProfile: async (harnessId, name, options) =>
    post(profileProbePath(harnessId, name), options ?? {}),
  probeVaultEntry: async (id, options) => post(providerProbePath(id), options ?? {}),
});

async function post(path: string, body: unknown): Promise<ProbeResult> {
  const response = await api<{ result: ProbeResult }>(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return response.result;
}
