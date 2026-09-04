import type {
  ScanHarnessResult,
  ScanImportResponse,
  ScanImportSelection,
  ScanResponse,
} from '@seaveyon/harness-switch-shared';
import { api, scanImportPath, scanPath } from '@/lib/api';
import type { MessageLine } from '@/lib/messages';
import { loadResource } from '../resource';
import type { Slice } from '../types';

export type ScanSlice = {
  /** Configuration found on disk for the import wizard; null until the first scan. */
  scan: ScanHarnessResult[] | null;
  scanLoading: boolean;
  scanError: MessageLine | null;
  /** Reads what the five tools already have configured; never writes anything. */
  loadScan: () => Promise<void>;
  importScan: (selections: ScanImportSelection[]) => Promise<ScanImportResponse>;
};

export const createScanSlice: Slice<ScanSlice> = (set, get) => ({
  scan: null,
  scanLoading: false,
  scanError: null,

  loadScan: async () => {
    await loadResource(set, 'scan', async () => {
      const data = await api<ScanResponse>(scanPath());
      return data.items;
    });
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
});
