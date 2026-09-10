import {
  favoriteEffortSchema,
  mapReasoningEffort,
  modelFactsSchema,
} from '@seaveyon/harness-switch-shared';
import { z } from 'zod';

const entriesSchema = z
  .array(
    z.object({
      model: z.string().min(1).max(120),
      facts: modelFactsSchema,
      preferences: z.object({ reasoningEffort: favoriteEffortSchema.optional() }),
    }),
  )
  .min(1)
  .max(50);

// ModelInfo's required fields follow openai/codex protocol/src/openai_models.rs.
// Optional capabilities stay unset unless the template declares them.
export function codexCatalog(raw: string) {
  const entries = entriesSchema.parse(JSON.parse(raw));
  return {
    models: entries.map(({ model, facts, preferences }, priority) => ({
      slug: model,
      display_name: model,
      description: null,
      default_reasoning_level: preferences.reasoningEffort
        ? (mapReasoningEffort('codex', preferences.reasoningEffort, facts.supportedReasoningEfforts)
            .native ?? null)
        : null,
      supported_reasoning_levels: (facts.supportedReasoningEfforts ?? [])
        .filter((effort) => ['minimal', 'low', 'medium', 'high', 'xhigh'].includes(effort))
        .map((effort) => ({ effort, description: effort })),
      shell_type: 'default',
      visibility: 'list',
      supported_in_api: true,
      priority,
      availability_nux: null,
      upgrade: null,
      base_instructions: '',
      supports_reasoning_summaries: facts.reasoningSupported ?? false,
      support_verbosity: false,
      default_verbosity: null,
      apply_patch_tool_type: null,
      truncation_policy: { mode: 'tokens', limit: 10000 },
      context_window: facts.contextWindow ?? null,
      experimental_supported_tools: [],
      input_modalities: ['text'],
    })),
  };
}
