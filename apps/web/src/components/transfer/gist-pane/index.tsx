import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import { errorLine, lineText, type MessageLine } from '@/lib/messages';
import { useAppStore } from '@/stores/app-store';
import { AccountCard } from './account-card';
import { ConnectPane } from './connect-pane';
import { SyncPane } from './sync-pane';

/**
 * The GitHub Gist source: the same encrypted package as the file transfer, kept in a
 * private Gist so several machines can share one. The passphrase never leaves this
 * machine, so GitHub only ever holds ciphertext.
 *
 * Connection status lives in the app store so switching away and back does not re-hit
 * `/api/github/status`. A manual refresh, connect, disconnect, or sync still updates it.
 */
export function GistPane({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const status = useAppStore((state) => state.githubStatus);
  const loadingStatus = useAppStore((state) => state.githubStatusLoading);
  const statusError = useAppStore((state) => state.githubStatusError);
  const loadGithubStatus = useAppStore((state) => state.loadGithubStatus);
  const setGithubStatus = useAppStore((state) => state.setGithubStatus);
  const disconnectGithub = useAppStore((state) => state.disconnectGithub);
  const [error, setError] = useState<MessageLine | null>(null);
  const [message, setMessage] = useState<MessageLine | null>(null);

  useEffect(() => {
    // Keep a warm cache across tab switches; only the first visit (or an explicit
    // refresh) pays for the status round trip.
    if (status === null) {
      void loadGithubStatus();
    }
  }, [status, loadGithubStatus]);

  function clear() {
    setError(null);
    setMessage(null);
  }

  async function disconnect() {
    clear();
    try {
      await disconnectGithub();
      setMessage({ key: 'githubSync.disconnected' });
    } catch (caught) {
      setError(errorLine(caught));
    }
  }

  const banner = error ?? statusError;
  // No cached status yet — keep the shell on the loading placeholder so a warm connect
  // pane does not flash before the first read (or after a failed one settles into error).
  const awaitingStatus = status === null && statusError === null;

  return (
    <div className="space-y-5">
      {banner ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {lineText(t, banner)}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">
          {lineText(t, message)}
        </div>
      ) : null}

      {awaitingStatus ? (
        <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t('githubSync.loading')}
        </p>
      ) : status?.connected ? (
        <div className="space-y-5">
          <AccountCard
            status={status}
            refreshing={loadingStatus}
            onRefresh={() => void loadGithubStatus()}
            onDisconnect={() => void disconnect()}
          />
          <SyncPane
            onDone={onDone}
            onSynced={() => void loadGithubStatus()}
            onMessage={setMessage}
            onError={setError}
            onClear={clear}
          />
        </div>
      ) : (
        <ConnectPane
          onConnected={setGithubStatus}
          onMessage={(line) => {
            setMessage(line);
            // A device-flow authorization returns only the username, so the gist id and
            // sync times still have to be read back before the account card can show them.
            void loadGithubStatus();
          }}
          onError={setError}
          onClear={clear}
        />
      )}
    </div>
  );
}
