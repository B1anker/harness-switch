import ClaudeCodeIcon from '@lobehub/icons/es/ClaudeCode/components/Color';
import CodexIcon from '@lobehub/icons/es/Codex/components/Color';
import DeepSeekIcon from '@lobehub/icons/es/DeepSeek/components/Color';
import KimiIcon from '@lobehub/icons/es/Kimi/components/Mono';
import PiIcon from '@lobehub/icons/es/Pi/components/Mono';
import type { HarnessId } from '@seaveyon/harness-switch-shared';
import { cn } from '@/lib/utils';

const BRAND_ICONS = {
  claude: ClaudeCodeIcon,
  codex: CodexIcon,
  kimi: KimiIcon,
  pi: PiIcon,
  dsh: DeepSeekIcon,
} satisfies Record<HarnessId, typeof ClaudeCodeIcon>;

export function HarnessIcon({ id, className }: { id: HarnessId; className?: string }) {
  const Icon = BRAND_ICONS[id];
  return <Icon aria-hidden className={cn('size-5', className)} />;
}
