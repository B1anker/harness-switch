import type { DriftFileState, DriftStatus, HarnessSummary } from '@seaveyon/harness-switch-shared';
import { useMemo, useState } from 'react';
import { ConfigDiffs } from '@/components/config-diff';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useTranslation } from '@/lib/i18n';
import { errorLineWith, lineText, type MessageLine } from '@/lib/messages';
import { useAppStore } from '@/stores/app-store';

type DriftDialogProps = {
  harness: HarnessSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Badge styling: in-sync is calm, drifted/missing/invalid stand out. */
export function driftStatusClasses(status: DriftStatus): string {
  switch (status) {
    case 'in-sync':
      return 'border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
    case 'drifted':
      return 'border-amber-500/30 text-amber-700 dark:text-amber-300';
    case 'missing':
    case 'invalid':
      return 'border-transparent bg-destructive/15 text-destructive';
    default:
      return '';
  }
}

/**
 * Drift: compares what the active profile would render against what is on disk.
 * Reapplying writes the expected content back (with a backup first); adopting
 * reads the live files back into the profile store instead.
 */
export function DriftDialog({ harness, open, onOpenChange }: DriftDialogProps) {
  const { t } = useTranslation();
  const drift = useAppStore((state) => state.drift);
  const driftLoading = useAppStore((state) => state.driftLoading);
  const reapplyDrift = useAppStore((state) => state.reapplyDrift);
  const adoptDrift = useAppStore((state) => state.adoptDrift);
  const [confirm, setConfirm] = useState<'reapply' | 'adopt' | null>(null);
  const [error, setError] = useState<MessageLine | null>(null);

  const report = useMemo(
    () => drift?.find((item) => item.harness === harness.id) ?? null,
    [drift, harness.id],
  );

  const blockedFiles = report?.files.filter((file) => file.status !== 'in-sync') ?? [];
  const active = report?.active === true;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[min(64rem,calc(100vw-2rem))] max-w-5xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t('drift.dialogTitle', { harness: harness.label })}</DialogTitle>
          <DialogDescription>
            {active ? t('drift.legend') : t('drift.noActiveProfile')}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {driftLoading && report === null ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t('drift.checking')}</p>
          ) : null}
          {report === null && !driftLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t('drift.noData')}</p>
          ) : null}
          {report && !active ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t('drift.nothingToCompare')}
            </p>
          ) : null}
          {report && active ? (
            <div className="space-y-3">
              {blockedFiles.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  {t('drift.allInSync')}
                </p>
              ) : (
                blockedFiles.map((file) => <DriftFileRow key={file.key} file={file} />)
              )}
            </div>
          ) : null}
        </div>

        {error ? <p className="text-sm text-destructive">{lineText(t, error)}</p> : null}

        <DialogFooter>
          <Button
            variant="outline"
            disabled={report === null || !active}
            onClick={() => setConfirm('adopt')}
          >
            {t('drift.adopt')}
          </Button>
          <Button disabled={report === null || !active} onClick={() => setConfirm('reapply')}>
            {t('drift.reapply')}
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={confirm === 'reapply'} onOpenChange={(next) => !next && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('drift.reapplyTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('drift.reapplyBody', { harness: harness.label })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirm(null);
                setError(null);
                void reapplyDrift(harness.id)
                  .then(() => onOpenChange(false))
                  .catch((err: unknown) => {
                    setError(errorLineWith(err, 'drift.reapplyFailed'));
                  });
              }}
            >
              {t('drift.confirmReapply')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirm === 'adopt'} onOpenChange={(next) => !next && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('drift.adoptTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('drift.adoptBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirm(null);
                setError(null);
                void adoptDrift(harness.id)
                  .then(() => onOpenChange(false))
                  .catch((err: unknown) => {
                    setError(errorLineWith(err, 'drift.adoptFailed'));
                  });
              }}
            >
              {t('drift.confirmAdopt')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

function DriftFileRow({ file }: { file: DriftFileState }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 px-1">
        <Badge className={driftStatusClasses(file.status)}>
          {t(`drift.status.${file.status}`)}
        </Badge>
        <p className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={file.path}>
          {file.path}
        </p>
      </div>
      <ConfigDiffs
        files={[
          {
            path: file.path,
            existed: file.currentContent !== null,
            content: file.expectedContent,
            currentContent: file.currentContent,
          },
        ]}
      />
    </div>
  );
}
