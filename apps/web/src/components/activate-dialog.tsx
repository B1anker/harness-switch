import type { HarnessSummary, PreviewTarget, ProfilePublic } from '@seaveyon/harness-switch-shared';
import { type MouseEvent, useEffect, useState } from 'react';
import { ConfigDiffs, changeKind } from '@/components/config-diff';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { TabList, TabPanel } from '@/components/ui/tabs';
import { currentPath } from '@/components/workspace/configuration-path';
import { SwitchFlow } from '@/components/workspace/switch-flow';
import { configuredModel } from '@/lib/configured-model';
import { useTranslation } from '@/lib/i18n';
import { errorLine, lineText, type MessageLine } from '@/lib/messages';
import { useAppStore } from '@/stores/app-store';

type ActivateDialogProps = {
  harness: HarnessSummary;
  profile?: ProfilePublic;
  official?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Confirmation step before activating a profile: fetches the exact content
 * that would be written and shows the diff against the live files.
 */
export function ActivateDialog({
  harness,
  profile,
  official = false,
  open,
  onOpenChange,
}: ActivateDialogProps) {
  const { t } = useTranslation();
  const previewProfile = useAppStore((state) => state.previewProfile);
  const previewOfficial = useAppStore((state) => state.previewOfficial);
  const activateProfile = useAppStore((state) => state.activateProfile);
  const activateOfficial = useAppStore((state) => state.activateOfficial);
  const currentUser = useAppStore((state) => state.currentUser);
  const profileName = official ? t('harness.official') : profile?.name;
  const [targets, setTargets] = useState<PreviewTarget[] | null>(null);
  const [previewError, setPreviewError] = useState<MessageLine | null>(null);
  const [activationError, setActivationError] = useState<MessageLine | null>(null);
  const [executing, setExecuting] = useState(false);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [tab, setTab] = useState('route');

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setTargets(null);
    setPreviewError(null);
    setActivationError(null);
    setExecuting(false);
    const preview = official
      ? previewOfficial(harness.id)
      : previewProfile(harness.id, profileName ?? '');
    void preview
      .then((result) => {
        if (!cancelled) {
          setTargets(result);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setPreviewError(errorLine(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, harness.id, official, previewAttempt, previewOfficial, previewProfile, profileName]);

  async function activate(event: MouseEvent<HTMLButtonElement>) {
    // AlertDialogAction closes by default; keep the diff visible until the write has
    // completed, then close and let the toast confirm, or stay open for a retry.
    event.preventDefault();
    if (!targets || executing) {
      return;
    }
    setExecuting(true);
    setActivationError(null);
    try {
      if (official) {
        await activateOfficial(harness.id);
      } else {
        await activateProfile(harness.id, profileName ?? '');
      }
      onOpenChange(false);
    } catch (error) {
      setActivationError(errorLine(error));
    } finally {
      setExecuting(false);
    }
  }

  const files =
    targets?.map((target) => ({
      path: target.path,
      existed: target.currentContent !== null,
      content: target.content,
      currentContent: target.currentContent,
    })) ?? [];
  const changedCount = files.filter((file) => changeKind(file) !== 'same').length;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        style={{ height: profile && tab === 'route' ? 'min(520px, 90dvh)' : 'min(820px, 90dvh)' }}
        className="flex flex-col overflow-hidden sm:max-w-4xl data-[state=open]:animate-none data-[state=closed]:animate-none"
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {official ? t('activate.officialTitle') : t('activate.title')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t(official ? 'activate.officialBody' : 'activate.body', {
              harness: harness.label,
              profile: profileName ?? '',
              changed: changedCount > 0 ? t('activate.changedFiles', { count: changedCount }) : '',
              user: currentUser || t('notice.currentUser'),
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {profile ? (
          <TabList
            idPrefix="profile-preview"
            label={t('favorites.reviewChanges')}
            items={[
              { id: 'route', label: t('workspace.switchMap') },
              { id: 'diff', label: t('workspace.fileDiffTab') },
            ]}
            value={tab}
            onChange={setTab}
            className="flex gap-2"
            tabClassName="px-4 py-2 text-sm"
          >
            {(item) => item.label}
          </TabList>
        ) : null}
        <TabPanel idPrefix="profile-preview" value={tab} className="min-h-0 flex-1 overflow-auto">
          {profile && tab === 'route' ? (
            <SwitchFlow
              current={currentPath(harness, t)}
              candidate={{
                provider: profile.name,
                model: configuredModel(profile, t),
                sourceLabel: t(
                  profile.modelFavorite?.favoriteId ? 'templates.tag' : 'workspace.configuration',
                ),
              }}
              harness={harness}
            />
          ) : previewError ? (
            <p className="text-sm text-destructive">
              {t('activate.loadFailed', { reason: lineText(t, previewError) })}
            </p>
          ) : targets === null ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t('activate.loading')}
            </p>
          ) : (
            <div className="max-h-[52dvh] overflow-y-auto rounded-xl border p-3">
              <ConfigDiffs files={files} />
            </div>
          )}
        </TabPanel>
        {profile && tab === 'route' && previewError ? (
          <p role="alert" className="text-sm text-destructive">
            {lineText(t, previewError)}
          </p>
        ) : null}
        {activationError ? (
          <p className="text-sm text-destructive">
            {t('activate.failed', { reason: lineText(t, activationError) })}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={executing}>{t('common.cancel')}</AlertDialogCancel>
          {previewError ? (
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                setPreviewAttempt((attempt) => attempt + 1);
              }}
            >
              {t('activate.retryPreview')}
            </AlertDialogAction>
          ) : (
            <AlertDialogAction disabled={targets === null || executing} onClick={activate}>
              {executing
                ? t('activate.executing')
                : activationError
                  ? t('activate.retry')
                  : t('activate.confirm')}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
