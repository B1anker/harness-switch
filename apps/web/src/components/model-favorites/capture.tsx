import type { HarnessId } from '@seaveyon/harness-switch-shared';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useTranslation } from '@/lib/i18n';
import { errorLine, lineText } from '@/lib/messages';
import { useAppStore } from '@/stores/app-store';
import { FavoriteSelect } from './fields';
export function CaptureFavorite({
  onClose,
  initialSource,
}: {
  onClose(): void;
  initialSource?: { harness: HarnessId; name: string };
}) {
  const { t } = useTranslation();
  const capture = useAppStore((state) => state.captureFavorite);
  const harnesses = useAppStore((state) => state.harnesses);
  const [source, setSource] = useState(() =>
    initialSource ? JSON.stringify([initialSource.harness, initialSource.name]) : '',
  );
  const [name, setName] = useState(initialSource?.name ?? '');
  const [credential, setCredential] = useState(false);
  const [linkSource, setLinkSource] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(lineText(t, errorLine(cause)));
    } finally {
      setBusy(false);
    }
  };
  const sources = harnesses.flatMap((harness) =>
    harness.profiles
      .filter(
        (profile) =>
          !profile.modelFavorite &&
          !profile.overriddenTargets.length &&
          profile.name !== harness.official?.linkedProfileName,
      )
      .map((profile) => ({
        harness: harness.id,
        profile,
        value: JSON.stringify([harness.id, profile.name]),
      })),
  );
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b p-6">
          <DialogTitle>{t('favorites.capture')}</DialogTitle>
          <DialogDescription>{t('workspace.captureHint')}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto p-6">
          <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
            <FavoriteSelect
              id="favorite-source"
              label={t('favorites.capture')}
              value={source}
              options={sources.map((item) => ({
                value: item.value,
                label: `${item.harness} / ${item.profile.name}`,
              }))}
              onChange={(value) => {
                setSource(value);
                const item = sources.find((candidate) => candidate.value === value);
                setName(item?.profile.name ?? '');
              }}
            />
            <FormField id="capture-name" label={t('favorites.name')}>
              {(control) => (
                <Input
                  {...control}
                  maxLength={120}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              )}
            </FormField>
            {source && !sources.find((item) => item.value === source)?.profile.providerId ? (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="capture-credential"
                  checked={credential}
                  onCheckedChange={(value) => setCredential(value === true)}
                />
                <label htmlFor="capture-credential">{t('favorites.extractCredential')}</label>
              </div>
            ) : null}
            <div className="flex items-center gap-2">
              <Checkbox
                id="capture-link"
                checked={linkSource}
                onCheckedChange={(value) => setLinkSource(value === true)}
              />
              <label htmlFor="capture-link">{t('favorites.linkSource')}</label>
            </div>
            <Button
              disabled={busy || !source || !name}
              onClick={() =>
                void run(async () => {
                  const item = sources.find((candidate) => candidate.value === source);
                  if (item) {
                    await capture(item.harness, item.profile.name, name, credential, linkSource);
                    onClose();
                  }
                })
              }
            >
              {t('favorites.capture')}
            </Button>
          </fieldset>
          {error ? (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
