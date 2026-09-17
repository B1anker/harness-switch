import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useTranslation } from '@/lib/i18n';

export type ApplyMode = 'save' | 'activate';

/**
 * The save-or-switch choice every tool pane opens with, so a template reads the same way
 * whether the tool takes one profile or a whole model collection.
 */
export function ModeRadio({
  value,
  onChange,
  disabled,
}: {
  value: ApplyMode;
  onChange(value: ApplyMode): void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <RadioGroup
      aria-label={t('favorites.mode')}
      value={value}
      disabled={disabled}
      onValueChange={(next) => onChange(next === 'activate' ? 'activate' : 'save')}
    >
      {(['save', 'activate'] as const).map((option) => (
        <label key={option} className="flex items-center gap-2 text-sm">
          <RadioGroupItem value={option} />
          {t(`favorites.modeLabel.${option}`)}
        </label>
      ))}
    </RadioGroup>
  );
}
