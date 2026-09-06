import {
  PROVIDER_PRESETS,
  type ProviderPreset,
  type ProviderPublic,
} from '@seaveyon/harness-switch-shared';
import { ArrowDownToLine, PencilLine, Zap } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useTranslation } from '@/lib/i18n';
import { errorLine, lineText } from '@/lib/messages';
import { useAppStore } from '@/stores/app-store';

type Step = { kind: 'choice' } | { kind: 'preset' } | { kind: 'provider'; preset: ProviderPreset };

/** Matches a preset to a vault entry by endpoint base URL; names are user-editable. */
function matchProvider(providers: ProviderPublic[], preset: ProviderPreset) {
  for (const provider of providers) {
    const endpoint = provider.endpoints.find((candidate) =>
      preset.endpoints.some((presetEndpoint) => presetEndpoint.baseUrl === candidate.baseUrl),
    );
    if (endpoint) {
      return { provider, endpointKey: endpoint.key };
    }
  }
  return undefined;
}

export function FavoriteCreateDialog({
  onClose,
  onCapture,
  onBlank,
  onPreset,
}: {
  onClose(): void;
  onCapture(): void;
  onBlank(): void;
  onPreset(preset: ProviderPreset, provider: ProviderPublic, endpointKey: string): void;
}) {
  const { t } = useTranslation();
  const providers = useAppStore((state) => state.providers) ?? [];
  const createProvider = useAppStore((state) => state.createProvider);
  const [step, setStep] = useState<Step>({ kind: 'choice' });
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const choosePreset = (preset: ProviderPreset) => {
    const match = matchProvider(providers, preset);
    if (match) {
      onPreset(preset, match.provider, match.endpointKey);
    } else {
      setName(t(preset.nameKey));
      setApiKey('');
      setError('');
      setStep({ kind: 'provider', preset });
    }
  };
  const createInline = async (preset: ProviderPreset) => {
    setBusy(true);
    setError('');
    try {
      const endpoint = preset.endpoints[0]!;
      const provider = await createProvider({
        name,
        apiKey,
        endpoints: [{ key: endpoint.key, baseUrl: endpoint.baseUrl }],
      });
      onPreset(preset, provider, endpoint.key);
    } catch (cause) {
      setError(lineText(t, errorLine(cause)));
    } finally {
      setBusy(false);
    }
  };
  const choices = [
    {
      icon: <Zap className="size-5 text-primary" />,
      label: t('favorites.createChoice.preset'),
      hint: t('favorites.createChoice.presetHint'),
      action: () => setStep({ kind: 'preset' }),
    },
    {
      icon: <ArrowDownToLine className="size-5 text-primary" />,
      label: t('favorites.capture'),
      hint: t('favorites.createChoice.captureHint'),
      action: onCapture,
    },
    {
      icon: <PencilLine className="size-5 text-primary" />,
      label: t('favorites.createChoice.blank'),
      hint: t('favorites.createChoice.blankHint'),
      action: onBlank,
    },
  ];
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {step.kind === 'choice'
              ? t('favorites.createChoice.title')
              : step.kind === 'preset'
                ? t('favorites.presets.title')
                : t('favorites.presets.createProvider')}
          </DialogTitle>
          {step.kind === 'provider' ? (
            <DialogDescription>{t('favorites.presets.providerHint')}</DialogDescription>
          ) : null}
        </DialogHeader>
        {step.kind === 'choice' ? (
          <div className="grid gap-3">
            {choices.map((choice) => (
              <button
                key={choice.label}
                type="button"
                className="flex items-start gap-3 rounded-xl border px-4 py-4 text-left transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-ring"
                onClick={choice.action}
              >
                {choice.icon}
                <span>
                  <span className="block font-medium">{choice.label}</span>
                  <span className="mt-1 block text-muted-foreground text-xs">{choice.hint}</span>
                </span>
              </button>
            ))}
          </div>
        ) : null}
        {step.kind === 'preset' ? (
          <div className="grid max-h-[50dvh] gap-2 overflow-y-auto sm:grid-cols-2">
            {PROVIDER_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="rounded-xl border px-4 py-3 text-left font-medium transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() => choosePreset(preset)}
              >
                {t(preset.nameKey)}
              </button>
            ))}
            <Button variant="ghost" onClick={() => setStep({ kind: 'choice' })}>
              {t('favorites.presets.back')}
            </Button>
          </div>
        ) : null}
        {step.kind === 'provider' ? (
          <fieldset disabled={busy} className="grid gap-4">
            <FormField id="preset-provider-name" label={t('vault.name')}>
              {(control) => (
                <Input
                  {...control}
                  maxLength={120}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              )}
            </FormField>
            <FormField id="preset-provider-key" label={t('vault.apiKey')}>
              {(control) => (
                <Input
                  {...control}
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                />
              )}
            </FormField>
            <p className="break-all text-muted-foreground text-xs">
              {t('favorites.presets.baseUrl')}: {step.preset.endpoints[0]!.baseUrl}
            </p>
            {error ? (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            ) : null}
            <div className="flex justify-between gap-2">
              <Button variant="ghost" onClick={() => setStep({ kind: 'preset' })}>
                {t('favorites.presets.back')}
              </Button>
              <Button
                disabled={busy || !name.trim() || !apiKey.trim()}
                onClick={() => void createInline(step.preset)}
              >
                {t('favorites.presets.createProvider')}
              </Button>
            </div>
          </fieldset>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
