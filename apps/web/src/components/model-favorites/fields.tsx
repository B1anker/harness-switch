import { favoriteEffortSchema, type ModelFacts } from '@seaveyon/harness-switch-shared';
import { Checkbox } from '@/components/ui/checkbox';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTranslation } from '@/lib/i18n';

export function FavoriteSelect({
  id,
  label,
  value,
  options,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange(value: string): void;
  placeholder?: string;
}) {
  return (
    <FormField id={id} label={label}>
      {(control) => (
        <Select value={value || undefined} onValueChange={onChange}>
          <SelectTrigger {...control}>
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </FormField>
  );
}

export function FavoriteFacts({
  id,
  facts,
  effort: preferredEffort,
  onFacts,
  onEffort,
}: {
  id: string;
  facts: ModelFacts;
  effort?: string;
  onFacts(value: ModelFacts): void;
  onEffort(value: string): void;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {(['contextWindow', 'maxOutputTokens'] as const).map((field) => (
        <FormField
          key={field}
          id={`${id}-${field}`}
          label={t(`favorites.${field}`)}
          hint={t('favorites.declared')}
        >
          {(control) => (
            <Input
              {...control}
              type="number"
              min={1}
              max={100000000}
              value={facts[field] ?? ''}
              onChange={(event) =>
                onFacts({
                  ...facts,
                  [field]: event.target.value ? Number(event.target.value) : undefined,
                })
              }
            />
          )}
        </FormField>
      ))}
      <FavoriteSelect
        id={`${id}-reasoning`}
        label={t('favorites.reasoningSupported')}
        value={
          facts.reasoningSupported === undefined ? 'unknown' : String(facts.reasoningSupported)
        }
        options={['unknown', 'true', 'false'].map((value) => ({
          value,
          label: t(`favorites.${value}`),
        }))}
        onChange={(value) =>
          onFacts({
            ...facts,
            reasoningSupported: value === 'unknown' ? undefined : value === 'true',
          })
        }
      />
      <FavoriteSelect
        id={`${id}-effort`}
        label={t('favorites.reasoningEffort')}
        value={preferredEffort || 'unknown'}
        options={['unknown', ...favoriteEffortSchema.options].map((value) => ({
          value,
          label: value === 'unknown' ? t('favorites.unknown') : value,
        }))}
        onChange={(value) => onEffort(value === 'unknown' ? '' : value)}
      />
      <fieldset className="space-y-2 sm:col-span-2">
        <legend>{t('favorites.supportedReasoningEfforts')}</legend>
        <div className="flex flex-wrap gap-3">
          {favoriteEffortSchema.options.map((effort) => (
            <label key={effort} className="flex items-center gap-1">
              <Checkbox
                checked={facts.supportedReasoningEfforts?.includes(effort) ?? false}
                onCheckedChange={(checked) => {
                  const values = checked
                    ? [...(facts.supportedReasoningEfforts ?? []), effort]
                    : facts.supportedReasoningEfforts?.filter((value) => value !== effort);
                  onFacts({
                    ...facts,
                    supportedReasoningEfforts: values?.length ? values : undefined,
                  });
                }}
              />
              {effort}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
