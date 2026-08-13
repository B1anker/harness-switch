export const HARNESS_IDS = ['claude', 'pi', 'codex', 'zcode', 'kimi'] as const;

export type HarnessId = (typeof HARNESS_IDS)[number];

export const HARNESS_LABELS: Record<HarnessId, string> = {
  claude: 'Claude Code',
  pi: 'pi',
  codex: 'Codex',
  zcode: 'zcode',
  kimi: 'Kimi Code',
};

export function isHarnessId(value: string): value is HarnessId {
  return (HARNESS_IDS as readonly string[]).includes(value);
}
