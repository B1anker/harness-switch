import type { GitHubSyncStatus } from '@seaveyon/harness-switch-shared';
import { Check, Copy, ExternalLink, Github, Key, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SegmentedControl } from '@/components/ui/tabs';
import { api, githubPath } from '@/lib/api';
import { useTranslation } from '@/lib/i18n';
import { errorLine, type MessageLine } from '@/lib/messages';
import { cn } from '@/lib/utils';
import { type DeviceFlow, MIN_POLL_SECONDS, useDeviceFlow } from './use-device-flow';

const AUTH_TABS = ['device', 'token'] as const;

/** The two ways to hand this machine a GitHub credential. */
export function ConnectPane({
  onConnected,
  onMessage,
  onError,
  onClear,
}: {
  onConnected: (status: GitHubSyncStatus) => void;
  onMessage: (line: MessageLine) => void;
  onError: (line: MessageLine) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<(typeof AUTH_TABS)[number]>('device');
  const [token, setToken] = useState('');
  const [connecting, setConnecting] = useState(false);

  const device = useDeviceFlow({
    onStarted: onClear,
    onError,
    onAuthorized: (user) => onMessage({ key: 'githubSync.authorized', params: { user } }),
  });

  async function connectToken() {
    if (!token.trim()) {
      return;
    }
    setConnecting(true);
    onClear();
    try {
      const status = await api<GitHubSyncStatus>(githubPath.token, {
        method: 'POST',
        body: JSON.stringify({ token: token.trim() }),
      });
      onConnected(status);
      setToken('');
      onMessage({ key: 'githubSync.connected', params: { user: status.username ?? '' } });
    } catch (caught) {
      onError(errorLine(caught));
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-muted-foreground">{t('githubSync.intro')}</p>
      <SegmentedControl options={AUTH_TABS} value={tab} onChange={setTab}>
        {(option) => (option === 'device' ? t('githubSync.tabDevice') : t('githubSync.tabToken'))}
      </SegmentedControl>

      {tab === 'device' ? (
        <DeviceStep device={device} />
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
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t('githubSync.tokenScopeHint')}
            </p>
          </div>
          <Button disabled={!token.trim() || connecting} onClick={() => void connectToken()}>
            <Github className="mr-2 size-4" />
            {connecting ? t('githubSync.connecting') : t('githubSync.connectToken')}
          </Button>
        </div>
      )}
    </div>
  );
}

function DeviceStep({ device }: { device: DeviceFlow }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  function copyUserCode() {
    if (!device.code?.userCode) {
      return;
    }
    void navigator.clipboard.writeText(device.code.userCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!device.code) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('githubSync.deviceIntro')}</p>
        <div className="flex justify-center">
          <Button
            className="px-6"
            disabled={device.requesting}
            onClick={() => void device.requestCode()}
          >
            <Github className="mr-2 size-4" />
            {device.requesting ? t('githubSync.checkingAuth') : t('githubSync.getCode')}
          </Button>
        </div>
      </div>
    );
  }

  return (
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
          <span>{device.code.userCode}</span>
          <span className="rounded-md bg-primary/10 p-1 text-primary transition-colors group-hover:bg-primary/20">
            {copied ? (
              <Check className="size-4 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Copy className="size-4" />
            )}
          </span>
        </button>
        {copied ? (
          <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
            {t('githubSync.copied')}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col items-center space-y-3">
        <Button className="px-6 font-semibold" asChild>
          <a
            href={device.code.verificationUri}
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
                (device.polling || device.checking) && 'animate-spin',
              )}
            />
            <span>
              {device.checking
                ? t('githubSync.checkingAuth')
                : device.polling && device.intervalSeconds > MIN_POLL_SECONDS
                  ? t('githubSync.waitingAuthInterval', { seconds: device.intervalSeconds })
                  : t('githubSync.waitingAuth')}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="cursor-pointer font-medium text-primary hover:underline disabled:opacity-50"
              disabled={device.checking}
              onClick={() => void device.checkNow()}
            >
              {t('githubSync.checkNow')}
            </button>
            <span>·</span>
            <button
              type="button"
              className="cursor-pointer text-muted-foreground hover:text-foreground"
              onClick={() => void device.requestCode()}
            >
              {t('githubSync.regenerateCode')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
