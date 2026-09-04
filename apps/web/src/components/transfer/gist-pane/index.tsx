import type { GitHubSyncStatus } from '@seaveyon/harness-switch-shared';
import { useEffect, useState } from 'react';
import { api, githubPath } from '@/lib/api';
import { useTranslation } from '@/lib/i18n';
import { errorLine, lineText, type MessageLine } from '@/lib/messages';
import { AccountCard } from './account-card';
import { ConnectPane } from './connect-pane';
import { SyncPane } from './sync-pane';

/**
 * The GitHub Gist source: the same encrypted package as the file transfer, kept in a
 * private Gist so several machines can share one. The passphrase never leaves this
 * machine, so GitHub only ever holds ciphertext.
 *
 * This level owns the connection status and the one banner both halves report through;
 * whether the user is connecting or syncing decides which half is mounted.
 */
export function GistPane({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<GitHubSyncStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [error, setError] = useState<MessageLine | null>(null);
  const [message, setMessage] = useState<MessageLine | null>(null);

  async function loadStatus() {
    setLoadingStatus(true);
    try {
      setStatus(await api<GitHubSyncStatus>(githubPath.status));
    } catch (caught) {
      setError(errorLine(caught));
    } finally {
      setLoadingStatus(false);
    }
  }

  useEffect(() => {
    void loadStatus();
  }, []);

  function clear() {
    setError(null);
    setMessage(null);
  }

  async function disconnect() {
    clear();
    try {
      await api(githubPath.disconnect, { method: 'POST' });
      setStatus({ connected: false });
      setMessage({ key: 'githubSync.disconnected' });
    } catch (caught) {
      setError(errorLine(caught));
    }
  }

  return (
    <div className="space-y-5">
      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {lineText(t, error)}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">
          {lineText(t, message)}
        </div>
      ) : null}

      {status?.connected ? (
        <div className="space-y-5">
          <AccountCard
            status={status}
            refreshing={loadingStatus}
            onRefresh={() => void loadStatus()}
            onDisconnect={() => void disconnect()}
          />
          <SyncPane
            onDone={onDone}
            onSynced={() => void loadStatus()}
            onMessage={setMessage}
            onError={setError}
            onClear={clear}
          />
        </div>
      ) : (
        <ConnectPane
          onConnected={setStatus}
          onMessage={(line) => {
            setMessage(line);
            // A device-flow authorization returns only the username, so the gist id and
            // sync times still have to be read back before the account card can show them.
            void loadStatus();
          }}
          onError={setError}
          onClear={clear}
        />
      )}
    </div>
  );
}
