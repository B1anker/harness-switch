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
  getKeyUrl: z.url().optional(),
  /** Protocols available across the preset; each endpoint declares its own protocol. */
  protocols: z.array(favoriteProtocolSchema).min(1),
  endpoints: z
    .array(z.object({ key: z.string().min(1), baseUrl: z.url(), protocol: favoriteProtocolSchema }))
    .min(1),
  defaultFacts: modelFactsSchema.optional(),
  modelCatalog: z
    .array(z.object({ requestModelId: z.string().min(1), facts: modelFactsSchema.optional() }))
    .optional(),
});
export type ProviderPreset = z.infer<typeof providerPresetSchema>;

export const PROVIDER_PRESETS: ProviderPreset[] = z.array(providerPresetSchema).parse([
  {
    id: 'deepseek',
    getKeyUrl: 'https://api-docs.deepseek.com/',
    nameKey: 'favorites.presets.deepseek',
    protocols: ['openai-chat'],
    endpoints: [{ key: 'main', baseUrl: 'https://api.deepseek.com/v1', protocol: 'openai-chat' }],
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
    getKeyUrl: 'https://docs.bigmodel.cn/cn/guide/start/quick-start',
    nameKey: 'favorites.presets.zhipu',
    protocols: ['openai-chat'],
    endpoints: [
      { key: 'main', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', protocol: 'openai-chat' },
    ],
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
    getKeyUrl: 'https://platform.kimi.com/docs/get-api-key',
    nameKey: 'favorites.presets.kimi',
    protocols: ['openai-chat', 'anthropic-messages'],
    endpoints: [
      { key: 'openai', baseUrl: 'https://api.moonshot.cn/v1', protocol: 'openai-chat' },
      {
        key: 'anthropic',
        baseUrl: 'https://api.moonshot.cn/anthropic',
        protocol: 'anthropic-messages',
      },
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
    getKeyUrl: 'https://platform.minimaxi.com/docs/guides/quickstart-preparation',
    nameKey: 'favorites.presets.minimax',
    protocols: ['openai-chat', 'anthropic-messages'],
    endpoints: [
      { key: 'openai', baseUrl: 'https://api.minimaxi.com/v1', protocol: 'openai-chat' },
      {
        key: 'anthropic',
        baseUrl: 'https://api.minimaxi.com/anthropic',
        protocol: 'anthropic-messages',
      },
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
    getKeyUrl: 'https://help.aliyun.com/zh/model-studio/get-api-key',
    nameKey: 'favorites.presets.qwen',
    protocols: ['openai-chat'],
    endpoints: [
      {
        key: 'main',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        protocol: 'openai-chat',
      },
    ],
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
    getKeyUrl: 'https://docs.siliconflow.cn/docs/userguide/quickstart',
    nameKey: 'favorites.presets.siliconflow',
    protocols: ['openai-chat'],
    endpoints: [{ key: 'main', baseUrl: 'https://api.siliconflow.cn/v1', protocol: 'openai-chat' }],
    modelCatalog: [
      { requestModelId: 'deepseek-ai/DeepSeek-V3.2' },
      { requestModelId: 'Qwen/Qwen3-235B-A22B' },
    ],
  },
  {
    id: 'openrouter',
    getKeyUrl: 'https://openrouter.ai/docs/quickstart',
    nameKey: 'favorites.presets.openrouter',
    protocols: ['openai-chat'],
    endpoints: [{ key: 'main', baseUrl: 'https://openrouter.ai/api/v1', protocol: 'openai-chat' }],
  },
  {
    id: 'openai',
    getKeyUrl: 'https://developers.openai.com/api/docs/quickstart',
    nameKey: 'favorites.presets.openai',
    protocols: ['openai-responses'],
    endpoints: [
      { key: 'main', baseUrl: 'https://api.openai.com/v1', protocol: 'openai-responses' },
    ],
    modelCatalog: [
      {
        requestModelId: 'gpt-5',
        // https://developers.openai.com/api/docs/models/gpt-5
        facts: {
          contextWindow: 400000,
          maxOutputTokens: 128000,
          reasoningSupported: true,
          supportedReasoningEfforts: ['minimal', 'low', 'medium', 'high'],
        },
      },
      {
        requestModelId: 'gpt-5-codex',
        facts: { contextWindow: 400000, maxOutputTokens: 128000, reasoningSupported: true },
      },
    ],
  },
  {
    id: 'anthropic',
    getKeyUrl: 'https://platform.claude.com/docs/en/get-started',
    nameKey: 'favorites.presets.anthropic',
    protocols: ['anthropic-messages'],
    endpoints: [
      { key: 'main', baseUrl: 'https://api.anthropic.com', protocol: 'anthropic-messages' },
    ],
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
