import type { ProbeResult } from '@seaveyon/harness-switch-shared';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { lineText, messageLine } from '@/lib/messages';

/**
 * One connectivity-probe outcome, rendered next to the button that triggered it.
 *
 * Success shows latency and catalog size; failure translates the server's `code`,
 * falling back to its prose — the same contract as every other server message.
 */
export function ProbeResultLine({ result }: { result: ProbeResult }) {
  const { t } = useTranslation();
  if (result.ok) {
    const count = result.models?.length ?? 0;
    return (
      <span className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="size-4 shrink-0" aria-hidden />
        {t(count > 0 ? 'probe.ok' : 'probe.okNoCatalog', {
          latencyMs: result.latencyMs ?? '?',
          count,
        })}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-sm text-destructive">
      <XCircle className="size-4 shrink-0" aria-hidden />
      {lineText(
        t,
        messageLine({
          code: result.code,
          params: result.params,
          message: result.message ?? '',
        }),
      )}
    </span>
  );
}
