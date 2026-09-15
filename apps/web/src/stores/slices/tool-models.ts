import type {
  ToolModelsHarness,
  ToolModelsPreview,
  ToolModelsRequest,
  ToolModelsState,
} from '@seaveyon/harness-switch-shared';
import { api, toolModelsPath } from '@/lib/api';
import type { MessageLine } from '@/lib/messages';
import { loadResource } from '../resource';
import type { Slice } from '../types';

export type ToolModelsSlice = {
  toolModelsDrafts: Partial<Record<ToolModelsHarness, ToolModelsRequest>>;
  editToolModelsDraft(harness: ToolModelsHarness, request: ToolModelsRequest): void;
  toolModels: Array<{ harness: ToolModelsHarness; state: ToolModelsState }>;
  toolModelsLoading: boolean;
  toolModelsError: MessageLine | null;
  toolModelsPreview: ToolModelsPreview | null;
  loadToolModels(harness: ToolModelsHarness): Promise<void>;
  saveToolModels(harness: ToolModelsHarness, request: ToolModelsRequest): Promise<void>;
  previewToolModels(harness: ToolModelsHarness, request: ToolModelsRequest): Promise<void>;
  applyToolModels(harness: ToolModelsHarness, planId: string): Promise<void>;
  clearToolModelsPreview(): void;
};
export const createToolModelsSlice: Slice<ToolModelsSlice> = (set, get) => {
  let generation = 0;
  return {
    toolModelsDrafts: {},
    editToolModelsDraft: (harness, request) =>
      set({ toolModelsDrafts: { ...get().toolModelsDrafts, [harness]: request } }),
    toolModels: [],
    toolModelsLoading: false,
    toolModelsError: null,
    toolModelsPreview: null,
    loadToolModels: async (harness) => {
      const user = get().currentUser;
      await loadResource(set, 'toolModels', async () => {
        const result = await api<{ data: ToolModelsState }>(toolModelsPath(harness));
        return user === get().currentUser
          ? [
              ...get().toolModels.filter((item) => item.harness !== harness),
              { harness, state: result.data },
            ]
          : get().toolModels;
      });
    },
    saveToolModels: async (harness, request) => {
      const user = get().currentUser;
      const result = await api<{ data: ToolModelsState }>(toolModelsPath(harness), {
        method: 'PUT',
        body: JSON.stringify(request),
      });
      if (user === get().currentUser) {
        set({
          toolModelsDrafts: { ...get().toolModelsDrafts, [harness]: undefined },
          toolModels: [
            ...get().toolModels.filter((item) => item.harness !== harness),
            { harness, state: result.data },
          ],
          toolModelsPreview: null,
        });
      }
    },
    previewToolModels: async (harness, request) => {
      const user = get().currentUser;
      const sequence = ++generation;
      set({ toolModelsPreview: null });
      const result = await api<{ data: ToolModelsPreview }>(toolModelsPath(harness, 'preview'), {
        method: 'POST',
        body: JSON.stringify(request),
      });
      if (user === get().currentUser && sequence === generation) {
        set({ toolModelsPreview: result.data });
      }
    },
    applyToolModels: async (harness, planId) => {
      const user = get().currentUser;
      const result = await api<{ data: ToolModelsState }>(toolModelsPath(harness, 'apply'), {
        method: 'POST',
        body: JSON.stringify({ planId }),
      });
      if (user !== get().currentUser) {
        return;
      }
      set({
        toolModelsDrafts: { ...get().toolModelsDrafts, [harness]: undefined },
        toolModels: [
          ...get().toolModels.filter((item) => item.harness !== harness),
          { harness, state: result.data },
        ],
        toolModelsPreview: null,
      });
      await Promise.all([get().loadHarnesses(), get().loadFavorites(), get().loadBackups()]);
    },
    clearToolModelsPreview: () => {
      generation++;
      set({ toolModelsPreview: null });
    },
  };
};
