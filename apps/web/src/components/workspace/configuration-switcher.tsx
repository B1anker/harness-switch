import type { HarnessSummary, ProfilePublic } from '@seaveyon/harness-switch-shared';
import { Check, Plus, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ActivateDialog } from '@/components/activate-dialog';
import { ModelFavoriteApplyDialog } from '@/components/model-favorite-apply-dialog';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CreatableCombobox } from '@/components/ui/creatable-combobox';
import { useTranslation } from '@/lib/i18n';
import { lineText } from '@/lib/messages';
import { useAppStore } from '@/stores/app-store';

export function ConfigurationSwitcher({
  harness,
  onNewProfile,
  onOpenTemplate,
}: {
  harness: HarnessSummary;
  onNewProfile(): void;
  onOpenTemplate(id: string): void;
}) {
  const { t } = useTranslation();
  const favorites = useAppStore((state) => state.favorites);
  const loading = useAppStore((state) => state.favoritesLoading);
  const error = useAppStore((state) => state.favoritesError);
  const load = useAppStore((state) => state.loadFavorites);
  const loadProviders = useAppStore((state) => state.loadProviders);
  const [templateId, setTemplateId] = useState('');
  const [activating, setActivating] = useState<ProfilePublic | null>(null);
  useEffect(() => {
    void load();
    void loadProviders();
  }, [load, loadProviders]);
  const template = favorites?.find((entry) => entry.id === templateId);
  const profiles = harness.profiles.filter(
    (profile) => profile.name !== harness.official?.linkedProfileName,
  );
  return (
    <section className="workspace-surface space-y-6 p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="workspace-eyebrow">{t('workspace.switcherEyebrow')}</p>
          <h3 className="mt-2 text-xl font-semibold">
            {t('workspace.switcherTitle', { name: harness.label })}
          </h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            {t('workspace.switcherHint')}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onNewProfile}>
            <Plus />
            {t('workspace.newConfiguration')}
          </Button>
          <CreatableCombobox
            id="switcher-template"
            aria-invalid={undefined}
            aria-describedby={undefined}
            value=""
            options={(favorites ?? []).map((entry) => entry.id)}
            getLabel={(id) => favorites?.find((entry) => entry.id === id)?.name ?? id}
            onChange={setTemplateId}
            placeholder={t('workspace.chooseTemplate')}
            searchLabel={t('favorites.search')}
            emptyHint={t(loading ? 'favorites.loading' : 'workspace.noTemplates')}
            trigger={
              <Button variant="outline" size="sm">
                <Sparkles />
                {t('workspace.newFromTemplate')}
              </Button>
            }
          />
        </div>
      </div>
      {error ? <Alert>{lineText(t, error)}</Alert> : null}
      <div className="space-y-3">
        {profiles.length ? (
          profiles.map((profile) => {
            const active = !harness.active?.official && harness.active?.name === profile.name;
            const linkedTemplate = favorites?.find(
              (entry) => entry.id === profile.modelFavorite?.favoriteId,
            );
            return (
              <div
                key={profile.name}
                className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card px-4 py-3"
              >
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {profile.name}
                    {linkedTemplate ? (
                      <button
                        type="button"
                        className="rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-ring"
                        onClick={() => onOpenTemplate(linkedTemplate.id)}
                      >
                        {t('templates.tag')}
                      </button>
                    ) : null}
                    {active ? <Check className="size-4 text-primary" /> : null}
                  </span>
                  <span className="mt-1 block break-all font-mono text-xs text-muted-foreground">
                    {profile.model || t('harness.currentInactive')}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant={active ? 'secondary' : 'outline'}
                  disabled={active}
                  onClick={() => setActivating(profile)}
                >
                  {active ? t('workspace.activeNow') : t('workspace.useConfiguration')}
                </Button>
              </div>
            );
          })
        ) : (
          <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
            {t('workspace.noProfiles')}
          </div>
        )}
      </div>
      {template ? (
        <ModelFavoriteApplyDialog
          key={template.id}
          favorite={template}
          quickHarness={harness}
          initialMode="activate"
          initialPreview
          onClose={() => setTemplateId('')}
        />
      ) : null}
      {activating ? (
        <ActivateDialog
          harness={harness}
          profile={activating}
          open
          onOpenChange={(open) => {
            if (!open) {
              setActivating(null);
            }
          }}
        />
      ) : null}
    </section>
  );
}
