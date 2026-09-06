import type { ProfilePublic } from '@seaveyon/harness-switch-shared';

export function configuredModel(
  profile: ProfilePublic | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
  model = profile?.model,
): string {
  if (model?.trim()) {
    return model;
  }
  const models =
    profile?.harness === 'claude'
      ? [
          ...new Set(
            ['sonnetModel', 'opusModel', 'fableModel', 'haikuModel', 'subagentModel']
              .map((key) => profile.extras[key]?.trim())
              .filter(Boolean),
          ),
        ]
      : [];
  return models.length ? t('workspace.mappedModels') : t('workspace.toolDefaultModel');
}
