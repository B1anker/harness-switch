import { z } from 'zod';
import { ERROR_CODES } from './errors';
import { favoriteConnectionSchema } from './model-favorites';

export const toolModelsHarnessSchema = z.enum(['kimi', 'dsh']);
export type ToolModelsHarness = z.infer<typeof toolModelsHarnessSchema>;
export const toolModelItemSchema = z.object({
  id: z.uuid(),
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('profile'), name: z.string().min(1).max(120) }),
    z.object({ kind: z.literal('favorite'), favoriteId: z.uuid(), connectionId: z.uuid() }),
  ]),
  factOverrides: favoriteConnectionSchema.shape.factOverrides,
  preferenceOverrides: favoriteConnectionSchema.shape.preferenceOverrides,
});
export type ToolModelItem = z.infer<typeof toolModelItemSchema>;
export const toolModelDraftSchema = z
  .object({
    items: z.array(toolModelItemSchema).max(50),
    defaultItemId: z.uuid().nullable().default(null),
  })
  .superRefine((draft, context) => {
    if (
      new Set(draft.items.map((item) => item.id)).size !== draft.items.length ||
      new Set(draft.items.map((item) => JSON.stringify(item.source))).size !== draft.items.length
    ) {
      context.addIssue({ code: 'custom', message: ERROR_CODES.toolModelsConflict });
    }
    if (draft.defaultItemId && !draft.items.some((item) => item.id === draft.defaultItemId)) {
      context.addIssue({ code: 'custom', message: ERROR_CODES.toolModelsDefaultRequired });
    }
  });
export type ToolModelDraft = z.infer<typeof toolModelDraftSchema>;
export const toolModelsRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  draft: toolModelDraftSchema,
});
export type ToolModelsRequest = z.infer<typeof toolModelsRequestSchema>;
export const toolModelsApplySchema = z.object({ planId: z.uuid() });
export type ToolModelsState = {
  nativeStatus?: 'unknown' | 'in-sync' | 'drifted' | 'invalid';
  revision: number;
  draft: ToolModelDraft;
  applied: Array<{ id: string; profile: string }>;
};
export type ToolModelsPreview = {
  id: string;
  items: Array<{
    id: string;
    name: string;
    model: string;
    connection: string;
    warnings: Array<{ code: string; data?: Record<string, string> }>;
    notRepresented: string[];
  }>;
  removed: string[];
  defaultItemId: string | null;
  files: Array<{ key: string; changed: boolean; before: string; after: string }>;
};
