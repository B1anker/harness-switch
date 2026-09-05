import {
  ERROR_CODES,
  type FavoritePlan,
  type FavoritePlanRequest,
  HARNESS_IDS,
  type ModelFavorite,
} from '@seaveyon/harness-switch-shared';
import type { Dispatch, SetStateAction } from 'react';
import { HarnessIcon } from '@/components/harness-icon';
import { FavoriteSelect } from '@/components/model-favorites/fields';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Disclosure } from '@/components/ui/disclosure';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/app-store';
import type { FavoriteSlice } from '@/stores/slices/model-favorites';
export function ToolSelection({
  favorite,
  items,
  setItems,
  mode,
  plan,
  targets,
  clear,
  change,
}: {
  favorite: ModelFavorite;
  items: FavoritePlanRequest['items'];
  setItems: Dispatch<SetStateAction<FavoritePlanRequest['items']>>;
  mode: 'save' | 'activate';
  plan: FavoritePlan | null;
  targets: FavoriteSlice['favoriteTargets'][string] | undefined;
  clear(): void;
  change(
    harness: (typeof HARNESS_IDS)[number],
    patch: Partial<FavoritePlanRequest['items'][number]>,
  ): void;
}) {
  const { t } = useTranslation();
  const harnesses = useAppStore((state) => state.harnesses);
  return (
    <div className="space-y-3">
      {' '}
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
            ?.profiles.filter((profile) => profile.modelFavorite?.favoriteId === favorite.id) ?? [];
        return (
          <section
            key={harness}
            className={cn(
              'overflow-hidden rounded-xl border transition-colors',
              item ? 'border-primary/40 bg-primary/[0.035] shadow-sm' : 'bg-card',
              !connections.length && 'bg-muted/35',
            )}
          >
            <div className="flex items-center gap-3 p-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-background">
                <HarnessIcon id={harness} className="size-6" />
              </span>
              <div className="min-w-0 flex-1">
                <label htmlFor={`target-${harness}`} className="block cursor-pointer font-semibold">
                  {harnesses.find((entry) => entry.id === harness)?.label ||
                    t(`favorites.toolNames.${harness}`)}
                </label>
                <p className="mt-1 text-xs text-muted-foreground">
                  {!targets
                    ? t('favorites.loading')
                    : !connections.length
                      ? t('favorites.noCompatibleChannel')
                      : connections.length === 1
                        ? `${connections[0]!.label} · ${connections[0]!.requestModelId}`
                        : t('favorites.compatibleCount', { count: connections.length })}
                </p>
              </div>
              {item ? <Badge variant="secondary">{t('favorites.selected')}</Badge> : null}
              <Checkbox
                aria-label={
                  harnesses.find((entry) => entry.id === harness)?.label ||
                  t(`favorites.toolNames.${harness}`)
                }
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
            </div>
            {item ? (
              <div className="space-y-3 border-t border-primary/10 px-4 py-3">
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
                ) : null}
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
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
