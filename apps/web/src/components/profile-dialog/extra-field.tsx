import type { FieldSpec } from '@seaveyon/harness-switch-shared';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useTranslation } from '@/lib/i18n';
import { fieldText, lineText, type MessageLine, placeholderText } from '@/lib/messages';

/** One control described entirely by the adapter's `FieldSpec`. */
export function ExtraField({
  field,
  value,
  error,
  onChange,
}: {
  field: FieldSpec;
  value: string;
  error?: MessageLine;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const label = fieldText(t, field.labelCode, field.params);
  const placeholder = placeholderText(t, field);
  return (
    <FormField
      id={`extra-${field.key}`}
      label={label}
      error={error ? lineText(t, error) : undefined}
      hint={field.helpCode ? fieldText(t, field.helpCode, field.params) : undefined}
      className={field.kind === 'textarea' || field.fullWidth ? 'sm:col-span-2' : undefined}
    >
      {(control) =>
        field.kind === 'select' ? (
          <Select value={value} onValueChange={onChange}>
            <SelectTrigger {...control} aria-label={label}>
              <SelectValue placeholder={placeholder ?? t('profile.selectPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {field.options?.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.labelCode ? t(option.labelCode) : option.value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : field.kind === 'textarea' ? (
          <Textarea
            {...control}
            rows={3}
            value={value}
            placeholder={placeholder}
            className="font-mono text-xs"
            onChange={(event) => onChange(event.target.value)}
          />
        ) : (
          <Input
            {...control}
            type={field.kind === 'password' ? 'password' : 'text'}
            value={value}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
          />
        )
      }
    </FormField>
  );
}
