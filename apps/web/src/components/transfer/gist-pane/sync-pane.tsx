import type {
  GitHubPullPreviewResponse,
  GitHubPushResponse,
} from '@seaveyon/harness-switch-shared';
import { CloudDownload, CloudUpload, Lock, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { buildImportNotice, ImportReview } from '@/components/import-review';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SegmentedControl } from '@/components/ui/tabs';
import { api, githubPath } from '@/lib/api';
import { useI18n, useTranslation } from '@/lib/i18n';
import { errorLine, type MessageLine } from '@/lib/messages';
import { useTransferImport } from '@/lib/use-transfer-import';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/app-store';

const SYNC_TABS = ['push', 'pull'] as const;

/** Moving the encrypted package to the Gist, or back from it. */
export function SyncPane({
  onDone,
  onSynced,
  onMessage,
  onError,
  onClear,
}: {
  onDone: () => void;
  /** The Gist changed, so the account card's timestamps are stale. */
  onSynced: () => void;
  onMessage: (line: MessageLine) => void;
  onError: (line: MessageLine) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const { locale } = useI18n();
  const loadHarnesses = useAppStore((state) => state.loadHarnesses);
  const setNotice = useAppStore((state) => state.setNotice);
  const [tab, setTab] = useState<(typeof SYNC_TABS)[number]>('push');
  const [pushPassphrase, setPushPassphrase] = useState('');
  const [pushing, setPushing] = useState(false);
  const [pullPassphrase, setPullPassphrase] = useState('');
  const [gistUpdatedAt, setGistUpdatedAt] = useState<string | null>(null);

  const transfer = useTransferImport({
    fetchPreview: async (options) => {
      const res = await api<GitHubPullPreviewResponse>(githubPath.pullPreview, {
        method: 'POST',
        body: JSON.stringify({ passphrase: pullPassphrase, ...options }),
      });
      setGistUpdatedAt(res.gistUpdatedAt);
      return res.preview;
    },
    runImport: (options) =>
      api(githubPath.pull, {
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

  async function push() {
    if (!pushPassphrase) return;
    setPushing(true);
    onClear();
    try {
      const res = await api<GitHubPushResponse>(githubPath.push, {
        method: 'POST',
        body: JSON.stringify({ passphrase: pushPassphrase, includeCodexLoginCache: true }),
      });
      onMessage({
        key: 'githubSync.pushSuccess',
        params: { profiles: res.exportedProfilesCount, vault: res.exportedVaultCount },
      });
      onSynced();
    } catch (caught) {
      onError(errorLine(caught));
    } finally {
      setPushing(false);
    }
  }

  return (
    <>
      <SegmentedControl options={SYNC_TABS} value={tab} onChange={setTab}>
        {(option) => (
          <>
            {option === 'push' ? (
              <CloudUpload className="size-4" />
            ) : (
              <CloudDownload className="size-4" />
            )}
            {option === 'push' ? t('githubSync.pushTitle') : t('githubSync.pullTitle')}
          </>
        )}
      </SegmentedControl>

      {tab === 'push' ? (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t('githubSync.pushIntro')}
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <PassphraseField
              id="push-passphrase"
              placeholder={t('githubSync.passphrasePlaceholder')}
              value={pushPassphrase}
              onChange={setPushPassphrase}
            />
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
            <PassphraseField
              id="pull-passphrase"
              placeholder={t('githubSync.pullPassphrasePlaceholder')}
              value={pullPassphrase}
              onChange={(value) => {
                setPullPassphrase(value);
                transfer.invalidate();
              }}
            />
            <Button
              variant="outline"
              disabled={!pullPassphrase || transfer.pending !== null}
              onClick={() => void transfer.inspect()}
            >
              <RefreshCw
                className={cn('mr-1.5 size-4', transfer.pending === 'preview' && 'animate-spin')}
              />
              {transfer.pending === 'preview' ? t('transfer.inspecting') : t('githubSync.inspect')}
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
    </>
  );
}

function PassphraseField({
  id,
  placeholder,
  value,
  onChange,
}: {
  id: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex-1 space-y-2">
      <Label htmlFor={id}>{t('githubSync.passphrase')}</Label>
      <div className="relative">
        <Lock className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
        <Input
          id={id}
          type="password"
          className="pl-9"
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </div>
  );
}
