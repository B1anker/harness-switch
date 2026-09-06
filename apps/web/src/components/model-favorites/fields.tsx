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
import { formatTokens } from '@/lib/format-tokens';
import { useTranslation } from '@/lib/i18n';
import { SUGGESTED_FACTS } from './suggested-defaults';

export function FavoriteSelect({
  id,
  label,
  value,
  options,
  onChange,
  placeholder,
  hint,
  error,
  className,
}: {
  id: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string; description?: string }>;
  onChange(value: string): void;
  placeholder?: string;
  hint?: string;
  error?: string;
  /** Extra classes on the trigger, e.g. a width cap. */
  className?: string;
}) {
  return (
    <FormField id={id} label={label} hint={hint} error={error}>
      {(control) => (
        <Select value={value || undefined} onValueChange={onChange}>
          <SelectTrigger {...control} className={className}>
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.description ? (
                  <span className="flex flex-col">
                    <span>{option.label}</span>
                    <span className="font-mono text-muted-foreground text-xs">
                      {option.description}
                    </span>
                  </span>
                ) : (
                  option.label
                )}
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
  errors = {},
}: {
  id: string;
  facts: ModelFacts;
  effort?: string;
  onFacts(value: ModelFacts): void;
  onEffort(value: string): void;
  /** Field-level validation messages, keyed by `FormField` id. */
  errors?: Record<string, string>;
}) {
  const { t } = useTranslation();
  const declared = facts.supportedReasoningEfforts;
  const allowed = declared?.length ? (declared as readonly string[]) : null;
  // A stored preference outside the declared list stays selectable rather than being silently dropped.
  const effortOptions = ['unknown', ...favoriteEffortSchema.options].filter(
    (value) =>
      value === 'unknown' || !allowed || allowed.includes(value) || value === preferredEffort,
  );
  const reasoningOff = facts.reasoningSupported === false;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {(['contextWindow', 'maxOutputTokens'] as const).map((field) => (
        <FormField
          key={field}
          id={`${id}-${field}`}
          label={t(`favorites.${field}`)}
          hint={t('favorites.declared')}
          error={errors[`${id}-${field}`]}
        >
          {(control) => (
            <Input
              {...control}
              type="number"
              min={1}
              max={100000000}
              className="max-w-36"
              value={facts[field] ?? ''}
              placeholder={
                facts[field] === undefined
                  ? t('favorites.suggestedValue', { value: formatTokens(SUGGESTED_FACTS[field]) })
                  : undefined
              }
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
        error={errors[`${id}-reasoning`]}
        className="max-w-xs"
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
      {reasoningOff ? null : (
        <FavoriteSelect
          id={`${id}-effort`}
          label={t('favorites.reasoningEffort')}
          error={errors[`${id}-effort`]}
          className="max-w-xs"
          value={preferredEffort || 'unknown'}
          options={effortOptions.map((value) => ({
            value,
            label: value === 'unknown' ? t('favorites.unknown') : value,
          }))}
          onChange={(value) => onEffort(value === 'unknown' ? '' : value)}
        />
      )}
      {reasoningOff ? null : (
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
          {errors[`${id}-supportedReasoningEfforts`] ? (
            <p className="text-destructive text-xs">{errors[`${id}-supportedReasoningEfforts`]}</p>
          ) : null}
        </fieldset>
      )}
    </div>
  );
}
