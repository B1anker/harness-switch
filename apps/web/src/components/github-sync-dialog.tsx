import {
  type GitHubDeviceCodeResponse,
  type GitHubDevicePollResponse,
  type GitHubPullPreviewResponse,
  type GitHubPushResponse,
  type GitHubSyncStatus,
  HARNESS_LABELS,
  type TransferConflictPolicy,
  type TransferImportResponse,
  type TransferPreview,
} from '@seaveyon/harness-switch-shared';
import type { TFunction } from 'i18next';
import {
  AlertTriangle,
  Check,
  Cloud,
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { useTranslation } from '@/lib/i18n';
import { errorLine, lineText, type MessageLine, messageLine } from '@/lib/messages';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/app-store';

type GitHubSyncDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function GitHubSyncDialog({ open, onOpenChange }: GitHubSyncDialogProps) {
  const { t } = useTranslation();
  const loadHarnesses = useAppStore((state) => state.loadHarnesses);
  const setNotice = useAppStore((state) => state.setNotice);

  const [status, setStatus] = useState<GitHubSyncStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [error, setError] = useState<MessageLine | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Tabs
  const [authTab, setAuthTab] = useState<'device' | 'token'>('device');
  const [syncTab, setSyncTab] = useState<'push' | 'pull'>('push');

  // Device code login state
  const [deviceCode, setDeviceCode] = useState<GitHubDeviceCodeResponse | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [polling, setPolling] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(false);
  const [pollIntervalSec, setPollIntervalSec] = useState(5);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Token login state
  const [tokenInput, setTokenInput] = useState('');
  const [connectingToken, setConnectingToken] = useState(false);

  // Push state
  const [pushPassphrase, setPushPassphrase] = useState('');
  const [includeCodexLoginCache, setIncludeCodexLoginCache] = useState(false);
  const [pushing, setPushing] = useState(false);

  // Pull state
  const [pullPassphrase, setPullPassphrase] = useState('');
  const [conflictPolicy, setConflictPolicy] = useState<TransferConflictPolicy>('skip');
  const [restoreActive, setRestoreActive] = useState(true);
  const [migrateCodexLoginCache, setMigrateCodexLoginCache] = useState(false);
  const [preview, setPreview] = useState<TransferPreview | null>(null);
  const [gistUpdatedAt, setGistUpdatedAt] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [pulling, setPulling] = useState(false);

  async function loadStatus() {
    setLoadingStatus(true);
    try {
      const res = await api<GitHubSyncStatus>('/api/github/status');
      setStatus(res);
    } catch (err) {
      setError(errorLine(err));
    } finally {
      setLoadingStatus(false);
    }
  }

  useEffect(() => {
    if (open) {
      setError(null);
      setMessage(null);
      void loadStatus();
    } else {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      setPolling(false);
      setDeviceCode(null);
      setPreview(null);
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, []);

  async function requestDeviceCode() {
    setError(null);
    setMessage(null);
    try {
      const res = await api<GitHubDeviceCodeResponse>('/api/github/device/code', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setDeviceCode(res);
      startPolling(res.deviceCode, res.interval);
    } catch (err) {
      setError(errorLine(err));
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
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        setPolling(false);
        setDeviceCode(null);
        setMessage(`GitHub 授权成功！欢迎 ${res.username || ''}`);
        void loadStatus();
      } else if (res.status === 'expired') {
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        setPolling(false);
        setError(errorLine(res.error || '授权已过期，请重新获取授权码'));
      } else if (res.status === 'error') {
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        setPolling(false);
        setError(errorLine(res.error || '授权失败，请重试'));
      } else if (res.status === 'pending') {
        if (res.interval && res.interval > 5) {
          // GitHub requested to slow down polling
          setPollIntervalSec(res.interval);
          startPolling(targetCode, res.interval);
        }
        if (manual) {
          setMessage(t('githubSync.pendingAuth'));
        }
      }
    } catch (err) {
      if (manual) setError(errorLine(err));
    } finally {
      if (manual) setCheckingAuth(false);
    }
  }

  function startPolling(code: string, intervalSec = 5) {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    setPolling(true);
    setPollIntervalSec(intervalSec);

    const intervalMs = Math.max(intervalSec, 5) * 1000;
    pollTimerRef.current = setInterval(() => {
      void checkDeviceCodeStatus(code, false);
    }, intervalMs);
  }

  async function handleTokenConnect() {
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
      setMessage(`GitHub 连接成功！欢迎 ${res.username || ''}`);
    } catch (err) {
      setError(errorLine(err));
    } finally {
      setConnectingToken(false);
    }
  }

  async function handleDisconnect() {
    setError(null);
    setMessage(null);
    try {
      await api('/api/github/disconnect', { method: 'POST' });
      setStatus({ connected: false });
      setPreview(null);
      setMessage('已断开与 GitHub 的连接');
    } catch (err) {
      setError(errorLine(err));
    }
  }

  function copyUserCode() {
    if (!deviceCode?.userCode) return;
    void navigator.clipboard.writeText(deviceCode.userCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  }

  async function handlePush() {
    if (!pushPassphrase) return;
    setPushing(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api<GitHubPushResponse>('/api/github/push', {
        method: 'POST',
        body: JSON.stringify({
          passphrase: pushPassphrase,
          includeCodexLoginCache,
        }),
      });
      setMessage(
        t('githubSync.pushSuccess', {
          profiles: res.exportedProfilesCount,
          vault: res.exportedVaultCount,
        }),
      );
      void loadStatus();
    } catch (err) {
      setError(errorLine(err));
    } finally {
      setPushing(false);
    }
  }

  async function handlePullPreview() {
    if (!pullPassphrase) return;
    setPreviewing(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api<GitHubPullPreviewResponse>('/api/github/pull/preview', {
        method: 'POST',
        body: JSON.stringify({
          passphrase: pullPassphrase,
          conflictPolicy,
          restoreActive,
        }),
      });
      setPreview(res.preview);
      setGistUpdatedAt(res.gistUpdatedAt);
    } catch (err) {
      setPreview(null);
      setError(errorLine(err));
    } finally {
      setPreviewing(false);
    }
  }

  async function handlePull() {
    if (!pullPassphrase) return;
    setPulling(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api<TransferImportResponse>('/api/github/pull', {
        method: 'POST',
        body: JSON.stringify({
          passphrase: pullPassphrase,
          conflictPolicy,
          restoreActive,
          migrateCodexLoginCache,
        }),
      });
      void loadHarnesses();
      const parts = formatSummary(res, t);
      setMessage(t('githubSync.pullSuccess', { summary: parts }));
      setNotice(
        res.warnings.length > 0 ? res.warnings.map(messageLine) : [{ key: 'transfer.imported' }],
      );
      setPreview(null);
      void loadStatus();
    } catch (err) {
      setError(errorLine(err));
    } finally {
      setPulling(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Cloud className="size-5 text-primary" />
            <DialogTitle>{t('githubSync.title')}</DialogTitle>
          </div>
          <DialogDescription>{t('githubSync.intro')}</DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {lineText(t, error)}
          </div>
        )}

        {message && (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">
            {message}
          </div>
        )}

        {status?.connected ? (
          <div className="space-y-6">
            {/* User status card */}
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
                      已连接
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t('githubSync.lastSynced')}{' '}
                    {status.lastSyncedAt
                      ? new Date(status.lastSyncedAt).toLocaleString()
                      : t('githubSync.neverSynced')}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void loadStatus()}
                  disabled={loadingStatus}
                >
                  <RefreshCw className={`size-4 ${loadingStatus ? 'animate-spin' : ''}`} />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void handleDisconnect()}>
                  <LogOut className="mr-1 size-4" />
                  {t('githubSync.disconnect')}
                </Button>
              </div>
            </div>

            {/* Sync actions tabs */}
            <div className="space-y-4">
              <div className="grid grid-cols-2 rounded-lg bg-muted p-1">
                <button
                  type="button"
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-md py-1.5 text-sm font-medium transition-colors',
                    syncTab === 'push'
                      ? 'bg-background shadow-sm text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  onClick={() => setSyncTab('push')}
                >
                  <CloudUpload className="size-4" />
                  {t('githubSync.pushTitle')}
                </button>
                <button
                  type="button"
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-md py-1.5 text-sm font-medium transition-colors',
                    syncTab === 'pull'
                      ? 'bg-background shadow-sm text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  onClick={() => setSyncTab('pull')}
                >
                  <CloudDownload className="size-4" />
                  {t('githubSync.pullTitle')}
                </button>
              </div>

              {/* Push Tab */}
              {syncTab === 'push' && (
                <div className="space-y-4 pt-1">
                  <p className="text-sm text-muted-foreground">{t('githubSync.pushIntro')}</p>
                  <div className="space-y-2">
                    <Label htmlFor="push-passphrase">{t('githubSync.passphrase')}</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                      <Input
                        id="push-passphrase"
                        type="password"
                        className="pl-9"
                        placeholder={t('githubSync.passphrasePlaceholder')}
                        value={pushPassphrase}
                        onChange={(e) => setPushPassphrase(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="push-codex-cache"
                      checked={includeCodexLoginCache}
                      onCheckedChange={(checked) => setIncludeCodexLoginCache(Boolean(checked))}
                    />
                    <Label htmlFor="push-codex-cache" className="text-sm font-normal">
                      {t('githubSync.includeCache')}
                    </Label>
                  </div>

                  <Button
                    className="w-full"
                    disabled={!pushPassphrase || pushing}
                    onClick={() => void handlePush()}
                  >
                    <CloudUpload className="mr-2 size-4" />
                    {pushing ? t('githubSync.pushing') : t('githubSync.pushTitle')}
                  </Button>
                </div>
              )}

              {/* Pull Tab */}
              {syncTab === 'pull' && (
                <div className="space-y-4 pt-1">
                  <p className="text-sm text-muted-foreground">{t('githubSync.pullIntro')}</p>
                  <div className="space-y-2">
                    <Label htmlFor="pull-passphrase">{t('githubSync.passphrase')}</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                      <Input
                        id="pull-passphrase"
                        type="password"
                        className="pl-9"
                        placeholder={t('githubSync.pullPassphrasePlaceholder')}
                        value={pullPassphrase}
                        onChange={(e) => {
                          setPullPassphrase(e.target.value);
                          setPreview(null);
                        }}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>{t('transfer.conflictPolicy')}</Label>
                      <Select
                        value={conflictPolicy}
                        onValueChange={(val: TransferConflictPolicy) => {
                          setConflictPolicy(val);
                          setPreview(null);
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="skip">{t('transfer.policySkip')}</SelectItem>
                          <SelectItem value="overwrite">{t('transfer.policyOverwrite')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="pull-restore-active"
                        checked={restoreActive}
                        onCheckedChange={(checked) => {
                          setRestoreActive(Boolean(checked));
                          setPreview(null);
                        }}
                      />
                      <Label htmlFor="pull-restore-active" className="text-sm font-normal">
                        {t('transfer.restoreActive')}
                      </Label>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="pull-migrate-cache"
                        checked={migrateCodexLoginCache}
                        onCheckedChange={(checked) => {
                          setMigrateCodexLoginCache(Boolean(checked));
                        }}
                      />
                      <Label htmlFor="pull-migrate-cache" className="text-sm font-normal">
                        {t('transfer.migrateCache')}
                      </Label>
                    </div>
                  </div>

                  {preview ? (
                    <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
                        <span className="font-semibold text-sm">云端备份检查结果</span>
                        <span className="text-xs text-muted-foreground">
                          备份时间: {gistUpdatedAt ? new Date(gistUpdatedAt).toLocaleString() : ''}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                        <div className="rounded-lg border bg-background p-2 text-center">
                          <div className="font-bold text-lg">{preview.profileCount}</div>
                          <div className="text-xs text-muted-foreground">配置数量</div>
                        </div>
                        <div className="rounded-lg border bg-background p-2 text-center">
                          <div className="font-bold text-lg">{preview.providerCount}</div>
                          <div className="text-xs text-muted-foreground">凭据数量</div>
                        </div>
                        <div className="rounded-lg border bg-background p-2 text-center">
                          <div className="font-bold text-lg text-amber-500">
                            {preview.conflicts.length}
                          </div>
                          <div className="text-xs text-muted-foreground">同名冲突</div>
                        </div>
                        <div className="rounded-lg border bg-background p-2 text-center">
                          <div className="font-bold text-lg">{preview.activeCount}</div>
                          <div className="text-xs text-muted-foreground">激活状态</div>
                        </div>
                      </div>

                      {preview.conflicts.length > 0 && (
                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                          <div className="flex items-center gap-1 font-semibold">
                            <AlertTriangle className="size-4" />
                            发现同名配置：
                          </div>
                          <div className="mt-1">
                            {preview.conflicts
                              .map((c) => `${HARNESS_LABELS[c.harness] || c.harness}/${c.name}`)
                              .join('、')}
                          </div>
                          <div className="mt-1">
                            当前策略：
                            {conflictPolicy === 'skip' ? '保留本机，跳过导入' : '覆盖本机同名配置'}
                          </div>
                        </div>
                      )}

                      <Button
                        className="w-full"
                        disabled={pulling}
                        onClick={() => void handlePull()}
                      >
                        <CloudDownload className="mr-2 size-4" />
                        {pulling ? t('githubSync.pulling') : t('githubSync.confirmPull')}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      className="w-full"
                      disabled={!pullPassphrase || previewing}
                      onClick={() => void handlePullPreview()}
                    >
                      <RefreshCw className={`mr-2 size-4 ${previewing ? 'animate-spin' : ''}`} />
                      {previewing ? t('transfer.inspecting') : t('githubSync.inspect')}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Login options */
          <div className="space-y-4">
            <div className="grid grid-cols-2 rounded-lg bg-muted p-1">
              <button
                type="button"
                className={cn(
                  'flex items-center justify-center gap-2 rounded-md py-1.5 text-sm font-medium transition-colors',
                  authTab === 'device'
                    ? 'bg-background shadow-sm text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => setAuthTab('device')}
              >
                {t('githubSync.tabDevice')}
              </button>
              <button
                type="button"
                className={cn(
                  'flex items-center justify-center gap-2 rounded-md py-1.5 text-sm font-medium transition-colors',
                  authTab === 'token'
                    ? 'bg-background shadow-sm text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => setAuthTab('token')}
              >
                {t('githubSync.tabToken')}
              </button>
            </div>

            {authTab === 'device' && (
              <div className="space-y-4 pt-1">
                <p className="text-sm text-muted-foreground">{t('githubSync.deviceIntro')}</p>

                {deviceCode ? (
                  <div className="space-y-4 rounded-xl border bg-muted/30 p-4">
                    <div className="space-y-1 text-center">
                      <span className="text-xs text-muted-foreground">
                        {t('githubSync.userCode')}
                      </span>
                      <div className="flex items-center justify-center gap-2">
                        <code className="rounded-md bg-background px-3 py-1.5 font-mono text-2xl font-bold tracking-widest text-primary border">
                          {deviceCode.userCode}
                        </code>
                        <Button variant="outline" size="icon" onClick={copyUserCode}>
                          {copiedCode ? (
                            <Check className="size-4 text-emerald-500" />
                          ) : (
                            <Copy className="size-4" />
                          )}
                        </Button>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <Button className="w-full" asChild>
                        <a
                          href={deviceCode.verificationUri}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="mr-2 size-4" />
                          {t('githubSync.openAuthPage')}
                        </a>
                      </Button>

                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full"
                        disabled={checkingAuth}
                        onClick={() => {
                          if (deviceCode?.deviceCode) {
                            void checkDeviceCodeStatus(deviceCode.deviceCode, true);
                          }
                        }}
                      >
                        <RefreshCw
                          className={`mr-2 size-4 ${checkingAuth ? 'animate-spin' : ''}`}
                        />
                        {checkingAuth ? t('githubSync.checkingAuth') : t('githubSync.checkNow')}
                      </Button>

                      <div className="flex items-center justify-between pt-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs text-muted-foreground hover:text-foreground h-auto p-1"
                          onClick={() => void requestDeviceCode()}
                        >
                          {t('githubSync.regenerateCode')}
                        </Button>
                        {polling && (
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <RefreshCw className="size-3 animate-spin" />
                            {pollIntervalSec > 5
                              ? t('githubSync.waitingAuthInterval', { seconds: pollIntervalSec })
                              : t('githubSync.waitingAuth')}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <Button className="w-full" onClick={() => void requestDeviceCode()}>
                    <Github className="mr-2 size-4" />
                    {t('githubSync.getCode')}
                  </Button>
                )}
              </div>
            )}

            {authTab === 'token' && (
              <div className="space-y-4 pt-1">
                <div className="space-y-2">
                  <Label htmlFor="github-pat">Personal Access Token</Label>
                  <div className="relative">
                    <Key className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                    <Input
                      id="github-pat"
                      type="password"
                      className="pl-9"
                      placeholder={t('githubSync.tokenPlaceholder')}
                      value={tokenInput}
                      onChange={(e) => setTokenInput(e.target.value)}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Token 需具备 <code className="text-primary font-mono">gist</code>{' '}
                    权限以读写加密配置文件。
                  </p>
                </div>

                <Button
                  className="w-full"
                  disabled={!tokenInput.trim() || connectingToken}
                  onClick={() => void handleTokenConnect()}
                >
                  <Github className="mr-2 size-4" />
                  {connectingToken ? '连接中…' : t('githubSync.connectToken')}
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function formatSummary(result: TransferImportResponse, t: TFunction): string {
  const parts: string[] = [];
  if (result.imported > 0) {
    parts.push(t('transfer.importedCount', { count: result.imported }));
  }
  if (result.overwritten > 0) {
    parts.push(t('transfer.overwrittenCount', { count: result.overwritten }));
  }
  if (result.providersCopied > 0) {
    parts.push(t('transfer.providersCopiedCount', { count: result.providersCopied }));
  }
  if (result.skipped > 0) {
    parts.push(t('transfer.skippedCount', { count: result.skipped }));
  }
  if (result.activeRestored > 0) {
    parts.push(t('transfer.activeRestoredCount', { count: result.activeRestored }));
  }
  return parts.join('，') || '无变动';
}
