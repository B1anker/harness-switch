import type { FavoriteConnection, FavoriteInput } from '@seaveyon/harness-switch-shared';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Disclosure } from '@/components/ui/disclosure';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useTranslation } from '@/lib/i18n';
import { ReasoningOverrides } from './reasoning-overrides';
export function ChannelOverrides({
  favorite,
  connection,
  onChange,
}: {
  favorite: FavoriteInput;
  connection: FavoriteConnection;
  onChange(patch: Partial<FavoriteConnection>): void;
}) {
  const { t } = useTranslation();
  const hasOverrides = Object.values({
    ...connection.factOverrides,
    ...connection.preferenceOverrides,
  }).some((value) => value !== undefined);
  const [editing, setEditing] = useState(hasOverrides);
  return (
    <div className="rounded-xl border bg-muted/15 p-3">
      <p className="px-3 text-xs text-muted-foreground">
        {t(hasOverrides ? 'favorites.channelCustomized' : 'favorites.channelFollowing')}
      </p>
      <Disclosure title={t('favorites.channelAdvanced')}>
        <p className="text-sm leading-6 text-muted-foreground">
          {t('favorites.channelSettingsHint')}
        </p>
        <label className="flex items-center gap-2 text-sm font-medium">
          <Checkbox
            checked={editing}
            onCheckedChange={(checked) => {
              setEditing(checked === true);
              if (!checked) {
                onChange({ factOverrides: {}, preferenceOverrides: {} });
              }
            }}
          />
          {t('favorites.channelCustomize')}
        </label>
        {editing ? (
          <div className="space-y-5 border-t pt-4">
            <p className="text-xs text-muted-foreground">{t('favorites.channelResetHint')}</p>
            {(['contextWindow', 'maxOutputTokens'] as const).map((field) => (
              <FormField
                key={field}
                id={`${connection.id}-${field}`}
                label={t(`favorites.${field}`)}
                hint={t(`favorites.${field}Help`)}
              >
                {(control) => (
                  <div className="flex gap-2">
                    <Input
                      {...control}
                      type="number"
                      min={1}
                      max={100000000}
                      placeholder={
                        connection.factOverrides[field] === null
                          ? t('favorites.channelUnset')
                          : t('favorites.channelDefault', {
                              value: favorite.defaults[field] ?? t('favorites.channelUnspecified'),
                            })
                      }
                      value={connection.factOverrides[field] ?? ''}
                      onChange={(event) =>
                        onChange({
                          factOverrides: {
                            ...connection.factOverrides,
                            [field]: event.target.value ? Number(event.target.value) : null,
                          },
                        })
                      }
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={connection.factOverrides[field] === undefined}
                      onClick={() => {
                        const next = { ...connection.factOverrides };
                        delete next[field];
                        onChange({ factOverrides: next });
                      }}
                    >
                      {t('favorites.channelFollow')}
                    </Button>
                  </div>
                )}
              </FormField>
            ))}
            <ReasoningOverrides
              favorite={favorite}
              connection={connection}
              onChange={(patch) => onChange(patch)}
            />
          </div>
        ) : null}
      </Disclosure>
    </div>
  );
}
