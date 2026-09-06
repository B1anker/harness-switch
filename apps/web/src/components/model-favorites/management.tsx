import type { FavoritePlanRequest } from '@seaveyon/harness-switch-shared';
import { useState } from 'react';
import { ProfileDialog } from '@/components/profile-dialog';
import { Alert } from '@/components/ui/alert';
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
import { Button } from '@/components/ui/button';
import { Disclosure } from '@/components/ui/disclosure';
import { useTranslation } from '@/lib/i18n';
import { errorLine, lineText } from '@/lib/messages';
import { useAppStore } from '@/stores/app-store';
import type { FavoriteListItem } from '@/stores/slices/model-favorites';

type Reference = FavoriteListItem['references'][number];

export function FavoriteManagement({
  favorite,
  onApply,
}: {
  favorite: FavoriteListItem;
  onApply(items: FavoritePlanRequest['items']): void;
}) {
  const { t } = useTranslation();
  const harnesses = useAppStore((state) => state.harnesses);
  const detach = useAppStore((state) => state.detachFavorite);
  const remove = useAppStore((state) => state.deleteFavorite);
  const [viewing, setViewing] = useState<Reference | null>(null);
  const [confirm, setConfirm] = useState<Reference | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const viewingHarness = harnesses.find((item) => item.id === viewing?.harness);
  const viewingProfile = viewingHarness?.profiles.find((item) => item.name === viewing?.name);
  const apply = async () => {
    if (!confirm) {
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (confirm === 'delete') {
        await remove(favorite);
      } else {
        await detach(confirm.harness, confirm.name);
        setNotice(t('favorites.management.detached', confirm));
      }
      setConfirm(null);
    } catch (cause) {
      setError(lineText(t, errorLine(cause)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Disclosure
        title={t('workspace.manageLinks')}
        triggerClassName="h-auto max-w-full whitespace-normal text-left"
      >
        <div className="space-y-3">
          {notice ? (
            <p role="status" className="text-sm">
              {notice}
            </p>
          ) : null}
          {favorite.references.map((ref) => {
            const harness = harnesses.find((item) => item.id === ref.harness);
            const profile = harness?.profiles.find((item) => item.name === ref.name);
            const active = !harness?.active?.official && harness?.active?.name === ref.name;
            const connection = favorite.connections.find(
              (item) => item.id === profile?.modelFavorite?.connectionId,
            );
            return (
              <div
                key={ref.harness + '/' + ref.name}
                className="flex flex-wrap items-center justify-between gap-3 border-b py-3"
              >
                <div className="min-w-0 flex-1 basis-48">
                  <p className="break-all text-sm">
                    {ref.harness} / {ref.name} {ref.needsUpdate ? t('favorites.needsUpdate') : ''}{' '}
                    {ref.diverged ? t('favorites.diverged') : ''}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {active ? t('workspace.inUse') : t('workspace.saved')}
                    {ref.connectionMissing ? ' · ' + t('favorites.connectionMissing') : ''}
                  </p>
                  {!profile ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('favorites.management.missingProfile')}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {ref.needsUpdate && connection ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        onApply([
                          {
                            harness: ref.harness,
                            profile: ref.name,
                            connectionId: connection.id,
                            existing: true,
                            mode: 'save',
                            ignorePreference: false,
                            overwriteDiverged: false,
                          },
                        ])
                      }
                    >
                      {t('favorites.onboarding.reviewUpdates', { count: 1 })}
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || !profile}
                    onClick={() => setViewing(ref)}
                  >
                    {t('favorites.management.view')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setError('');
                      setConfirm(ref);
                    }}
                  >
                    {t('favorites.detach')}
                  </Button>
                </div>
              </div>
            );
          })}
          <p id="favorite-delete-hint" className="text-sm leading-relaxed text-muted-foreground">
            {t(
              favorite.references.length
                ? 'favorites.management.deleteBlocked'
                : 'favorites.management.noReferences',
              { count: favorite.references.length },
            )}
          </p>
          <Button
            variant="ghost"
            className="text-destructive"
            disabled={busy || !!favorite.references.length}
            aria-describedby="favorite-delete-hint"
            onClick={() => {
              setError('');
              setConfirm('delete');
            }}
          >
            {t('favorites.delete')}
          </Button>
        </div>
      </Disclosure>
      {viewingHarness && viewingProfile ? (
        <ProfileDialog
          key={viewingHarness.id + '/' + viewingProfile.name}
          harness={viewingHarness}
          profile={viewingProfile}
          onOpenChange={(open) => {
            if (!open) {
              setViewing(null);
            }
          }}
        />
      ) : null}
      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setConfirm(null);
          }
        }}
      >
        <AlertDialogContent className="max-h-[90dvh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(
                confirm === 'delete'
                  ? 'favorites.management.deleteTitle'
                  : 'favorites.management.detachTitle',
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'delete'
                ? t('favorites.management.deleteHint', { name: favorite.name })
                : confirm
                  ? t('favorites.management.detachHint', confirm)
                  : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error ? <Alert>{error}</Alert> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t('favorites.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || (confirm === 'delete' && !!favorite.references.length)}
              onClick={(event) => {
                event.preventDefault();
                void apply();
              }}
            >
              {t(confirm === 'delete' ? 'favorites.delete' : 'favorites.detach')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
