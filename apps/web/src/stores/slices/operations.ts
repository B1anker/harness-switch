import type {
  HarnessId,
  OperationReceipt,
  OperationsResponse,
  OperationUndoResponse,
} from '@seaveyon/harness-switch-shared';
import { api, operationsPath, operationUndoPath } from '@/lib/api';
import type { MessageLine } from '@/lib/messages';
import { loadResource } from '../resource';
import type { Slice } from '../types';
import { byHarness, harnessLabel } from './helpers';

export type OperationSlice = {
  /** Operation receipts, newest first; null until the first load. */
  operations: OperationReceipt[] | null;
  operationsLoading: boolean;
  operationsError: MessageLine | null;
  loadOperations: (harnessId: HarnessId) => Promise<void>;
  undoOperation: (id: string) => Promise<void>;
};

export const createOperationSlice: Slice<OperationSlice> = (set, get) => ({
  operations: null,
  operationsLoading: false,
  operationsError: null,

  loadOperations: async (harnessId) => {
    await loadResource(set, 'operations', async () => {
      const data = await api<OperationsResponse>(operationsPath(harnessId));
      return byHarness(get().operations, data.items, harnessId);
    });
  },

  undoOperation: async (id) => {
    const { receipt } = await api<OperationUndoResponse>(operationUndoPath(id), {
      method: 'POST',
    });
    set({
      notice: [
        { key: 'operations.undone', params: { harness: harnessLabel(get(), receipt.harness) } },
      ],
    });
    await Promise.all([
      get().loadHarnesses(),
      get().loadBackups(),
      get().loadOperations(receipt.harness),
    ]);
  },
});
