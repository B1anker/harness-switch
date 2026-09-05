import type { HarnessSummary, ProfilePublic } from '@seaveyon/harness-switch-shared';
import { Plus, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { HarnessCard } from '@/components/harness-card';
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
  onEditProfile,
  onCopyProfile,
}: {
  harness: HarnessSummary;
  onNewProfile(): void;
  onOpenTemplate(id: string): void;
  onEditProfile(profile: ProfilePublic): void;
  onCopyProfile(profile: ProfilePublic): void;
}) {
  const { t } = useTranslation();
  const favorites = useAppStore((state) => state.favorites);
  const loading = useAppStore((state) => state.favoritesLoading);
  const error = useAppStore((state) => state.favoritesError);
  const load = useAppStore((state) => state.loadFavorites);
  const loadProviders = useAppStore((state) => state.loadProviders);
  const [templateId, setTemplateId] = useState('');
  useEffect(() => {
    void load();
    void loadProviders();
  }, [load, loadProviders]);
  const template = favorites?.find((entry) => entry.id === templateId);
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
      <HarnessCard
        harness={harness}
        onAdd={onNewProfile}
        onEdit={onEditProfile}
        onCopy={onCopyProfile}
        onOpenTemplate={onOpenTemplate}
        switching
      />
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
    </section>
  );
}
