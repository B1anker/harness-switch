import type { GitHubSyncStatus } from '@seaveyon/harness-switch-shared';
import { ExternalLink, Github, LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useI18n, useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/** Who this machine is connected as, and where the encrypted package is kept. */
export function AccountCard({
  status,
  refreshing,
  onRefresh,
  onDisconnect,
}: {
  status: GitHubSyncStatus;
  refreshing: boolean;
  onRefresh: () => void;
  onDisconnect: () => void;
}) {
  const { t } = useTranslation();
  const { locale } = useI18n();
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-muted/40 p-4">
      <div className="flex items-center gap-3">
        {status.avatarUrl ? (
          <img
            src={status.avatarUrl}
            alt={status.username}
            className="size-10 rounded-full border"
          />
        ) : (
          <Github className="size-10 text-muted-foreground" />
        )}
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold">{status.username}</span>
            <Badge
              variant="secondary"
              className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            >
              <ShieldCheck className="mr-1 size-3" />
              {t('githubSync.connectedBadge')}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('githubSync.lastSynced')}{' '}
            {status.lastSyncedAt
              ? new Date(status.lastSyncedAt).toLocaleString(locale)
              : t('githubSync.neverSynced')}
          </p>
          {status.gistId ? (
            <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>{t('githubSync.cloudGist')}</span>
              <a
                href={`https://gist.github.com/${status.username ? `${status.username}/` : ''}${status.gistId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 font-mono text-primary hover:underline"
              >
                {status.gistId.slice(0, 8)}…
                <ExternalLink className="size-3" />
              </a>
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label={t('githubSync.refreshStatus')}
        >
          <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
          onClick={onDisconnect}
        >
          <LogOut className="mr-1.5 size-4" />
          {t('githubSync.disconnect')}
        </Button>
      </div>
    </div>
  );
}
