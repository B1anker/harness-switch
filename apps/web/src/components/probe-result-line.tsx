import type { ProbeCompletion, ProbeResult } from '@seaveyon/harness-switch-shared';
import { PROBE_CODES } from '@seaveyon/harness-switch-shared';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useI18n, useTranslation } from '@/lib/i18n';
import { lineText, messageLine } from '@/lib/messages';

/**
 * One connectivity-probe outcome, rendered next to the button that triggered it.
 *
 * Success shows latency and catalog size; failure renders the server's `code` — the
 * same contract as every other server message.
 *
 * The completion is a second line rather than part of the first, because the two
 * verdicts are independent: a relay that lists a model and then 5xx on it must show
 * a green catalog line above a red completion line, not one blurred summary.
 */
export function ProbeResultLine({ result }: { result: ProbeResult }) {
  return (
    <span className="flex flex-col gap-1">
      <CatalogLine result={result} />
      {result.completion ? <CompletionLine completion={result.completion} /> : null}
    </span>
  );
}

function CatalogLine({ result }: { result: ProbeResult }) {
  const { t } = useTranslation();
  if (result.ok) {
    const count = result.models?.length ?? 0;
    return (
      <Line ok>
        {t(count > 0 ? 'probe.ok' : 'probe.okNoCatalog', {
          latencyMs: result.latencyMs ?? '?',
          count,
        })}
      </Line>
    );
  }
  return (
    <Line ok={false}>
      {lineText(
        t,
        messageLine({ code: result.code ?? PROBE_CODES.networkError, data: result.data }),
      )}
    </Line>
  );
}

function CompletionLine({ completion }: { completion: ProbeCompletion }) {
  const { t } = useTranslation();
  const { locale } = useI18n();
  const at = completion.cachedAt ? formatCachedAt(completion.cachedAt, locale) : '';
  if (completion.ok) {
    return (
      <Line ok>
        {at
          ? t('probe.completionCached', { model: completion.model ?? '?', at })
          : t('probe.completionOk', {
              model: completion.model ?? '?',
              latencyMs: completion.latencyMs ?? '?',
            })}
      </Line>
    );
  }
  const text = lineText(
    t,
    messageLine({ code: completion.code ?? PROBE_CODES.networkError, data: completion.data }),
  );
  return (
    <Line ok={false}>{at ? `${text}（${t('probe.completionFailedCached', { at })}）` : text}</Line>
  );
}

function Line({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <span
      className={
        ok
          ? 'flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400'
          : 'flex items-center gap-1.5 text-sm text-destructive'
      }
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      {children}
    </span>
  );
}

/** Falls back to the raw ISO string rather than printing "Invalid Date" on a bad value. */
function formatCachedAt(iso: string, locale: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime())
    ? iso
    : parsed.toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
}
