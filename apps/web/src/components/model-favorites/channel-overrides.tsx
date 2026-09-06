import type { FavoriteConnection, FavoriteInput } from '@seaveyon/harness-switch-shared';
import { Button } from '@/components/ui/button';
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
  return (
    <Disclosure title={t('favorites.channelAdvanced')}>
      {(['contextWindow', 'maxOutputTokens'] as const).map((field) => (
        <FormField
          key={field}
          id={`${connection.id}-${field}`}
          label={t(`favorites.${field}`)}
          hint={
            connection.factOverrides[field] === undefined
              ? `${t('favorites.inherited')}: ${favorite.defaults[field] ?? t('favorites.unknown')}`
              : t('favorites.overridden')
          }
        >
          {(control) => (
            <div className="flex gap-2">
              <Input
                {...control}
                type="number"
                min={1}
                max={100000000}
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
                variant="outline"
                onClick={() => {
                  const next = { ...connection.factOverrides };
                  delete next[field];
                  onChange({ factOverrides: next });
                }}
              >
                {t('favorites.inherit')}
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
    </Disclosure>
  );
}
