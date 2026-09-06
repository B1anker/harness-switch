import {
  type FavoriteConnection,
  type FavoriteInput,
  favoriteEffortSchema,
} from '@seaveyon/harness-switch-shared';
import { Checkbox } from '@/components/ui/checkbox';
import { useTranslation } from '@/lib/i18n';
import { FavoriteSelect } from './fields';

const overrideMode = (input: unknown) =>
  input === undefined ? 'inherit' : input === null ? 'unknown' : String(input);

export function ReasoningOverrides({
  favorite,
  connection,
  onChange,
}: {
  favorite: FavoriteInput;
  connection: FavoriteConnection;
  onChange(patch: Partial<FavoriteConnection>): void;
}) {
  const { t } = useTranslation();
  const overrides = connection.factOverrides;
  const efforts = overrides.supportedReasoningEfforts;
  const options = [
    { value: 'inherit', label: t('favorites.inherit') },
    { value: 'unknown', label: t('favorites.unknown') },
  ];
  return (
    <div className="space-y-3">
      <FavoriteSelect
        id={`${connection.id}-reasoning-override`}
        label={`${t('favorites.reasoningSupported')} (${t('favorites.inherited')}: ${favorite.defaults.reasoningSupported === undefined ? t('favorites.unknown') : t(`favorites.${favorite.defaults.reasoningSupported}`)})`}
        value={overrideMode(overrides.reasoningSupported)}
        options={[
          ...options,
          ...['true', 'false'].map((entry) => ({ value: entry, label: t(`favorites.${entry}`) })),
        ]}
        onChange={(entry) =>
          onChange({
            factOverrides: {
              ...overrides,
              reasoningSupported:
                entry === 'inherit' ? undefined : entry === 'unknown' ? null : entry === 'true',
            },
          })
        }
      />
      <FavoriteSelect
        id={`${connection.id}-preference-override`}
        label={`${t('favorites.reasoningEffort')} (${t('favorites.inherited')}: ${favorite.preferences.reasoningEffort ?? t('favorites.unknown')})`}
        value={overrideMode(connection.preferenceOverrides.reasoningEffort)}
        options={[
          ...options,
          ...favoriteEffortSchema.options.map((entry) => ({ value: entry, label: entry })),
        ]}
        onChange={(entry) =>
          onChange({
            preferenceOverrides: {
              reasoningEffort:
                entry === 'inherit'
                  ? undefined
                  : entry === 'unknown'
                    ? null
                    : favoriteEffortSchema.parse(entry),
            },
          })
        }
      />
      <FavoriteSelect
        id={`${connection.id}-efforts-mode`}
        label={`${t('favorites.supportedReasoningEfforts')} (${t('favorites.inherited')}: ${favorite.defaults.supportedReasoningEfforts?.join(', ') ?? t('favorites.unknown')})`}
        value={efforts === undefined ? 'inherit' : efforts === null ? 'unknown' : 'override'}
        options={[...options, { value: 'override', label: t('favorites.overridden') }]}
        onChange={(entry) =>
          onChange({
            factOverrides: {
              ...overrides,
              supportedReasoningEfforts:
                entry === 'inherit' ? undefined : entry === 'unknown' ? null : [],
            },
          })
        }
      />
      {Array.isArray(efforts) ? (
        <div className="flex flex-wrap gap-3">
          {favoriteEffortSchema.options.map((effort) => (
            <label key={effort} className="flex items-center gap-1">
              <Checkbox
                checked={efforts.includes(effort)}
                onCheckedChange={(checked) =>
                  onChange({
                    factOverrides: {
                      ...overrides,
                      supportedReasoningEfforts: checked
                        ? [...efforts, effort]
                        : efforts.filter((value) => value !== effort),
                    },
                  })
                }
              />
              {effort}
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
