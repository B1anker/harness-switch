import type { ProbeResult } from '@seaveyon/harness-switch-shared';
import { Loader2, XCircle } from 'lucide-react';
import { ProbeResultLine } from '@/components/probe-result-line';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTranslation } from '@/lib/i18n';
import { lineText, type MessageLine } from '@/lib/messages';

/** Options for the vault probe row, one per drafted endpoint with a URL. */
type VaultProbeOption = {
  index: number;
  key: string;
  baseUrl: string;
};

/**
 * The vault editor's connectivity row: tests the credential (typed or stored)
 * against one of the drafted endpoint URLs. Presentational — all state and the
 * actual request live in {@link EntryForm}.
 */
export function VaultProbeRow({
  options,
  targetIndex,
  onTargetChange,
  hasStoredKey,
  hasTypedKey,
  onMissingKey,
  probing,
  result,
  probeError,
  completion,
  onCompletionChange,
  onProbe,
}: {
  options: VaultProbeOption[];
  targetIndex: number;
  onTargetChange: (index: number) => void;
  hasStoredKey: boolean;
  hasTypedKey: boolean;
  onMissingKey: () => void;
  probing: boolean;
  result: ProbeResult | null;
  probeError?: MessageLine | null;
  completion: boolean;
  onCompletionChange: (value: boolean) => void;
  onProbe: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  if (options.length === 0 && !hasStoredKey) {
    return null;
  }
  const selected = options.find((option) => option.index === targetIndex) ?? options[0];
  return (
    <div className="flex flex-wrap items-center gap-2 border-t pt-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={probing || (options.length === 0 && !hasTypedKey)}
        onClick={() => {
          if (!hasTypedKey && !hasStoredKey) {
            onMissingKey();
            return;
          }
          void onProbe();
        }}
      >
        {probing ? <Loader2 className="animate-spin" /> : null}
        {probing ? t('probe.probing') : t('probe.action')}
      </Button>
      {options.length > 1 ? (
        <Select
          value={String(selected?.index ?? '')}
          onValueChange={(value) => onTargetChange(Number(value))}
        >
          <SelectTrigger className="h-9 w-56" aria-label={t('vault.probeEndpointLabel')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.index} value={String(option.index)}>
                {option.key || option.baseUrl}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      <label
        htmlFor="vault-probe-completion"
        className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground"
      >
        <Checkbox
          id="vault-probe-completion"
          checked={completion}
          onCheckedChange={(checked) => onCompletionChange(checked === true)}
        />
        {t('probe.completionAction')}
      </label>
      {probeError ? (
        <span className="flex items-center gap-1.5 text-sm text-destructive">
          <XCircle className="size-4 shrink-0" aria-hidden />
          {lineText(t, probeError)}
        </span>
      ) : result ? (
        <ProbeResultLine result={result} />
      ) : null}
    </div>
  );
}
