import type { HarnessId } from '@seaveyon/harness-switch-shared';

export type Preset = {
  /** Catalog key under `preset.*`. */
  id: string;
  baseUrl: string;
  model?: string;
  extras?: Record<string, string>;
};

const ANTHROPIC_COMPATIBLE: Preset[] = [
  { id: 'zaiAnthropic', baseUrl: 'https://api.z.ai/api/anthropic', model: 'glm-4.6' },
  { id: 'moonshotAnthropic', baseUrl: 'https://api.moonshot.cn/anthropic' },
  { id: 'deepseekAnthropic', baseUrl: 'https://api.deepseek.com/anthropic' },
];

const OPENAI_COMPATIBLE: Preset[] = [
  { id: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'zai', baseUrl: 'https://api.z.ai/api/paas/v4', model: 'glm-4.6' },
  { id: 'moonshot', baseUrl: 'https://api.moonshot.cn/v1' },
  { id: 'deepseek', baseUrl: 'https://api.deepseek.com/v1' },
];

const CLIPROXY: Preset = {
  id: 'cliproxyResponses',
  baseUrl: 'https://api.seavey.ai/cliproxy/v1',
  model: 'gpt-5.6-sol',
};

/** Fills the Base URL for the endpoints people reach for most; not an exhaustive list. */
export const PRESETS: Record<HarnessId, Preset[]> = {
  claude: ANTHROPIC_COMPATIBLE,
  codex: OPENAI_COMPATIBLE,
  kimi: OPENAI_COMPATIBLE,
  pi: [
    {
      ...CLIPROXY,
      extras: { api: 'openai-responses', reasoning: 'true' },
    },
    ...OPENAI_COMPATIBLE,
  ],
  dsh: [
    {
      ...CLIPROXY,
      extras: { api: 'openai-responses', reasoningEfforts: 'low,medium,high,xhigh,max' },
    },
    ...OPENAI_COMPATIBLE,
  ],
};
