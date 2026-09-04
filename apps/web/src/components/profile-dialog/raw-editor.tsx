import type { PreviewTarget } from '@seaveyon/harness-switch-shared';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useTranslation } from '@/lib/i18n';

export function RawEditor({
  targets,
  overrides,
  onEdit,
  onReset,
}: {
  targets: PreviewTarget[] | null;
  overrides: Record<string, string>;
  onEdit: (key: string, content: string) => void;
  onReset: (key: string) => void;
}) {
  const { t } = useTranslation();
  if (targets === null) {
    return <p className="text-sm text-muted-foreground">{t('profile.rawLoading')}</p>;
  }
  return (
    <>
      <p className="text-xs text-muted-foreground">{t('profile.rawIntro')}</p>
      {targets.map((target) => {
        const taken = overrides[target.key] !== undefined;
        return (
          <div key={target.key} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor={`raw-${target.key}`} className="font-mono text-xs">
                {target.path}
              </Label>
              {taken ? (
                <Button type="button" size="sm" variant="ghost" onClick={() => onReset(target.key)}>
                  <RotateCcw />
                  {t('profile.resetToGenerated')}
                </Button>
              ) : null}
            </div>
            <Textarea
              id={`raw-${target.key}`}
              rows={10}
              spellCheck={false}
              className="font-mono text-xs"
              value={overrides[target.key] ?? target.content}
              onChange={(event) => onEdit(target.key, event.target.value)}
            />
          </div>
        );
      })}
    </>
  );
}
