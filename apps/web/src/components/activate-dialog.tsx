import type { HarnessSummary, PreviewTarget, ProfilePublic } from '@seaveyon/harness-switch-shared';
import { useEffect, useState } from 'react';
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
import { useTranslation } from '@/lib/i18n';
import { errorLine, lineText, type MessageLine } from '@/lib/messages';
import { useAppStore } from '@/stores/app-store';

type ActivateDialogProps = {
  harness: HarnessSummary;
  profile: ProfilePublic;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Confirmation step before activating a profile: fetches the exact content
 * that would be written and shows the diff against the live files.
 */
export function ActivateDialog({ harness, profile, open, onOpenChange }: ActivateDialogProps) {
  const { t } = useTranslation();
  const previewProfile = useAppStore((state) => state.previewProfile);
  const activateProfile = useAppStore((state) => state.activateProfile);
  const currentUser = useAppStore((state) => state.currentUser);
  const [targets, setTargets] = useState<PreviewTarget[] | null>(null);
  const [error, setError] = useState<MessageLine | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setTargets(null);
    setError(null);
    void previewProfile(harness.id, profile.name)
      .then((result) => {
        if (!cancelled) setTargets(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorLine(err));
      });
    return () => {
      cancelled = true;
    };
  }, [open, harness.id, profile.name, previewProfile]);

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
      <AlertDialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('activate.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('activate.body', {
              harness: harness.label,
              profile: profile.name,
              changed: changedCount > 0 ? t('activate.changedFiles', { count: changedCount }) : '',
              user: currentUser || t('notice.currentUser'),
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p className="text-sm text-destructive">
            {t('activate.loadFailed', { reason: lineText(t, error) })}
          </p>
        ) : targets === null ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('activate.loading')}</p>
        ) : (
          <div className="max-h-[52dvh] overflow-y-auto rounded-xl border p-3">
            <ConfigDiffs files={files} />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              void activateProfile(harness.id, profile.name);
              onOpenChange(false);
            }}
          >
            {t('activate.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
