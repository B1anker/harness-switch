import type { HarnessSummary, ModelFavorite, ProfilePublic } from '@seaveyon/harness-switch-shared';

export function profileDisplayName(
  profile: ProfilePublic | undefined,
  favorites: ModelFavorite[] | null | undefined,
): string | undefined {
  return profile?.modelFavorite?.collectionOverrides
    ? (favorites?.find((entry) => entry.id === profile.modelFavorite!.favoriteId)?.name ??
        profile.name)
    : profile?.name;
}

export type ProfileGroup = {
  id: string;
  favoriteId?: string;
  profiles: ProfilePublic[];
  selected: ProfilePublic;
};

export function profileGroups(harness: HarnessSummary): ProfileGroup[] {
  const groups = new Map<string, ProfileGroup>();
  for (const profile of harness.profiles) {
    const favoriteId =
      (harness.id === 'kimi' || harness.id === 'dsh') && profile.modelFavorite?.collectionOverrides
        ? profile.modelFavorite.favoriteId
        : undefined;
    const id = favoriteId ? `collection/${favoriteId}` : `profile/${profile.name}`;
    const group = groups.get(id) ?? { id, favoriteId, profiles: [], selected: profile };
    group.profiles.push(profile);
    if (!harness.active?.official && harness.active?.name === profile.name) {
      group.selected = profile;
    }
    groups.set(id, group);
  }
  return [...groups.values()];
}
