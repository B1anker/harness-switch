import { Loader2, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { api, updatePath, versionPath } from '@/lib/api';
import { useTranslation } from '@/lib/i18n';

type UpdateCheck = { current: string; latest: string | null; updateAvailable: boolean };

const POLL_INTERVAL_MS = 2_500;
const POLL_TIMEOUT_MS = 180_000;

/**
 * Appears next to the version badge when the npm registry has a newer
 * release. Clicking it asks the server to update itself; the page reloads
 * once the new version answers.
 */
export function UpdateButton() {
  const { t } = useTranslation();
  const [current, setCurrent] = useState<string | null>(null);
  const [latest, setLatest] = useState<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'updating' | 'failed'>('idle');

  useEffect(() => {
    let cancelled = false;
    void api<UpdateCheck>(updatePath.check)
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setCurrent(payload.current);
        if (payload.updateAvailable && payload.latest) {
          setLatest(payload.latest);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function update() {
    setPhase('updating');
    try {
      await api(updatePath.run, { method: 'POST' });
    } catch {
      // The daemon may restart before the response arrives; polling below covers it.
    }
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      try {
        const payload = await api<{ version: string }>(versionPath);
        if (payload.version !== current) {
          window.location.reload();
          return;
        }
      } catch {
        // Server is restarting; keep polling.
      }
    }
    setPhase('failed');
  }

  if (phase === 'updating') {
    return (
      <span className="flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-muted/70 px-2 font-mono text-[11px] text-muted-foreground">
        <Loader2 className="size-3 shrink-0 animate-spin" />
        {t('update.updating')}
      </span>
    );
  }
  if (phase === 'failed') {
    return (
      <span
        title={t('update.failedHint')}
        className="flex h-6 shrink-0 items-center whitespace-nowrap rounded-md bg-destructive/10 px-2 font-mono text-[11px] text-destructive"
      >
        {t('update.failed')}
      </span>
    );
  }
  if (!latest) {
    return null;
  }
  return (
    <Button
      variant="outline"
      size="sm"
      aria-label={t('update.toVersion', { version: latest })}
      className="h-6 shrink-0 gap-1 whitespace-nowrap px-2 font-mono text-[11px]"
      onClick={() => void update()}
    >
      <Sparkles className="size-3 shrink-0" />
      <span className="sm:hidden">{t('update.short')}</span>
      <span className="hidden sm:inline">{t('update.toVersion', { version: latest })}</span>
    </Button>
  );
}
