import type {
  DoctorReport,
  DoctorResponse,
  DriftAdoptResponse,
  DriftFileState,
  DriftReapplyResponse,
  DriftResponse,
  DriftSummary,
  HarnessId,
} from '@seaveyon/harness-switch-shared';
import { api, doctorPath, driftAdoptPath, driftPath, driftReapplyPath } from '@/lib/api';
import type { MessageLine } from '@/lib/messages';
import { loadResource } from '../resource';
import type { Slice } from '../types';
import { byHarness, harnessLabel } from './helpers';

export type InsightSlice = {
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
  loadDoctor: (harnessId: HarnessId) => Promise<void>;
  loadDrift: () => Promise<void>;
  reapplyDrift: (harnessId: HarnessId) => Promise<DriftFileState[]>;
  adoptDrift: (harnessId: HarnessId) => Promise<DriftAdoptResponse>;
};

export const createInsightSlice: Slice<InsightSlice> = (set, get) => ({
  doctor: null,
  doctorUpdatedAvailable: false,
  doctorLoading: false,
  doctorError: null,
  drift: null,
  driftLoading: false,
  driftError: null,

  loadDoctor: async (harnessId) => {
    await loadResource(set, 'doctor', async () => {
      const report = await api<DoctorResponse>(doctorPath(harnessId));
      set({ doctorUpdatedAvailable: report.updatedAvailable });
      return byHarness(get().doctor, report.items, harnessId);
    });
  },

  loadDrift: async () => {
    await loadResource(set, 'drift', async () => {
      const data = await api<DriftResponse>(driftPath());
      return data.items ?? [];
    });
  },

  reapplyDrift: async (harnessId) => {
    const result = await api<DriftReapplyResponse>(driftReapplyPath(harnessId), {
      method: 'POST',
    });
    set({
      notice: [{ key: 'drift.reapplied', params: { harness: harnessLabel(get(), harnessId) } }],
    });
    await get().loadDrift();
    return result.files;
  },

  adoptDrift: async (harnessId) => {
    const result = await api<DriftAdoptResponse>(driftAdoptPath(harnessId), {
      method: 'POST',
    });
    set({
      notice: [{ key: 'drift.adopted', params: { harness: harnessLabel(get(), harnessId) } }],
    });
    // Adopting mutates the profile store, so the harness list (and via it the
    // drift view) must be refreshed.
    await get().loadHarnesses();
    return result;
  },
});
