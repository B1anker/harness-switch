import type { HarnessId } from './harnesses';
import type { favoriteEffortSchema } from './model-favorites';

export type ReasoningEffort = (typeof favoriteEffortSchema)['options'][number];

/** The canonical ladder, lowest to highest — the schema enum order is the ranking. */
const LADDER: readonly ReasoningEffort[] = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
];

type HarnessEffortRule = {
  /** Native values the harness accepts, in canonical order. */
  accepts: readonly ReasoningEffort[];
  /** Where canonical `none` lands: a native stand-in, or 'unset' to write nothing. */
  none: ReasoningEffort | 'unset';
};

/**
 * What each harness's native configuration can express, as data so an upstream model or
 * CLI update is a one-line edit. Surveyed 2026:
 *
 * - claude: the `effortLevel` settings key takes low/medium/high/xhigh/max. `ultra`
 *   (≈ultracode) is session-only, so the config layer maps it down to `max`; `none`
 *   leaves the key unset (thinking off).
 * - codex: `model_reasoning_effort` takes minimal/low/medium/high/xhigh. There is no
 *   true off, so `none` lands on `minimal`; `max`/`ultra` clamp to `xhigh`.
 * - kimi / pi / dsh (OpenAI-compatible side): conservative default table —
 *   minimal/low/medium/high pass through, `xhigh` and above clamp to `high`, `none`
 *   unsets. kimi and pi currently expose no config-file effort key, so their projections
 *   still report the preference as not represented; the table is here for when they do.
 */
export const HARNESS_EFFORT_RULES: Record<HarnessId, HarnessEffortRule> = {
  claude: { accepts: ['low', 'medium', 'high', 'xhigh', 'max'], none: 'unset' },
  codex: { accepts: ['minimal', 'low', 'medium', 'high', 'xhigh'], none: 'minimal' },
  kimi: { accepts: ['minimal', 'low', 'medium', 'high'], none: 'unset' },
  pi: { accepts: ['minimal', 'low', 'medium', 'high'], none: 'unset' },
  dsh: { accepts: ['minimal', 'low', 'medium', 'high'], none: 'unset' },
};

/** The closest accepted rung: nearest lower on the ladder, else the lowest higher one. */
function nearest(
  accepted: readonly ReasoningEffort[],
  target: ReasoningEffort,
): ReasoningEffort | undefined {
  const rank = LADDER.indexOf(target);
  const ranked = LADDER.filter((entry) => accepted.includes(entry));
  const lower = ranked.filter((entry) => LADDER.indexOf(entry) <= rank);
  return lower.at(-1) ?? ranked[0];
}

/**
 * Maps a canonical effort to what a harness can natively express, then clamps the result
 * into the model's declared `supportedReasoningEfforts` when those are declared. Returns
 * `undefined` for "write nothing" (e.g. `none` on a harness without an off value) and
 * `clamped: true` whenever the landing differs from the requested rung.
 */
export function mapReasoningEffort(
  harness: HarnessId,
  effort: ReasoningEffort,
  declaredEfforts?: readonly ReasoningEffort[],
): { native: ReasoningEffort | undefined; clamped: boolean } {
  const rule = HARNESS_EFFORT_RULES[harness];
  let native: ReasoningEffort | undefined;
  if (effort === 'none') {
    native = rule.none === 'unset' ? undefined : rule.none;
  } else {
    native = rule.accepts.includes(effort) ? effort : nearest(rule.accepts, effort);
  }
  if (native && declaredEfforts?.length && !declaredEfforts.includes(native)) {
    native = nearest(declaredEfforts, native);
  }
  return { native, clamped: native !== effort };
}
