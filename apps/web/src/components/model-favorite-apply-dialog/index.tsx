import {
  catalogKey,
  ERROR_CODES,
  type FavoritePlanRequest,
  HARNESS_IDS,
  type ModelFavorite,
} from '@seaveyon/harness-switch-shared';
import { useEffect, useState } from 'react';
import { FavoriteSelect } from '@/components/model-favorites/fields';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Disclosure } from '@/components/ui/disclosure';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useTranslation } from '@/lib/i18n';
import { errorLine, lineText } from '@/lib/messages';
import { useAppStore } from '@/stores/app-store';
import { FavoritePreview } from './preview';

export function ModelFavoriteApplyDialog({
  favorite,
  onClose,
}: {
  favorite: ModelFavorite;
  onClose(): void;
}) {
  const { t } = useTranslation();
  const plan = useAppStore((state) => state.favoritePlan);
  const operation = useAppStore((state) => state.favoriteOperation);
  const history = useAppStore((state) => state.favoriteOperationHistory);
  const [previousRequests] = useState(() => new Set(history.map((entry) => entry.requestId)));
  const makePlan = useAppStore((state) => state.planFavorite);
  const apply = useAppStore((state) => state.applyFavorite);
  const clear = useAppStore((state) => state.clearFavoritePlan);
  const harnesses = useAppStore((state) => state.harnesses);
  const targets = useAppStore((state) => state.favoriteTargets[favorite.id]);
  const loadTargets = useAppStore((state) => state.loadFavoriteTargets);
  const [items, setItems] = useState<FavoritePlanRequest['items']>([]);
  const [mode, setMode] = useState<'save' | 'activate'>('save');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    void loadTargets(favorite.id).catch((cause) => setError(lineText(t, errorLine(cause))));
  }, [favorite.id, loadTargets, t]);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
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
  const change = (
    harness: (typeof HARNESS_IDS)[number],
    patch: Partial<FavoritePlanRequest['items'][number]>,
  ) => {
    clear();
    setItems(items.map((item) => (item.harness === harness ? { ...item, ...patch } : item)));
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          clear();
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('favorites.configure')}</DialogTitle>
          <DialogDescription>{t('favorites.saveOnlyHint')}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Checkbox
            id="favorite-activate"
            checked={mode === 'activate'}
            onCheckedChange={(checked) => {
              const next = checked === true ? 'activate' : 'save';
              setMode(next);
              clear();
              setItems(items.map((item) => ({ ...item, mode: next })));
            }}
          />
          <label htmlFor="favorite-activate">{t('favorites.activateSelected')}</label>
        </div>
        {HARNESS_IDS.map((harness) => {
          const connections = favorite.connections.filter((connection) =>
            targets
              ?.find((target) => target.harness === harness)
              ?.connections.some(
                (entry) => entry.id === connection.id && entry.projection.blockers.length === 0,
              ),
          );
          const item = items.find((entry) => entry.harness === harness);
          const linked =
            harnesses
              .find((entry) => entry.id === harness)
              ?.profiles.filter((profile) => profile.modelFavorite?.favoriteId === favorite.id) ??
            [];
          return (
            <fieldset key={harness} className="space-y-3 rounded-xl border p-3">
              <legend className="flex items-center gap-2">
                <Checkbox
                  id={`target-${harness}`}
                  checked={!!item}
                  disabled={!connections.length}
                  onCheckedChange={(checked) => {
                    clear();
                    setItems(
                      checked
                        ? [
                            ...items,
                            {
                              harness,
                              connectionId:
                                linked.length === 1 &&
                                connections.some(
                                  (connection) =>
                                    connection.id === linked[0]!.modelFavorite!.connectionId,
                                )
                                  ? linked[0]!.modelFavorite!.connectionId
                                  : connections.length === 1
                                    ? connections[0]!.id
                                    : '',
                              existing: linked.length === 1,
                              profile: linked.length === 1 ? linked[0]!.name : undefined,
                              mode,
                              ignorePreference: false,
                              overwriteDiverged: false,
                            },
                          ]
                        : items.filter((entry) => entry.harness !== harness),
                    );
                  }}
                />
                <label htmlFor={`target-${harness}`}>{harness}</label>
              </legend>
              {!connections.length ? (
                <p className="text-sm text-muted-foreground">
                  {t('favorites.noCompatibleChannel')}
                </p>
              ) : null}
              {item ? (
                <>
                  {connections.length > 1 ? (
                    <FavoriteSelect
                      id={`connection-${harness}`}
                      label={t('favorites.connection')}
                      value={item.connectionId}
                      options={connections.map((connection) => ({
                        value: connection.id,
                        label: `${connection.label} · ${connection.protocol} · ${connection.requestModelId}`,
                      }))}
                      onChange={(connectionId) => change(harness, { connectionId })}
                    />
                  ) : (
                    <p className="text-sm">
                      {connections[0]?.label} · {connections[0]?.requestModelId}
                    </p>
                  )}
                  <p className="text-sm text-muted-foreground">
                    {t(item.existing ? 'favorites.updateProfile' : 'favorites.newProfile')}:{' '}
                    {item.profile || favorite.name}
                  </p>
                  <Disclosure title={t('favorites.targetAdvanced')}>
                    <FavoriteSelect
                      id={`existing-${harness}`}
                      label={t('favorites.target')}
                      value={item.existing ? item.profile! : '__new__'}
                      options={[
                        { value: '__new__', label: t('favorites.newProfile') },
                        ...linked.map((profile) => ({ value: profile.name, label: profile.name })),
                      ]}
                      onChange={(value) =>
                        change(harness, {
                          existing: value !== '__new__',
                          profile: value === '__new__' ? undefined : value,
                        })
                      }
                    />
                    {!item.existing ? (
                      <FormField id={`profile-${harness}`} label={t('favorites.profileName')}>
                        {(control) => (
                          <Input
                            {...control}
                            value={item.profile ?? ''}
                            placeholder={favorite.name}
                            onChange={(event) =>
                              change(harness, { profile: event.target.value || undefined })
                            }
                          />
                        )}
                      </FormField>
                    ) : null}
                  </Disclosure>
                  {(['ignorePreference', 'overwriteDiverged'] as const)
                    .filter((field) => {
                      const projection = targets
                        ?.find((target) => target.harness === harness)
                        ?.connections.find(
                          (connection) => connection.id === item.connectionId,
                        )?.projection;
                      return field === 'ignorePreference'
                        ? projection?.notRepresented.includes('reasoningEffort')
                        : item.overwriteDiverged ||
                            plan?.items.some(
                              (entry) =>
                                entry.harness === harness &&
                                entry.projection.blockers.some(
                                  (blocker) => blocker.code === ERROR_CODES.favoriteProfileDiverged,
                                ),
                            );
                    })
                    .map((field) => (
                      <div key={field} className="flex items-center gap-2">
                        <Checkbox
                          id={`${field}-${harness}`}
                          checked={item[field]}
                          onCheckedChange={(value) => change(harness, { [field]: value === true })}
                        />
                        <label htmlFor={`${field}-${harness}`}>{t(`favorites.${field}`)}</label>
                      </div>
                    ))}
                  {item.mode === 'activate' &&
                  linked.some(
                    (profile) =>
                      profile.name === item.profile && profile.extras.authMode === 'openai_auth',
                  ) ? (
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id={`auth-overwrite-${harness}`}
                        checked={item.allowAuthOverwrite === true}
                        onCheckedChange={(value) =>
                          change(harness, { allowAuthOverwrite: value === true })
                        }
                      />
                      <label htmlFor={`auth-overwrite-${harness}`}>
                        {t('favorites.allowAuthOverwrite')}
                      </label>
                    </div>
                  ) : null}
                </>
              ) : null}
            </fieldset>
          );
        })}
        <Button
          disabled={busy || !items.length || items.some((item) => !item.connectionId)}
          onClick={() =>
            void run(async () => {
              setRequestId(crypto.randomUUID());
              await makePlan({
                favoriteId: favorite.id,
                expectedRevision: favorite.revision,
                items,
              });
            })
          }
        >
          {t('favorites.preview')}
        </Button>
        {plan?.items.map((item) => (
          <FavoritePreview key={item.harness} item={item} />
        ))}
        {plan ? (
          <Button
            disabled={
              busy || !!operation || plan.items.some((item) => item.projection.blockers.length > 0)
            }
            onClick={() => void run(() => apply(requestId))}
          >
            {t('favorites.confirm')}
          </Button>
        ) : null}
        {operation?.items.some((item) => item.status === 'failed' || item.status === 'skipped') ? (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const remaining = items.filter((item) =>
                  operation.items.some(
                    (result) =>
                      result.harness === item.harness &&
                      (result.status === 'failed' || result.status === 'skipped'),
                  ),
                );
                setItems(remaining);
                setRequestId(crypto.randomUUID());
                await makePlan({
                  favoriteId: favorite.id,
                  expectedRevision: favorite.revision,
                  items: remaining,
                });
              })
            }
          >
            {t('favorites.retryFailed')}
          </Button>
        ) : null}
        {history
          .filter((entry) => !previousRequests.has(entry.requestId))
          .flatMap((entry) =>
            entry.items.map((item) => (
              <p key={`${entry.requestId}/${item.harness}`} role="status">
                {item.harness} / {item.profile}: {t(`favorites.${item.status}`)}{' '}
                {item.code ? t(catalogKey(item.code)) : ''}
              </p>
            )),
          )}
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
