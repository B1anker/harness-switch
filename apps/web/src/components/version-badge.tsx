import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/** Shows the server package version in a small muted badge. */
export function VersionBadge() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api<{ version: string }>('/api/version')
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
