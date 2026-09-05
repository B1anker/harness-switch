import type { ProbeResult } from '@seaveyon/harness-switch-shared';
import { Loader2, XCircle } from 'lucide-react';
import { ProbeResultLine } from '@/components/probe-result-line';
import { Button } from '@/components/ui/button';
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
  probeAction,
  result,
  probeError,
  onProbe,
}: {
  options: VaultProbeOption[];
  targetIndex: number;
  onTargetChange: (index: number) => void;
  hasStoredKey: boolean;
  hasTypedKey: boolean;
  onMissingKey: () => void;
  probing: boolean;
  probeAction: 'models' | 'completion' | null;
  result: ProbeResult | null;
  probeError?: MessageLine | null;
  onProbe: (completion: boolean) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  if (options.length === 0 && !hasStoredKey) {
    return null;
  }
  const selected = options.find((option) => option.index === targetIndex) ?? options[0];
  function triggerProbe(completion: boolean) {
    if (!hasTypedKey && !hasStoredKey) {
      onMissingKey();
      return;
    }
    void onProbe(completion);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-t pt-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={probing || (options.length === 0 && !hasTypedKey)}
        onClick={() => triggerProbe(false)}
      >
        {probing && probeAction === 'models' ? <Loader2 className="animate-spin" /> : null}
        {probing && probeAction === 'models' ? t('probe.probing') : t('probe.action')}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={probing || (options.length === 0 && !hasTypedKey)}
        onClick={() => triggerProbe(true)}
      >
        {probing && probeAction === 'completion' ? <Loader2 className="animate-spin" /> : null}
        {probing && probeAction === 'completion'
          ? t('probe.testingCompletion')
          : t('probe.completionAction')}
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
