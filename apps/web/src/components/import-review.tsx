import {
  HARNESS_LABELS,
  type TransferConflictPolicy,
  type TransferImportResponse,
  type TransferPreview,
} from '@seaveyon/harness-switch-shared';
import type { TFunction } from 'i18next';
import { Upload } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTranslation } from '@/lib/i18n';
import { type MessageLine, messageLine } from '@/lib/messages';

type ImportReviewProps = {
  preview: TransferPreview;
  conflictPolicy: TransferConflictPolicy;
  restoreActive: boolean;
  /** Set when the options changed after this preview was calculated. */
  stale: boolean;
  pending: boolean;
  canImport: boolean;
  onPolicyChange: (policy: TransferConflictPolicy) => void;
  onRestoreActiveChange: (restore: boolean) => void;
  onConfirm: () => void;
  /** Source-specific detail, e.g. when the Gist backup was written. */
  meta?: ReactNode;
  /** Distinguishes the two id namespaces when both sources mount at once. */
  idPrefix: string;
};

/**
 * The review step every `TransferPreview` source shares: what the package holds, which
 * names collide, and the two options that change the outcome.
 *
 * A preview is only true for the options it was calculated with, so editing either one
 * blocks the import until it has been re-checked rather than importing under options the
 * server never evaluated.
 */
export function ImportReview({
  preview,
  conflictPolicy,
  restoreActive,
  stale,
  pending,
  canImport,
  onPolicyChange,
  onRestoreActiveChange,
  onConfirm,
  meta,
  idPrefix,
}: ImportReviewProps) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  // Only meaningful while the preview still matches the options it was built from.
  const activationEffect = stale
    ? null
    : codexActivationEffectText(t, preview.codexActivationAuthEffect);

  return (
    <div className="space-y-4 rounded-xl border bg-card p-4">
      {meta ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3 text-xs text-muted-foreground">
          {meta}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Badge>{t('transfer.profileCount', { count: preview.profileCount })}</Badge>
        {preview.favoriteCount ? (
          <Badge>{t('favorites.importCount', { count: preview.favoriteCount })}</Badge>
        ) : null}
        <Badge variant="secondary">
          {t('transfer.providerCount', { count: preview.providerCount })}
        </Badge>
        <Badge variant={preview.conflicts.length > 0 ? 'outline' : 'secondary'}>
          {t('transfer.conflictCount', { count: preview.conflicts.length })}
        </Badge>
        <Badge variant="secondary">
          {t('transfer.activeCount', { count: preview.activeCount })}
        </Badge>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {preview.harnesses.map((item) => (
          <span key={item.harness}>
            {t('transfer.harnessProfiles', {
              harness: HARNESS_LABELS[item.harness],
              count: item.profiles,
            })}
          </span>
        ))}
      </div>

      {preview.conflicts.length > 0 ? (
        <div className="space-y-1 rounded-xl bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
          <p>
            {t('transfer.conflictList', {
              items: preview.conflicts
                .map((item) => `${HARNESS_LABELS[item.harness]} / ${item.name}`)
                .join(t('common.listSeparator')),
            })}
          </p>
          <p>
            {t('transfer.currentPolicy', {
              policy:
                conflictPolicy === 'skip'
                  ? t('transfer.policySkip')
                  : t('transfer.policyOverwrite'),
            })}
          </p>
        </div>
      ) : null}

      {activationEffect ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
          {activationEffect}
        </div>
      ) : null}

      {stale ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">{t('transfer.previewStale')}</p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-conflict-policy`}>{t('transfer.conflictPolicy')}</Label>
          <Select
            value={conflictPolicy}
            onValueChange={(value) => onPolicyChange(value as TransferConflictPolicy)}
          >
            <SelectTrigger id={`${idPrefix}-conflict-policy`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="skip">{t('transfer.policySkip')}</SelectItem>
              <SelectItem value="overwrite">{t('transfer.policyOverwrite')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <label className="flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm">
          <Checkbox
            checked={restoreActive}
            onCheckedChange={(checked) => onRestoreActiveChange(checked === true)}
          />
          {t('transfer.restoreActive')}
        </label>
      </div>

      <Button type="button" disabled={!canImport} onClick={() => setConfirming(true)}>
        <Upload />
        {stale
          ? t('transfer.recheckNeeded')
          : pending
            ? t('transfer.importing')
            : t('transfer.confirmImport')}
      </Button>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {activationEffect ? t('transfer.confirmAuthTitle') : t('transfer.confirmTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('transfer.confirmBody', { count: preview.profileCount })}
              {conflictPolicy === 'overwrite' && preview.conflicts.length > 0
                ? t('transfer.confirmOverwrite', { count: preview.conflicts.length })
                : t('transfer.confirmKeep')}
              {activationEffect ? ` ${activationEffect}` : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirming(false);
                onConfirm();
              }}
            >
              {activationEffect
                ? t('transfer.proceedAware')
                : conflictPolicy === 'overwrite'
                  ? t('transfer.proceedOverwrite')
                  : t('transfer.proceedSafe')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * The toast for a finished import. Shared so both sources report the same counts in the
 * same order, and so warnings ride along as their own translatable lines.
 */
export function buildImportNotice(t: TFunction, result: TransferImportResponse): MessageLine[] {
  const parts = [t('transfer.importedCount', { count: result.imported })];
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
  parts.push(
    result.codexLoginCacheMigrated ? t('transfer.cacheMigrated') : t('transfer.cacheNotMigrated'),
  );
  return [
    {
      key: 'transfer.importedSummary',
      params: { parts: parts.join(t('common.listSeparator')) },
    },
    ...result.warnings.map((warning) => messageLine(warning)),
  ];
}

function codexActivationEffectText(
  t: TFunction,
  effect: TransferPreview['codexActivationAuthEffect'],
): string | null {
  switch (effect) {
    case 'openai-api-key':
      return t('transfer.authEffect.openai-api-key');
    case 'auth-override':
      return t('transfer.authEffect.auth-override');
    case 'official-cleanup':
      return t('transfer.authEffect.official-cleanup');
    case 'none':
      return null;
  }
}
