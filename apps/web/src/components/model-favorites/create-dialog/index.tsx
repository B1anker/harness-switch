import {
  type FavoriteConnection,
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
import { useTranslation } from '@/lib/i18n';
import { errorLine, lineText } from '@/lib/messages';
import { useAppStore } from '@/stores/app-store';
import { DiscardDraftDialog } from '../discard-draft-dialog';
import { matchPresetConnections } from '../preset-connections';

import { PresetProviderForm } from './provider-form';

type Step =
  | { kind: 'choice' }
  | { kind: 'preset' }
  | { kind: 'account'; preset: ProviderPreset }
  | { kind: 'provider'; preset: ProviderPreset };

export function FavoriteCreateDialog({
  onClose,
  onCapture,
  onBlank,
  onPreset,
}: {
  onClose(): void;
  onCapture(): void;
  onBlank(): void;
  onPreset(
    preset: ProviderPreset,
    provider: ProviderPublic,
    endpointKey: string,
    protocol: FavoriteConnection['protocol'],
  ): void;
}) {
  const { t } = useTranslation();
  const providers = useAppStore((state) => state.providers) ?? [];
  const createProvider = useAppStore((state) => state.createProvider);
  const [step, setStep] = useState<Step>({ kind: 'choice' });
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [endpointKey, setEndpointKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardAction, setDiscardAction] = useState<'back' | 'close'>('close');
  const leave = (action: 'back' | 'close') => {
    setApiKey('');
    if (action === 'back') {
      setStep({ kind: 'preset' });
    } else {
      onClose();
    }
  };
  const requestLeave = (action: 'back' | 'close') => {
    if (busy) {
      return;
    }
    if (
      step.kind === 'provider' &&
      (apiKey || name !== t(step.preset.nameKey) || endpointKey !== step.preset.endpoints[0]!.key)
    ) {
      setDiscardAction(action);
      setDiscardOpen(true);
    } else {
      leave(action);
    }
  };
  const startProvider = (preset: ProviderPreset) => {
    setName(t(preset.nameKey));
    setApiKey('');
    setEndpointKey(preset.endpoints[0]!.key);
    setError('');
    setStep({ kind: 'provider', preset });
  };
  const choosePreset = (preset: ProviderPreset) => {
    const matches = matchPresetConnections(providers, preset);
    if (matches.length === 1) {
      const match = matches[0]!;
      onPreset(preset, match.provider, match.endpointKey, match.protocol);
    } else if (matches.length > 1) {
      setStep({ kind: 'account', preset });
    } else {
      startProvider(preset);
    }
  };
  const createInline = async (preset: ProviderPreset) => {
    const endpoint = preset.endpoints.find((candidate) => candidate.key === endpointKey);
    if (!endpoint) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      const provider = await createProvider({
        name: name.trim(),
        apiKey: apiKey.trim(),
        endpoints: [{ key: endpoint.key, baseUrl: endpoint.baseUrl }],
      });
      setApiKey('');
      onPreset(preset, provider, endpoint.key, endpoint.protocol);
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
    <>
      <Dialog open onOpenChange={(open) => !open && requestLeave('close')}>
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {step.kind === 'choice'
                ? t('favorites.createChoice.title')
                : step.kind === 'preset'
                  ? t('favorites.presets.title')
                  : step.kind === 'account'
                    ? t('favorites.presets.chooseAccount')
                    : t('favorites.presets.createProvider')}
            </DialogTitle>
            <DialogDescription>
              {t(
                step.kind === 'provider'
                  ? 'favorites.presets.providerHint'
                  : step.kind === 'account'
                    ? 'favorites.presets.accountHint'
                    : 'favorites.createChoice.description',
              )}
            </DialogDescription>
          </DialogHeader>
          {step.kind === 'choice' ? (
            <div className="grid gap-3">
              {choices.map((choice) => (
                <Button
                  key={choice.label}
                  variant="outline"
                  className="h-auto items-start justify-start gap-3 whitespace-normal rounded-xl px-4 py-4 text-left"
                  onClick={choice.action}
                >
                  {choice.icon}
                  <span>
                    <span className="block font-medium">{choice.label}</span>
                    <span className="mt-1 block text-muted-foreground text-xs">{choice.hint}</span>
                  </span>
                </Button>
              ))}
            </div>
          ) : null}
          {step.kind === 'preset' ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {PROVIDER_PRESETS.map((preset) => (
                <Button
                  key={preset.id}
                  variant="outline"
                  className="h-auto justify-start rounded-xl px-4 py-3 text-left"
                  onClick={() => choosePreset(preset)}
                >
                  {t(preset.nameKey)}
                </Button>
              ))}
              <Button variant="ghost" onClick={() => setStep({ kind: 'choice' })}>
                {t('favorites.presets.back')}
              </Button>
            </div>
          ) : null}
          {step.kind === 'account' ? (
            <div className="grid gap-3">
              {matchPresetConnections(providers, step.preset).map((match) => {
                const endpoint = match.provider.endpoints.find(
                  (item) => item.key === match.endpointKey,
                )!;
                return (
                  <Button
                    key={match.provider.id + '/' + match.endpointKey}
                    variant="outline"
                    className="h-auto justify-start whitespace-normal py-3 text-left"
                    onClick={() =>
                      onPreset(step.preset, match.provider, match.endpointKey, match.protocol)
                    }
                  >
                    <span className="min-w-0">
                      <span className="block">
                        {match.provider.name} · {endpoint.label || endpoint.key}
                      </span>
                      <span className="mt-1 block break-all text-xs text-muted-foreground">
                        {endpoint.baseUrl}
                      </span>
                    </span>
                  </Button>
                );
              })}
              <Button variant="outline" onClick={() => startProvider(step.preset)}>
                {t('favorites.presets.newAccount')}
              </Button>
              <Button variant="ghost" onClick={() => setStep({ kind: 'preset' })}>
                {t('favorites.presets.back')}
              </Button>
            </div>
          ) : null}
          {step.kind === 'provider' ? (
            <PresetProviderForm
              preset={step.preset}
              name={name}
              setName={setName}
              apiKey={apiKey}
              setApiKey={setApiKey}
              endpointKey={endpointKey}
              setEndpointKey={setEndpointKey}
              busy={busy}
              error={error}
              onBack={() => requestLeave('back')}
              onCreate={() => void createInline(step.preset)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <DiscardDraftDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        onDiscard={() => leave(discardAction)}
      />
    </>
  );
}
