import {
  type FavoriteConnection,
  PROVIDER_PRESETS,
  type ProviderPreset,
  type ProviderPublic,
} from '@seaveyon/harness-switch-shared';

const normalizedUrl = (url: string) => url.replace(/\/+$/, '');

export function presetProtocolForUrl(baseUrl: string): FavoriteConnection['protocol'] | undefined {
  return PROVIDER_PRESETS.flatMap((preset) => preset.endpoints).find(
    (endpoint) => normalizedUrl(endpoint.baseUrl) === normalizedUrl(baseUrl),
  )?.protocol;
}

/** Keep the chosen endpoint and its protocol together, including multiple saved accounts. */
export function matchPresetConnections(providers: ProviderPublic[], preset: ProviderPreset) {
  return providers.flatMap((provider) =>
    provider.endpoints.flatMap((endpoint) => {
      const match = preset.endpoints.find(
        (candidate) => normalizedUrl(candidate.baseUrl) === normalizedUrl(endpoint.baseUrl),
      );
      return match ? [{ provider, endpointKey: endpoint.key, protocol: match.protocol }] : [];
    }),
  );
}
