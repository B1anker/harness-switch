import type { HarnessSummary } from '@seaveyon/harness-switch-shared';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';
import { PRESETS, type Preset } from '@/lib/presets';

export function PresetRow({
  harnessId,
  onPick,
}: {
  harnessId: HarnessSummary['id'];
  onPick: (preset: Preset) => void;
}) {
  const { t } = useTranslation();
  const presets = PRESETS[harnessId] ?? [];
  if (presets.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">{t('profile.quickFill')}</span>
      {presets.map((preset) => (
        <Button
          key={preset.id}
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onPick(preset)}
        >
          {t(`preset.${preset.id}`)}
        </Button>
      ))}
    </div>
  );
}
