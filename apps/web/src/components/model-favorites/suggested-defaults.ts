import type { ModelFacts } from '@seaveyon/harness-switch-shared';

/**
 * Baselines offered only when nothing else declares capabilities — blank create, or a
 * preset without defaultFacts. 256K context sits mid-pack among 2026 flagships; 32K max
 * output is the common denominator of models on sale (64K–128K flagships arrive through
 * preset facts). Reasoning stays undeclared on purpose: counterexamples exist. These are
 * ordinary form values — editable, clearable, with no schema constraint behind them.
 */
export const SUGGESTED_FACTS: Required<Pick<ModelFacts, 'contextWindow' | 'maxOutputTokens'>> = {
  contextWindow: 262144,
  maxOutputTokens: 32768,
};
