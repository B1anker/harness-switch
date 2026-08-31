import type {
  GitHubDeviceCodeResponse,
  GitHubDevicePollResponse,
  GitHubPullPreviewResponse,
  GitHubPushResponse,
  GitHubSyncStatus,
} from '@seaveyon/harness-switch-shared';
import {
  Check,
  CloudDownload,
  CloudUpload,
  Copy,
  ExternalLink,
  Github,
  Key,
  Lock,
  LogOut,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { buildImportNotice, ImportReview } from '@/components/import-review';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { useI18n, useTranslation } from '@/lib/i18n';
import { errorLine, lineText, type MessageLine } from '@/lib/messages';
import { useTransferImport } from '@/lib/use-transfer-import';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/app-store';

/** GitHub's device flow never polls faster than this, even if the server suggests less. */
const MIN_POLL_SECONDS = 5;

/**
 * The GitHub Gist source: the same encrypted package as the file transfer, kept in a
 * private Gist so several machines can share one. The passphrase never leaves this
 * machine, so GitHub only ever holds ciphertext.
 */
export function GistPane({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const { locale } = useI18n();
  const loadHarnesses = useAppStore((state) => state.loadHarnesses);
  const setNotice = useAppStore((state) => state.setNotice);

  const [status, setStatus] = useState<GitHubSyncStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [error, setError] = useState<MessageLine | null>(null);
  const [message, setMessage] = useState<MessageLine | null>(null);

  const [authTab, setAuthTab] = useState<'device' | 'token'>('device');
  const [syncTab, setSyncTab] = useState<'push' | 'pull'>('push');

  const [deviceCode, setDeviceCode] = useState<GitHubDeviceCodeResponse | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [requestingCode, setRequestingCode] = useState(false);
  const [polling, setPolling] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(false);
  const [pollIntervalSec, setPollIntervalSec] = useState(MIN_POLL_SECONDS);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [tokenInput, setTokenInput] = useState('');
  const [connectingToken, setConnectingToken] = useState(false);

  const [pushPassphrase, setPushPassphrase] = useState('');
  const [pushing, setPushing] = useState(false);

  const [pullPassphrase, setPullPassphrase] = useState('');
  const [gistUpdatedAt, setGistUpdatedAt] = useState<string | null>(null);

  const transfer = useTransferImport({
    fetchPreview: async (options) => {
      const res = await api<GitHubPullPreviewResponse>('/api/github/pull/preview', {
        method: 'POST',
        body: JSON.stringify({ passphrase: pullPassphrase, ...options }),
      });
      setGistUpdatedAt(res.gistUpdatedAt);
      return res.preview;
    },
    runImport: (options) =>
      api('/api/github/pull', {
        method: 'POST',
        body: JSON.stringify({
          passphrase: pullPassphrase,
          ...options,
          migrateCodexLoginCache: true,
        }),
      }),
    onImported: async (result) => {
      await loadHarnesses();
      setNotice(buildImportNotice(t, result));
      onDone();
    },
  });

  function stopPolling() {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setPolling(false);
  }

  async function loadStatus() {
    setLoadingStatus(true);
    try {
      setStatus(await api<GitHubSyncStatus>('/api/github/status'));
    } catch (caught) {
      setError(errorLine(caught));
    } finally {
      setLoadingStatus(false);
    }
  }

  useEffect(() => {
    void loadStatus();
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, []);

  async function requestDeviceCode() {
    setRequestingCode(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api<GitHubDeviceCodeResponse>('/api/github/device/code', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setDeviceCode(res);
      startPolling(res.deviceCode, res.interval);
    } catch (caught) {
      setError(errorLine(caught));
    } finally {
      setRequestingCode(false);
    }
  }

  async function checkDeviceCodeStatus(code?: string, manual = false) {
    const targetCode = code || deviceCode?.deviceCode;
    if (!targetCode) return;
    if (manual) {
      setCheckingAuth(true);
      setError(null);
      setMessage(null);
    }

    try {
      const res = await api<GitHubDevicePollResponse>('/api/github/device/poll', {
        method: 'POST',
        body: JSON.stringify({ deviceCode: targetCode }),
      });

      if (res.status === 'authorized') {
        stopPolling();
        setDeviceCode(null);
        setMessage({ key: 'githubSync.authorized', params: { user: res.username ?? '' } });
        void loadStatus();
      } else if (res.status === 'expired') {
        stopPolling();
        setError(res.error ? errorLine(res.error) : { key: 'githubSync.codeExpired' });
      } else if (res.status === 'error') {
        stopPolling();
        setError(res.error ? errorLine(res.error) : { key: 'githubSync.authFailed' });
      } else if (res.status === 'pending' && res.interval && res.interval > MIN_POLL_SECONDS) {
        // GitHub asked us to slow down.
        setPollIntervalSec(res.interval);
        startPolling(targetCode, res.interval);
      }
    } catch (caught) {
      if (manual) setError(errorLine(caught));
    } finally {
      if (manual) setCheckingAuth(false);
    }
  }

  function startPolling(code: string, intervalSec = MIN_POLL_SECONDS) {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    setPolling(true);
    setPollIntervalSec(intervalSec);
    pollTimerRef.current = setInterval(
      () => void checkDeviceCodeStatus(code, false),
      Math.max(intervalSec, MIN_POLL_SECONDS) * 1000,
    );
  }

  async function connectToken() {
    if (!tokenInput.trim()) return;
    setConnectingToken(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api<GitHubSyncStatus>('/api/github/token', {
        method: 'POST',
        body: JSON.stringify({ token: tokenInput.trim() }),
      });
      setStatus(res);
      setTokenInput('');
      setMessage({ key: 'githubSync.connected', params: { user: res.username ?? '' } });
    } catch (caught) {
      setError(errorLine(caught));
    } finally {
      setConnectingToken(false);
    }
  }

  async function disconnect() {
    setError(null);
    setMessage(null);
    try {
      await api('/api/github/disconnect', { method: 'POST' });
      setStatus({ connected: false });
      transfer.reset();
      setMessage({ key: 'githubSync.disconnected' });
    } catch (caught) {
      setError(errorLine(caught));
    }
  }

  function copyUserCode() {
    if (!deviceCode?.userCode) return;
    void navigator.clipboard.writeText(deviceCode.userCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  }

  async function push() {
    if (!pushPassphrase) return;
    setPushing(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api<GitHubPushResponse>('/api/github/push', {
        method: 'POST',
        body: JSON.stringify({ passphrase: pushPassphrase, includeCodexLoginCache: true }),
      });
      setMessage({
        key: 'githubSync.pushSuccess',
        params: { profiles: res.exportedProfilesCount, vault: res.exportedVaultCount },
      });
      void loadStatus();
    } catch (caught) {
      setError(errorLine(caught));
    } finally {
      setPushing(false);
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
                onClick={() => void loadStatus()}
                disabled={loadingStatus}
                aria-label={t('githubSync.refreshStatus')}
              >
                <RefreshCw className={cn('size-4', loadingStatus && 'animate-spin')} />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                onClick={() => void disconnect()}
              >
                <LogOut className="mr-1.5 size-4" />
                {t('githubSync.disconnect')}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 rounded-lg bg-muted p-1">
            {(['push', 'pull'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                aria-pressed={syncTab === tab}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-md py-1.5 text-sm font-medium transition-colors',
                  syncTab === tab
                    ? 'bg-background text-foreground shadow-sm'
                    : 'cursor-pointer text-muted-foreground hover:text-foreground',
                )}
                onClick={() => setSyncTab(tab)}
              >
                {tab === 'push' ? (
                  <CloudUpload className="size-4" />
                ) : (
                  <CloudDownload className="size-4" />
                )}
                {tab === 'push' ? t('githubSync.pushTitle') : t('githubSync.pullTitle')}
              </button>
            ))}
          </div>

          {syncTab === 'push' ? (
            <div className="space-y-4">
              <p className="text-sm leading-relaxed text-muted-foreground">
                {t('githubSync.pushIntro')}
              </p>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1 space-y-2">
                  <Label htmlFor="push-passphrase">{t('githubSync.passphrase')}</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                    <Input
                      id="push-passphrase"
                      type="password"
                      className="pl-9"
                      placeholder={t('githubSync.passphrasePlaceholder')}
                      value={pushPassphrase}
                      onChange={(event) => setPushPassphrase(event.target.value)}
                    />
                  </div>
                </div>
                <Button disabled={!pushPassphrase || pushing} onClick={() => void push()}>
                  <CloudUpload className="mr-1.5 size-4" />
                  {pushing ? t('githubSync.pushing') : t('githubSync.pushTitle')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm leading-relaxed text-muted-foreground">
                {t('githubSync.pullIntro')}
              </p>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1 space-y-2">
                  <Label htmlFor="pull-passphrase">{t('githubSync.passphrase')}</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                    <Input
                      id="pull-passphrase"
                      type="password"
                      className="pl-9"
                      placeholder={t('githubSync.pullPassphrasePlaceholder')}
                      value={pullPassphrase}
                      onChange={(event) => {
                        setPullPassphrase(event.target.value);
                        transfer.invalidate();
                      }}
                    />
                  </div>
                </div>
                <Button
                  variant="outline"
                  disabled={!pullPassphrase || transfer.pending !== null}
                  onClick={() => void transfer.inspect()}
                >
                  <RefreshCw
                    className={cn(
                      'mr-1.5 size-4',
                      transfer.pending === 'preview' && 'animate-spin',
                    )}
                  />
                  {transfer.pending === 'preview'
                    ? t('transfer.inspecting')
                    : t('githubSync.inspect')}
                </Button>
              </div>

              {transfer.preview ? (
                <ImportReview
                  idPrefix="gist"
                  preview={transfer.preview}
                  conflictPolicy={transfer.conflictPolicy}
                  restoreActive={transfer.restoreActive}
                  stale={transfer.stale}
                  pending={transfer.pending === 'import'}
                  canImport={transfer.canImport}
                  onPolicyChange={transfer.changePolicy}
                  onRestoreActiveChange={transfer.changeRestoreActive}
                  onConfirm={() => void transfer.confirm()}
                  meta={
                    <>
                      <span className="font-medium text-foreground">
                        {t('githubSync.previewTitle')}
                      </span>
                      {gistUpdatedAt ? (
                        <span>
                          {t('githubSync.backedUpAt', {
                            time: new Date(gistUpdatedAt).toLocaleString(locale),
                          })}
                        </span>
                      ) : null}
                    </>
                  }
                />
              ) : null}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-muted-foreground">{t('githubSync.intro')}</p>
          <div className="grid grid-cols-2 rounded-lg bg-muted p-1">
            {(['device', 'token'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                aria-pressed={authTab === tab}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-md py-1.5 text-sm font-medium transition-colors',
                  authTab === tab
                    ? 'bg-background text-foreground shadow-sm'
                    : 'cursor-pointer text-muted-foreground hover:text-foreground',
                )}
                onClick={() => setAuthTab(tab)}
              >
                {tab === 'device' ? t('githubSync.tabDevice') : t('githubSync.tabToken')}
              </button>
            ))}
          </div>

          {authTab === 'device' ? (
            deviceCode ? (
              <div className="space-y-5 rounded-2xl border bg-muted/20 p-5">
                <div className="flex flex-col items-center justify-center space-y-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t('githubSync.userCode')}
                  </span>
                  <button
                    type="button"
                    onClick={copyUserCode}
                    className="group inline-flex cursor-pointer items-center gap-3 rounded-xl border border-primary/20 bg-background/90 px-5 py-2.5 font-mono text-3xl font-extrabold tracking-widest text-primary transition-colors hover:border-primary/50 hover:bg-primary/5"
                    title={t('githubSync.copyCode')}
                  >
                    <span>{deviceCode.userCode}</span>
                    <span className="rounded-md bg-primary/10 p-1 text-primary transition-colors group-hover:bg-primary/20">
                      {copiedCode ? (
                        <Check className="size-4 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <Copy className="size-4" />
                      )}
                    </span>
                  </button>
                  {copiedCode ? (
                    <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                      {t('githubSync.copied')}
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-col items-center space-y-3">
                  <Button className="px-6 font-semibold" asChild>
                    <a
                      href={deviceCode.verificationUri}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={copyUserCode}
                    >
                      <ExternalLink className="mr-1.5 size-4" />
                      {t('githubSync.openAuthPage')}
                    </a>
                  </Button>

                  <div className="flex w-full items-center justify-between rounded-xl border border-border/40 bg-background/50 px-3 py-2 text-xs text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <RefreshCw
                        className={cn(
                          'size-3.5 text-primary',
                          (polling || checkingAuth) && 'animate-spin',
                        )}
                      />
                      <span>
                        {checkingAuth
                          ? t('githubSync.checkingAuth')
                          : polling && pollIntervalSec > MIN_POLL_SECONDS
                            ? t('githubSync.waitingAuthInterval', { seconds: pollIntervalSec })
                            : t('githubSync.waitingAuth')}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="cursor-pointer font-medium text-primary hover:underline disabled:opacity-50"
                        disabled={checkingAuth}
                        onClick={() => void checkDeviceCodeStatus(deviceCode.deviceCode, true)}
                      >
                        {t('githubSync.checkNow')}
                      </button>
                      <span>·</span>
                      <button
                        type="button"
                        className="cursor-pointer text-muted-foreground hover:text-foreground"
                        onClick={() => void requestDeviceCode()}
                      >
                        {t('githubSync.regenerateCode')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">{t('githubSync.deviceIntro')}</p>
                <div className="flex justify-center">
                  <Button
                    className="px-6"
                    disabled={requestingCode}
                    onClick={() => void requestDeviceCode()}
                  >
                    <Github className="mr-2 size-4" />
                    {requestingCode ? t('githubSync.checkingAuth') : t('githubSync.getCode')}
                  </Button>
                </div>
              </div>
            )
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="github-pat">{t('githubSync.tokenLabel')}</Label>
                <div className="relative">
                  <Key className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                  <Input
                    id="github-pat"
                    type="password"
                    className="pl-9"
                    placeholder={t('githubSync.tokenPlaceholder')}
                    value={tokenInput}
                    onChange={(event) => setTokenInput(event.target.value)}
                  />
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t('githubSync.tokenScopeHint')}
                </p>
              </div>
              <Button
                disabled={!tokenInput.trim() || connectingToken}
                onClick={() => void connectToken()}
              >
                <Github className="mr-2 size-4" />
                {connectingToken ? t('githubSync.connecting') : t('githubSync.connectToken')}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
