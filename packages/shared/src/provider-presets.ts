import { z } from 'zod';
import { favoriteProtocolSchema, modelFactsSchema } from './model-favorites';

/**
 * Curated provider presets for the favorite editor (spec: favorite-editor-ux §6.1).
 * Pure data — no credentials, no runtime inference. `defaultFacts` and per-model `facts`
 * are human-maintained declarations that become ordinary template values once chosen.
 */
export const providerPresetSchema = z.object({
  /** Stable identifier, e.g. 'deepseek'; also the `favorites.presets.<id>` name key. */
  id: z.string().min(1),
  nameKey: z.string().min(1),
  /** Supported protocols; the first one is the editor default. */
  protocols: z.array(favoriteProtocolSchema).min(1),
  endpoints: z.array(z.object({ key: z.string().min(1), baseUrl: z.url() })).min(1),
  defaultFacts: modelFactsSchema.optional(),
  modelCatalog: z
    .array(z.object({ requestModelId: z.string().min(1), facts: modelFactsSchema.optional() }))
    .optional(),
});
export type ProviderPreset = z.infer<typeof providerPresetSchema>;

export const PROVIDER_PRESETS: ProviderPreset[] = z.array(providerPresetSchema).parse([
  {
    id: 'deepseek',
    nameKey: 'favorites.presets.deepseek',
    protocols: ['openai-chat'],
    endpoints: [{ key: 'main', baseUrl: 'https://api.deepseek.com/v1' }],
    modelCatalog: [
      {
        requestModelId: 'deepseek-chat',
        facts: { contextWindow: 128000, maxOutputTokens: 8192 },
      },
      {
        requestModelId: 'deepseek-reasoner',
        facts: { contextWindow: 128000, maxOutputTokens: 8192, reasoningSupported: true },
      },
    ],
  },
  {
    id: 'zhipu',
    nameKey: 'favorites.presets.zhipu',
    protocols: ['openai-chat'],
    endpoints: [{ key: 'main', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' }],
    modelCatalog: [
      {
        requestModelId: 'glm-4.6',
        facts: { contextWindow: 200000, maxOutputTokens: 8192, reasoningSupported: true },
      },
      {
        requestModelId: 'glm-4.5-air',
        facts: { contextWindow: 128000, maxOutputTokens: 8192 },
      },
    ],
  },
  {
    id: 'kimi',
    nameKey: 'favorites.presets.kimi',
    protocols: ['openai-chat', 'anthropic-messages'],
    endpoints: [
      { key: 'openai', baseUrl: 'https://api.moonshot.cn/v1' },
      { key: 'anthropic', baseUrl: 'https://api.moonshot.cn/anthropic' },
    ],
    modelCatalog: [
      {
        requestModelId: 'kimi-k2-0905-preview',
        facts: { contextWindow: 262144, maxOutputTokens: 8192 },
      },
      {
        requestModelId: 'kimi-k2-thinking',
        facts: { contextWindow: 262144, maxOutputTokens: 8192, reasoningSupported: true },
      },
    ],
  },
  {
    id: 'minimax',
    nameKey: 'favorites.presets.minimax',
    protocols: ['openai-chat', 'anthropic-messages'],
    endpoints: [
      { key: 'openai', baseUrl: 'https://api.minimaxi.com/v1' },
      { key: 'anthropic', baseUrl: 'https://api.minimaxi.com/anthropic' },
    ],
    modelCatalog: [
      {
        requestModelId: 'MiniMax-M2',
        facts: { contextWindow: 204800, maxOutputTokens: 8192, reasoningSupported: true },
      },
    ],
  },
  {
    id: 'qwen',
    nameKey: 'favorites.presets.qwen',
    protocols: ['openai-chat'],
    endpoints: [{ key: 'main', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' }],
    modelCatalog: [
      {
        requestModelId: 'qwen3-max',
        facts: { contextWindow: 262144, maxOutputTokens: 8192 },
      },
      {
        requestModelId: 'qwen3-coder-plus',
        facts: { contextWindow: 1000000, maxOutputTokens: 8192 },
      },
    ],
  },
  {
    id: 'siliconflow',
    nameKey: 'favorites.presets.siliconflow',
    protocols: ['openai-chat'],
    endpoints: [{ key: 'main', baseUrl: 'https://api.siliconflow.cn/v1' }],
    modelCatalog: [
      { requestModelId: 'deepseek-ai/DeepSeek-V3.2' },
      { requestModelId: 'Qwen/Qwen3-235B-A22B' },
    ],
  },
  {
    id: 'openrouter',
    nameKey: 'favorites.presets.openrouter',
    protocols: ['openai-chat'],
    endpoints: [{ key: 'main', baseUrl: 'https://openrouter.ai/api/v1' }],
  },
  {
    id: 'openai',
    nameKey: 'favorites.presets.openai',
    protocols: ['openai-responses'],
    endpoints: [{ key: 'main', baseUrl: 'https://api.openai.com/v1' }],
    modelCatalog: [
      {
        requestModelId: 'gpt-5',
        facts: { contextWindow: 400000, maxOutputTokens: 128000, reasoningSupported: true },
      },
      {
        requestModelId: 'gpt-5-codex',
        facts: { contextWindow: 400000, maxOutputTokens: 128000, reasoningSupported: true },
      },
    ],
  },
  {
    id: 'anthropic',
    nameKey: 'favorites.presets.anthropic',
    protocols: ['anthropic-messages'],
    endpoints: [{ key: 'main', baseUrl: 'https://api.anthropic.com' }],
    modelCatalog: [
      {
        requestModelId: 'claude-opus-4-1',
        facts: { contextWindow: 200000, maxOutputTokens: 32000, reasoningSupported: true },
      },
      {
        requestModelId: 'claude-sonnet-4-5',
        facts: { contextWindow: 200000, maxOutputTokens: 64000, reasoningSupported: true },
      },
      {
        requestModelId: 'claude-haiku-4-5',
        facts: { contextWindow: 200000, maxOutputTokens: 64000 },
      },
    ],
  },
]);

export function providerPresetById(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((preset) => preset.id === id);
}
