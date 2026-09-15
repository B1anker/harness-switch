import type { HarnessSummary, ProfilePublic } from '@seaveyon/harness-switch-shared';
import { Lightbulb, Plus, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { HarnessCard } from '@/components/harness-card';
import { ModelFavoriteApplyDialog } from '@/components/model-favorite-apply-dialog';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CreatableCombobox } from '@/components/ui/creatable-combobox';
import { useTranslation } from '@/lib/i18n';
import { lineText } from '@/lib/messages';
import { useAppStore } from '@/stores/app-store';

/**
 * How many of a tool's configurations sit on the same provider. Templates exist to fold
 * exactly this duplication away, so this is what earns the suggestion to make one — a
 * user with one configuration has no duplication to fold.
 */
export function sharedProviderCount(profiles: ProfilePublic[]): number {
  const groups = new Map<string, number>();
  for (const profile of profiles) {
    if (profile.modelFavorite) {
      // Already fed by a template; nothing left to fold.
      continue;
    }
    const key = profile.providerId || profile.baseUrl;
    if (key) {
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
  }
  let shared = 0;
  for (const count of groups.values()) {
    if (count > 1) {
      shared += count;
    }
  }
  return shared;
}

export function ConfigurationSwitcher({
  harness,
  onNewProfile,
  onOpenTemplate,
  onManageTemplates,
  onCreateTemplate,
  onEditProfile,
  onCopyProfile,
}: {
  harness: HarnessSummary;
  onNewProfile(): void;
  onOpenTemplate(id: string): void;
  onManageTemplates(): void;
  onCreateTemplate(): void;
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
  // Templates stay out of sight until the user has one, or has the duplication that
  // wants one. Before that, the page is configurations and a switch, nothing more.
  const hasTemplates = (favorites?.length ?? 0) > 0;
  const shared = favorites !== null && !hasTemplates ? sharedProviderCount(harness.profiles) : 0;
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
          {hasTemplates ? (
            <>
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
              <Button variant="ghost" size="sm" onClick={onManageTemplates}>
                {t('workspace.manageTemplates')}
              </Button>
            </>
          ) : null}
        </div>
      </div>
      {error ? <Alert>{lineText(t, error)}</Alert> : null}
      {shared > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/20 bg-primary/[0.04] px-4 py-3 text-sm">
          <Lightbulb className="size-4 shrink-0 text-primary" />
          <p className="min-w-0 flex-1 leading-relaxed">
            {t('workspace.sharedProviderHint', { count: shared })}
          </p>
          <Button size="sm" variant="outline" onClick={onCreateTemplate}>
            <Sparkles />
            {t('favorites.add')}
          </Button>
        </div>
      ) : null}
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
