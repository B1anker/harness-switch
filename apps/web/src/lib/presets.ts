import type { HarnessId } from '@seaveyon/harness-switch-shared';

export type Preset = {
  label: string;
  baseUrl: string;
  model?: string;
  extras?: Record<string, string>;
};

const ANTHROPIC_COMPATIBLE: Preset[] = [
  { label: 'Z.AI（Anthropic 兼容）', baseUrl: 'https://api.z.ai/api/anthropic', model: 'glm-4.6' },
  { label: 'Moonshot（Anthropic 兼容）', baseUrl: 'https://api.moonshot.cn/anthropic' },
  { label: 'DeepSeek（Anthropic 兼容）', baseUrl: 'https://api.deepseek.com/anthropic' },
];

const OPENAI_COMPATIBLE: Preset[] = [
  { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { label: 'Z.AI', baseUrl: 'https://api.z.ai/api/paas/v4', model: 'glm-4.6' },
  { label: 'Moonshot', baseUrl: 'https://api.moonshot.cn/v1' },
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
];

/** Fills the Base URL for the endpoints people reach for most; not an exhaustive list. */
export const PRESETS: Record<HarnessId, Preset[]> = {
  claude: ANTHROPIC_COMPATIBLE,
  codex: OPENAI_COMPATIBLE,
  kimi: OPENAI_COMPATIBLE,
  pi: [
    {
      label: 'CLIProxy（Responses）',
      baseUrl: 'https://api.seavey.ai/cliproxy/v1',
      model: 'gpt-5.6-sol',
      extras: { api: 'openai-responses', reasoning: 'true' },
    },
    ...OPENAI_COMPATIBLE,
  ],
  dsh: [
    {
      label: 'CLIProxy（Responses）',
      baseUrl: 'https://api.seavey.ai/cliproxy/v1',
      model: 'gpt-5.6-sol',
      extras: { api: 'openai-responses', reasoningEfforts: 'low,medium,high,xhigh,max' },
    },
    ...OPENAI_COMPATIBLE,
  ],
};
