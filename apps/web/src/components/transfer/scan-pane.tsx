import type {
  ScanCandidate,
  ScanHarnessResult,
  ScanImportSelection,
} from '@seaveyon/harness-switch-shared';
import type { TFunction } from 'i18next';
import { CheckCircle2, FileSearch, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTranslation } from '@/lib/i18n';
import { errorLineWith, lineText, type MessageLine, messageLine } from '@/lib/messages';
import { useAppStore } from '@/stores/app-store';

/** Per-candidate choices, keyed by candidate id. */
type Choice = {
  selected: boolean;
  name: string;
  target: 'profile' | 'vault';
  /** Existing vault entry to link to, or '' to create a new one. */
  providerId: string;
  /** Only asked for when the tool keeps its credential outside any config file. */
  apiKey: string;
  overwrite: boolean;
};

type Summary = {
  imported: number;
  skipped: number;
  providersCreated: number;
  warnings: MessageLine[];
};

/**
 * Adopts configuration a user already set up by hand. The scan is read-only and the
 * import writes only to this manager's own store, so trying it out can never damage the
 * setup it is reading.
 *
 * Conflicts are decided per candidate, not by one global policy, because each row also
 * needs its own name and a choice of where the credential lands.
 */
export function ScanPane() {
  const { t } = useTranslation();
  const scan = useAppStore((state) => state.scan);
  const scanLoading = useAppStore((state) => state.scanLoading);
  const scanError = useAppStore((state) => state.scanError);
  const loadScan = useAppStore((state) => state.loadScan);
  const importScan = useAppStore((state) => state.importScan);
  const providers = useAppStore((state) => state.providers);
  const loadProviders = useAppStore((state) => state.loadProviders);

  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<MessageLine | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    void loadScan();
    void loadProviders();
  }, [loadScan, loadProviders]);

  // Seed one choice per candidate whenever a fresh scan arrives, keeping any edit the
  // user already made to a candidate that is still there.
  useEffect(() => {
    if (!scan) {
      return;
    }
    setChoices((previous) => {
      const next: Record<string, Choice> = {};
      for (const result of scan) {
        for (const candidate of result.candidates) {
          next[candidate.id] = previous[candidate.id] ?? {
            selected: false,
            name: candidate.suggestedName,
            // Reusing an entry that already holds this credential avoids a duplicate.
            target: candidate.matchesProvider ? 'vault' : 'profile',
            providerId: candidate.matchesProvider ?? '',
            apiKey: '',
            overwrite: false,
          };
        }
      }
      return next;
    });
  }, [scan]);

  const candidates = (scan ?? []).flatMap((result) => result.candidates);
  const chosen = candidates.filter((candidate) => choices[candidate.id]?.selected);
  const blocked = chosen.filter((candidate) => {
    const choice = choices[candidate.id]!;
    const needsKey = !candidate.apiKeyPresent && !choice.apiKey.trim();
    const linking = choice.target === 'vault' && choice.providerId !== '';
    return !choice.name.trim() || (needsKey && !linking);
  });

  function update(id: string, patch: Partial<Choice>): void {
    setChoices((previous) => ({ ...previous, [id]: { ...previous[id]!, ...patch } }));
  }

  async function submit(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      const selections: ScanImportSelection[] = chosen.map((candidate) => {
        const choice = choices[candidate.id]!;
        return {
          id: candidate.id,
          name: choice.name.trim(),
          target: choice.target,
          ...(choice.target === 'vault' && choice.providerId
            ? { providerId: choice.providerId }
            : {}),
          ...(choice.apiKey.trim() ? { apiKey: choice.apiKey.trim() } : {}),
          ...(choice.overwrite ? { overwrite: true } : {}),
        };
      });
      const result = await importScan(selections);
      setSummary({
        imported: result.imported,
        skipped: result.skipped,
        providersCreated: result.providersCreated,
        warnings: result.warnings.map(messageLine),
      });
      setChoices({});
    } catch (caught) {
      setError(errorLineWith(caught, 'import.failed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-muted-foreground">{t('import.intro')}</p>

      {scanLoading ? (
        <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t('import.scanning')}
        </p>
      ) : null}
      {scanError ? <p className="py-6 text-sm text-destructive">{lineText(t, scanError)}</p> : null}
      {summary ? (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 px-4 py-3 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="size-4 text-emerald-600" />
            {t('import.summary', {
              imported: summary.imported,
              skipped: summary.skipped,
              providersCreated: summary.providersCreated,
            })}
          </p>
          {summary.warnings.map((warning) => (
            <p key={warning.key + warning.scope} className="mt-1 text-xs text-muted-foreground">
              {lineText(t, warning)}
            </p>
          ))}
        </div>
      ) : null}

      {(scan ?? []).map((result) => (
        <section key={result.harness} className="rounded-2xl border bg-card px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">{result.label}</h3>
            {result.candidates.length > 0 ? (
              <Badge variant="secondary">
                {t('import.providerCount', { count: result.candidates.length })}
              </Badge>
            ) : null}
          </div>
          <ul className="mt-2 space-y-0.5">
            {result.sources.map((source) => (
              <li key={source.key} className="truncate font-mono text-[11px] text-muted-foreground">
                {source.path} ·{' '}
                {!source.exists
                  ? t('import.sourceMissing')
                  : source.parsable
                    ? t('import.sourceRead')
                    : t('import.sourceUnparsable')}
              </li>
            ))}
          </ul>
          {result.candidates.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">{noteText(t, result)}</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {result.candidates.map((candidate) => (
                <CandidateRow
                  key={candidate.id}
                  candidate={candidate}
                  choice={choices[candidate.id]}
                  providers={providers ?? []}
                  onChange={(patch) => update(candidate.id, patch)}
                />
              ))}
            </ul>
          )}
        </section>
      ))}

      {error ? <p className="text-sm text-destructive">{lineText(t, error)}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <span className="mr-auto text-xs text-muted-foreground">
          {chosen.length > 0
            ? t('import.selected', { count: chosen.length })
            : t('import.selectPrompt')}
        </span>
        <Button variant="outline" onClick={() => void loadScan()} disabled={scanLoading}>
          <FileSearch />
          {t('import.rescan')}
        </Button>
        <Button
          disabled={chosen.length === 0 || blocked.length > 0 || submitting}
          onClick={() => void submit()}
        >
          {submitting ? <Loader2 className="animate-spin" /> : null}
          {t('import.importSelected')}
        </Button>
      </div>
    </div>
  );
}

/**
 * The note explaining an empty candidate list. A server that predates the code contract
 * sends only prose, which `lineText` then renders as the fallback.
 */
function noteText(t: TFunction, result: ScanHarnessResult): string {
  if (!result.note && !result.noteCode) {
    return '';
  }
  return lineText(t, { key: result.noteCode ?? 'scan.note.unknown', fallback: result.note });
}

type CandidateRowProps = {
  candidate: ScanCandidate;
  choice: Choice | undefined;
  providers: Array<{ id: string; name: string }>;
  onChange: (patch: Partial<Choice>) => void;
};

function CandidateRow({ candidate, choice, providers, onChange }: CandidateRowProps) {
  const { t } = useTranslation();
  if (!choice) {
    return null;
  }
  const linking = choice.target === 'vault' && choice.providerId !== '';
  const needsKey = !candidate.apiKeyPresent && !linking;

  return (
    <li className="rounded-xl border bg-background px-3 py-3">
      <div className="flex items-start gap-3">
        <Checkbox
          className="mt-1"
          checked={choice.selected}
          onCheckedChange={(next) => onChange({ selected: next === true })}
          aria-label={t('import.select', { name: candidate.sourceKey })}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-mono text-sm">{candidate.sourceKey}</span>
            {candidate.active ? <Badge>{t('import.inUse')}</Badge> : null}
            {candidate.conflictsWith ? (
              <Badge variant="secondary">{t('import.nameTaken')}</Badge>
            ) : null}
            {candidate.matchesProvider ? (
              <Badge variant="secondary">
                {t('import.matchesProvider', { name: candidate.matchesProvider })}
              </Badge>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {candidate.baseUrl || t('import.noBaseUrl')}
            {candidate.model ? ` · ${candidate.model}` : ''}
            {candidate.apiKeyPresent
              ? ` · ${candidate.apiKeyPreview}`
              : ` · ${t('import.keyOutsideConfig')}`}
          </p>

          {choice.selected ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`name-${candidate.id}`}>{t('import.profileName')}</Label>
                <Input
                  id={`name-${candidate.id}`}
                  value={choice.name}
                  onChange={(event) => onChange({ name: event.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`target-${candidate.id}`}>{t('import.credentialTarget')}</Label>
                <Select
                  value={choice.target === 'vault' ? choice.providerId || 'new-vault' : 'profile'}
                  onValueChange={(value) =>
                    onChange(
                      value === 'profile'
                        ? { target: 'profile', providerId: '' }
                        : value === 'new-vault'
                          ? { target: 'vault', providerId: '' }
                          : { target: 'vault', providerId: value },
                    )
                  }
                >
                  <SelectTrigger id={`target-${candidate.id}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="profile">{t('import.targetProfile')}</SelectItem>
                    <SelectItem value="new-vault">{t('import.targetNewVault')}</SelectItem>
                    {providers.map((provider) => (
                      <SelectItem key={provider.id} value={provider.id}>
                        {t('import.targetExisting', { name: provider.name })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {needsKey ? (
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor={`key-${candidate.id}`}>{t('common.apiKey')}</Label>
                  <Input
                    id={`key-${candidate.id}`}
                    type="password"
                    value={choice.apiKey}
                    placeholder={t('import.apiKeyFromEnv')}
                    onChange={(event) => onChange({ apiKey: event.target.value })}
                  />
                </div>
              ) : null}
              {candidate.conflictsWith ? (
                <label className="flex items-center gap-2 text-xs text-muted-foreground sm:col-span-2">
                  <Checkbox
                    checked={choice.overwrite}
                    onCheckedChange={(next) => onChange({ overwrite: next === true })}
                  />
                  {t('import.overwriteExisting')}
                </label>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}
