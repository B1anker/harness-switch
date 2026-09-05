import type { FieldSpec } from '@seaveyon/harness-switch-shared';
import type { ReactNode } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { controlProps, FieldError, FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTranslation } from '@/lib/i18n';
import { fieldText, lineText, type MessageLine, placeholderText } from '@/lib/messages';
import type { ProfileFieldErrors } from './types';

/** `oneMKey` is null for tiers with no 1M variant, such as Haiku. */
export const CLAUDE_MODEL_ROWS = [
  { role: 'Sonnet', modelKey: 'sonnetModel', nameKey: 'sonnetModelName', oneMKey: 'sonnetModel1m' },
  { role: 'Opus', modelKey: 'opusModel', nameKey: 'opusModelName', oneMKey: 'opusModel1m' },
  { role: 'Fable', modelKey: 'fableModel', nameKey: 'fableModelName', oneMKey: 'fableModel1m' },
  { role: 'Haiku', modelKey: 'haikuModel', nameKey: 'haikuModelName', oneMKey: null },
] as const;

const CLAUDE_SUBAGENT_ROW = {
  modelKey: 'subagentModel',
  oneMKey: 'subagentModel1m',
} as const;

/** Keys the mapping grid renders itself, so they are dropped from the generic field list. */
export const CLAUDE_MODEL_FIELD_KEYS = new Set<string>([
  ...CLAUDE_MODEL_ROWS.flatMap(({ modelKey, nameKey, oneMKey }) =>
    oneMKey ? [modelKey, nameKey, oneMKey] : [modelKey, nameKey],
  ),
  CLAUDE_SUBAGENT_ROW.modelKey,
  CLAUDE_SUBAGENT_ROW.oneMKey,
]);

/** Shared column template so the header row and every mapping row stay aligned. */
const CLAUDE_MAPPING_COLUMNS = 'md:grid-cols-[6.5rem_minmax(0,1fr)_minmax(0,1fr)_8.5rem]';
/** A mapping row: a bordered card on narrow screens, a bare grid row from md up. */
const CLAUDE_MAPPING_ROW = `grid gap-2 rounded-lg border bg-card/70 p-3 ${CLAUDE_MAPPING_COLUMNS} md:items-start md:gap-3 md:border-0 md:bg-transparent md:p-0`;

export function ClaudeModelMappingFields({
  fields,
  values,
  errors,
  modelOptions,
  onChange,
  fetchAction,
}: {
  fetchAction?: ReactNode;
  fields: FieldSpec[];
  values: Record<string, string>;
  errors: ProfileFieldErrors;
  /** A successful catalog request makes model-id fields selectable rather than free text. */
  modelOptions: string[];
  onChange: (key: string, value: string) => void;
}) {
  const { t } = useTranslation();
  const fieldByKey = new Map(fields.map((field) => [field.key, field]));
  const subagentField = fieldByKey.get(CLAUDE_SUBAGENT_ROW.modelKey);

  return (
    <section
      data-slot="claude-model-mapping"
      className="space-y-4 rounded-xl border bg-muted/15 p-4 sm:col-span-2 sm:p-5"
    >
      <div className="space-y-1">
        <h3 className="text-base font-semibold">{t('profile.mapping.title')}</h3>
        <p className="text-sm text-muted-foreground">{t('profile.mapping.intro')}</p>
      </div>

      <div
        className={`grid items-center gap-3 px-1 text-xs font-medium text-muted-foreground ${CLAUDE_MAPPING_COLUMNS}`}
      >
        <span className="hidden md:block">{t('profile.mapping.role')}</span>
        <span className="hidden md:block">{t('profile.mapping.displayName')}</span>
        <span className="flex items-center justify-between gap-2">
          {t('profile.mapping.actualModel')}
          {fetchAction}
        </span>
        <span className="hidden md:block">{t('profile.mapping.oneM')}</span>
      </div>

      <div className="space-y-3">
        {CLAUDE_MODEL_ROWS.map(({ role, modelKey, nameKey, oneMKey }) => {
          const modelField = fieldByKey.get(modelKey);
          const nameField = fieldByKey.get(nameKey);
          if (!modelField || !nameField) {
            return null;
          }
          const modelError = errors[`extra:${modelKey}`];
          const nameError = errors[`extra:${nameKey}`];
          return (
            <div key={role} className={CLAUDE_MAPPING_ROW}>
              <div className="flex h-10 items-center rounded-lg border bg-muted/45 px-3 text-sm font-medium">
                {role}
                {modelField.required ? <span className="ml-1 text-destructive">*</span> : null}
              </div>
              <MappingCell
                field={nameField}
                value={values[nameKey] ?? ''}
                // A blank display name falls back to the model id, so say so rather than
                // showing a generic example the user would have to compare against.
                placeholder={
                  values[modelKey]?.trim()
                    ? t('profile.mapping.defaultTo', { model: values[modelKey].trim() })
                    : undefined
                }
                error={nameError}
                onChange={(value) => onChange(nameKey, value)}
              />
              <MappingCell
                field={modelField}
                value={values[modelKey] ?? ''}
                error={modelError}
                modelOptions={modelOptions}
                onChange={(value) => onChange(modelKey, value)}
              />
              <OneMCell
                role={role}
                field={oneMKey ? fieldByKey.get(oneMKey) : undefined}
                value={oneMKey ? values[oneMKey] : undefined}
                error={oneMKey ? errors[`extra:${oneMKey}`] : undefined}
                onChange={onChange}
              />
            </div>
          );
        })}

        {subagentField ? (
          <div className={CLAUDE_MAPPING_ROW}>
            <div className="flex h-10 items-center rounded-lg border bg-muted/45 px-3 text-sm font-medium">
              Subagent
            </div>
            <div className="flex h-10 items-center rounded-lg border bg-muted/30 px-3 text-sm text-muted-foreground">
              {t('profile.mapping.notInMenu')}
            </div>
            <MappingCell
              field={subagentField}
              value={values.subagentModel ?? ''}
              error={errors['extra:subagentModel']}
              modelOptions={modelOptions}
              onChange={(value) => onChange('subagentModel', value)}
            />
            <OneMCell
              role="Subagent"
              field={fieldByKey.get(CLAUDE_SUBAGENT_ROW.oneMKey)}
              value={values[CLAUDE_SUBAGENT_ROW.oneMKey]}
              error={errors[`extra:${CLAUDE_SUBAGENT_ROW.oneMKey}`]}
              onChange={onChange}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** One text cell of the grid: the label is a heading on a wide screen and a label on a narrow one. */
function MappingCell({
  field,
  value,
  placeholder,
  error,
  modelOptions = [],
  onChange,
}: {
  field: FieldSpec;
  value: string;
  placeholder?: string;
  error?: MessageLine;
  modelOptions?: string[];
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const options = value && !modelOptions.includes(value) ? [value, ...modelOptions] : modelOptions;
  const label = fieldText(t, field.labelCode, field.params);
  return (
    <FormField
      id={`extra-${field.key}`}
      label={label}
      labelClassName="text-xs md:sr-only"
      error={error ? lineText(t, error) : undefined}
      className="space-y-1.5"
    >
      {(control) =>
        modelOptions.length > 0 ? (
          <Select value={value} onValueChange={onChange}>
            <SelectTrigger {...control} aria-label={label}>
              <SelectValue placeholder={placeholder ?? placeholderText(t, field)} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            {...control}
            value={value}
            placeholder={placeholder ?? placeholderText(t, field)}
            onChange={(event) => onChange(event.target.value)}
          />
        )
      }
    </FormField>
  );
}

/**
 * The 1M column of a mapping row. A tier whose models have no 1M variant — Haiku — gets a
 * spelled-out placeholder instead of a control, so the empty cell reads as "unsupported"
 * rather than "we forgot to render something".
 *
 * The flag is a boolean to the user but a `'true'`/`'false'` string in `extras`, which is
 * what the adapter reads when deciding whether to append the `[1m]` suffix.
 */
export function OneMCell({
  role,
  field,
  value,
  error,
  onChange,
}: {
  role: string;
  /** Absent when the server described no 1M field for this tier. */
  field: FieldSpec | undefined;
  value: string | undefined;
  error?: MessageLine;
  onChange: (key: string, value: string) => void;
}) {
  const { t } = useTranslation();
  if (!field) {
    return (
      <div
        data-slot="one-m-unsupported"
        className="flex h-10 items-center rounded-lg border border-dashed bg-muted/20 px-3 text-sm text-muted-foreground"
      >
        {t('profile.mapping.oneMUnsupported', { role })}
      </div>
    );
  }
  const id = `extra-${field.key}`;
  const label = fieldText(t, field.labelCode, field.params);
  return (
    <div className="space-y-1.5">
      <div className="flex h-10 items-center">
        <label
          htmlFor={id}
          className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground"
        >
          <Checkbox
            {...controlProps(id, error)}
            checked={value === 'true'}
            aria-label={label}
            onCheckedChange={(checked) => onChange(field.key, checked === true ? 'true' : 'false')}
          />
          <span className="md:hidden">{label}</span>
          <span className="hidden md:inline">{t('profile.mapping.enable')}</span>
        </label>
      </div>
      <FieldError id={id}>{error ? lineText(t, error) : undefined}</FieldError>
    </div>
  );
}
