import { createHmac, randomUUID } from 'node:crypto';
import {
  createFavoriteRequestSchema,
  ERROR_CODES,
  type FavoriteInput,
  HARNESS_IDS,
  type HarnessId,
  type ModelFavorite,
  type ModelFavoriteLink,
  type UpdateFavoriteRequest,
} from '@seaveyon/harness-switch-shared';
import { HttpError } from '../common/errors';
import { createDecorator, inject } from '../di';
import { IAdapterRegistry } from './adapters';
import { ILiveWriteService } from './live-write';
import { IModelFavoriteStore } from './model-favorite-store';
import { IProfileService } from './profiles';
import { IVaultService } from './vault';

export type FavoriteReference = { harness: HarnessId; name: string; link: ModelFavoriteLink };
export type FavoriteCapture = {
  harness: HarnessId;
  name: string;
  sourceFingerprint: string;
  favoriteName: string;
  extractCredential?: boolean;
  linkSource?: boolean;
};
export interface IModelFavoriteService {
  readonly _serviceBrand: undefined;
  list(): Array<ModelFavorite & { references: FavoriteReference[] }>;
  references(id: string): FavoriteReference[];
  create(input: FavoriteInput): ModelFavorite;
  update(id: string, input: UpdateFavoriteRequest): ModelFavorite;
  remove(id: string, revision: number | undefined): void;
  capture(input: FavoriteCapture): ModelFavorite;
  sourceFingerprint(harness: HarnessId, name: string): string;
  detach(harness: HarnessId, name: string, fingerprint: string): void;
}
export const IModelFavoriteService = createDecorator<IModelFavoriteService>('modelFavoriteService');

@inject(IModelFavoriteStore, IProfileService, IVaultService, IAdapterRegistry, ILiveWriteService)
export class ModelFavoriteService implements IModelFavoriteService {
  private readonly sourceSalt = randomUUID();
  declare readonly _serviceBrand: undefined;
  constructor(
    private readonly store: IModelFavoriteStore,
    private readonly profiles: IProfileService,
    private readonly vault: IVaultService,
    private readonly adapters: IAdapterRegistry,
    private readonly liveWrite: ILiveWriteService,
  ) {}

  list() {
    return this.store
      .list()
      .map((favorite) => ({ ...favorite, references: this.references(favorite.id) }));
  }

  references(id: string): FavoriteReference[] {
    return HARNESS_IDS.flatMap((harness) =>
      this.profiles
        .list(harness)
        .flatMap((profile) =>
          profile.modelFavorite?.favoriteId === id
            ? [{ harness, name: profile.name, link: profile.modelFavorite }]
            : [],
        ),
    );
  }

  create(input: FavoriteInput): ModelFavorite {
    const parsed = createFavoriteRequestSchema.parse(input);
    this.validateConnections(parsed);
    return this.store.create(parsed);
  }

  update(id: string, input: UpdateFavoriteRequest): ModelFavorite {
    this.store.assertRevision(id, input.expectedRevision);
    const current = this.store.get(id);
    const next = createFavoriteRequestSchema.parse({ ...current, ...input });
    this.validateConnections(next);
    if (
      this.references(id).some(
        (ref) => !next.connections.some((connection) => connection.id === ref.link.connectionId),
      )
    ) {
      throw new HttpError(409, ERROR_CODES.favoriteConnectionInUse, {
        code: ERROR_CODES.favoriteConnectionInUse,
      });
    }
    return this.store.update(id, next, input.expectedRevision);
  }

  remove(id: string, revision: number | undefined): void {
    this.store.assertRevision(id, revision);
    if (this.references(id).length) {
      throw new HttpError(409, ERROR_CODES.favoriteInUse, { code: ERROR_CODES.favoriteInUse });
    }
    this.store.remove(id, revision);
  }

  sourceFingerprint(harness: HarnessId, name: string): string {
    const profile = this.profiles.get(harness, name);
    if (!profile) {
      throw new HttpError(404, ERROR_CODES.profileNotFound, { code: ERROR_CODES.profileNotFound });
    }
    return createHmac('sha256', this.sourceSalt)
      .update(this.profiles.fingerprint(harness, name))
      .digest('hex');
  }

  capture(input: FavoriteCapture): ModelFavorite {
    if (this.sourceFingerprint(input.harness, input.name) !== input.sourceFingerprint) {
      throw new HttpError(409, ERROR_CODES.favoritePlanStale, {
        code: ERROR_CODES.favoritePlanStale,
      });
    }
    const source = this.profiles.get(input.harness, input.name)!;
    if (source.overriddenTargets.length || source.modelFavorite) {
      throw new HttpError(409, ERROR_CODES.favoriteRawOverrideConflict, {
        code: ERROR_CODES.favoriteRawOverrideConflict,
      });
    }
    const decrypted = this.profiles.decrypt(input.harness, input.name);
    const adapter = this.adapters.get(input.harness);
    const extracted = adapter.extractFavorite(decrypted);
    if (!source.providerId && !input.extractCredential) {
      throw new HttpError(409, ERROR_CODES.favoriteCredentialConsentRequired, {
        code: ERROR_CODES.favoriteCredentialConsentRequired,
      });
    }
    // All mutations are synchronous and journaled together; no native files are targets.
    return this.liveWrite.transaction(
      {
        kind: 'favorite-capture',
        harness: input.harness,
        profile: input.name,
        writes: [],
        metadata: ['profiles', 'vault', 'favorites'],
      },
      () => {
        const provider = source.providerId
          ? this.vault.get(source.providerId)
          : this.vault.create({
              name: input.favoriteName,
              apiKey: decrypted.apiKey,
              endpoints: [{ key: 'api', baseUrl: decrypted.baseUrl }],
            });
        const endpointKey =
          source.providerEndpoint ??
          provider.endpoints.find((endpoint) => endpoint.baseUrl === decrypted.baseUrl)?.key;
        if (!endpointKey) {
          throw new HttpError(409, ERROR_CODES.favoriteEndpointMissing, {
            code: ERROR_CODES.favoriteEndpointMissing,
          });
        }
        if (!source.providerId || !source.providerEndpoint) {
          this.profiles.upsert(
            input.harness,
            { name: input.name, providerId: provider.id, providerEndpoint: endpointKey },
            false,
          );
        }
        const favorite = this.create({
          name: input.favoriteName,
          notes: '',
          defaults: extracted.defaults,
          preferences: extracted.preferences,
          connections: [
            {
              id: randomUUID(),
              label: provider.name,
              providerId: provider.id,
              endpointKey,
              protocol: extracted.protocol,
              requestModelId: extracted.requestModelId,
              factOverrides: {},
              preferenceOverrides: {},
            },
          ],
        });
        if (input.linkSource) {
          const connection = favorite.connections[0]!;
          const projection = adapter.projectFavorite(favorite, connection);
          const current = this.profiles.get(input.harness, input.name)!;
          const baseline = {
            ...projection.projection,
            model: current.model,
            providerId: current.providerId ?? '',
            providerEndpoint: current.providerEndpoint ?? '',
            extras: Object.fromEntries(
              Object.keys(projection.projection.extras).map((key) => [
                key,
                current.extras[key] ?? null,
              ]),
            ),
          };
          this.profiles.setFavoriteLink(input.harness, input.name, {
            favoriteId: favorite.id,
            connectionId: connection.id,
            appliedRevision: favorite.revision,
            projectionVersion: projection.projectionVersion,
            baseline,
          });
        }
        return favorite;
      },
    );
  }

  detach(harness: HarnessId, name: string, fingerprint: string): void {
    if (this.sourceFingerprint(harness, name) !== fingerprint) {
      throw new HttpError(409, ERROR_CODES.favoritePlanStale, {
        code: ERROR_CODES.favoritePlanStale,
      });
    }
    this.profiles.setFavoriteLink(harness, name, undefined);
  }

  private validateConnections(input: FavoriteInput): void {
    for (const connection of input.connections) {
      const provider = this.vault.get(connection.providerId);
      if (!provider.endpoints.some((endpoint) => endpoint.key === connection.endpointKey)) {
        throw new HttpError(409, ERROR_CODES.favoriteEndpointMissing, {
          code: ERROR_CODES.favoriteEndpointMissing,
        });
      }
    }
  }
}
