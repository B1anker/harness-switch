import { useEffect, useState } from 'react';
import { api, versionPath } from '@/lib/api';
import { useTranslation } from '@/lib/i18n';

/** Shows the server package version in a small muted badge. */
export function VersionBadge() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api<{ version: string }>(versionPath)
      .then((payload) => {
        if (!cancelled) setVersion(payload.version);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!version) {
    return null;
  }
  return (
    <span className="shrink-0 whitespace-nowrap rounded-md bg-muted/70 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
      v{version}
    </span>
  );
}

/**
 * Flags a locally served bundle so a dev tab is never mistaken for the deployed one.
 * The bundler substitutes NODE_ENV at build time, so this collapses to a constant and
 * the badge is dropped from a production build entirely.
 */
export function DevModeBadge() {
  const { t } = useTranslation();
  if (process.env.NODE_ENV === 'production') {
    return null;
  }
  return (
    <span
      data-slot="dev-mode-badge"
      title={t('app.devMode')}
      className="shrink-0 whitespace-nowrap rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[11px] text-amber-700 dark:text-amber-300"
    >
      DEV
    </span>
  );
}
