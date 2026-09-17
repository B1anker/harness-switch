import { createHmac, randomUUID } from 'node:crypto';
import {
  connectionProtocols,
  createFavoriteRequestSchema,
  ERROR_CODES,
  FAVORITE_PROTOCOL_SUPPORT,
  type FavoriteConnection,
  type FavoriteInput,
  HARNESS_IDS,
  type HarnessId,
  type ModelFavorite,
  type ModelFavoriteLink,
  pickProtocolForHarness,
  syncConnectionProtocols,
  type UpdateFavoriteRequest,
} from '@seaveyon/harness-switch-shared';
import { HttpError } from '../common/errors';
import { createDecorator, inject } from '../di';
import { IAdapterRegistry } from './adapters';
import { IFavoriteBackupService } from './favorite-backup';
import { ILiveWriteService } from './live-write';
import { IModelFavoriteStore } from './model-favorite-store';
import { IProfileService } from './profiles';
import { IToolModelsService } from './tool-models';
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
  ignoreUpdates(id: string, revision: number): void;
}
export const IModelFavoriteService = createDecorator<IModelFavoriteService>('modelFavoriteService');

@inject(
  IModelFavoriteStore,
  IProfileService,
  IVaultService,
  IAdapterRegistry,
  ILiveWriteService,
  IFavoriteBackupService,
  IToolModelsService,
)
export class ModelFavoriteService implements IModelFavoriteService {
  private readonly sourceSalt = randomUUID();
  declare readonly _serviceBrand: undefined;
  constructor(
    private readonly store: IModelFavoriteStore,
    private readonly profiles: IProfileService,
    private readonly vault: IVaultService,
    private readonly adapters: IAdapterRegistry,
    private readonly liveWrite: ILiveWriteService,
    private readonly backups: IFavoriteBackupService,
    private readonly toolModels: IToolModelsService,
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
    return this.backups.protect('change', () => this.store.create(parsed), {
      action: 'create',
      name: parsed.name,
    });
  }

  update(id: string, input: UpdateFavoriteRequest): ModelFavorite {
    this.store.assertRevision(id, input.expectedRevision);
    const current = this.store.get(id);
    let next = createFavoriteRequestSchema.parse({ ...current, ...input });
    this.validateConnections(next);
    // Protocol copies (cpa / cpa · codex) collapse into one connection: absorb the
    // removed copy's protocols onto the survivor, then retarget linked profiles and
    // tool-models drafts. Accumulate across remaps so a later Chat absorb does not
    // wipe protocols collected for Responses.
    const remaps: Array<{ ref: FavoriteReference; connectionId: string }> = [];
    const absorbed = new Map<string, FavoriteConnection>();
    const absorbRemoved = (
      previous: {
        providerId: string;
        endpointKey: string;
        requestModelId: string;
        protocol?: FavoriteConnection['protocol'];
        protocols?: FavoriteConnection['protocols'];
      },
      harness?: HarnessId,
    ) => {
      const survivor = sameAccountModel(previous, next.connections);
      if (!survivor) {
        return undefined;
      }
      const base = absorbed.get(survivor.id) ?? survivor;
      const merged = {
        ...base,
        ...syncConnectionProtocols([
          ...connectionProtocols(base),
          ...connectionProtocols(previous),
          ...(harness && !pickProtocolForHarness(base, harness)
            ? [FAVORITE_PROTOCOL_SUPPORT[harness][0]!]
            : []),
        ]),
      };
      absorbed.set(merged.id, merged);
      return merged;
    };
    for (const ref of this.references(id)) {
      if (next.connections.some((connection) => connection.id === ref.link.connectionId)) {
        continue;
      }
      const previous = current.connections.find(
        (connection) => connection.id === ref.link.connectionId,
      );
      const target = previous ?? {
        providerId: ref.link.baseline.providerId,
        endpointKey: ref.link.baseline.providerEndpoint,
        requestModelId: ref.link.baseline.model,
        protocol: undefined,
        protocols: undefined,
      };
      const merged = absorbRemoved(target, ref.harness);
      if (!merged || !pickProtocolForHarness(merged, ref.harness)) {
        throw new HttpError(409, ERROR_CODES.favoriteConnectionInUse, {
          code: ERROR_CODES.favoriteConnectionInUse,
        });
      }
      remaps.push({ ref, connectionId: merged.id });
    }
    // Tool-models drafts may point at a removed copy with no profile link — still fold
    // that row onto the same-account survivor so previews do not see a missing endpoint.
    const connectionRemaps = new Map(
      remaps.map(({ ref, connectionId }) => [ref.link.connectionId, connectionId] as const),
    );
    for (const previous of current.connections) {
      if (next.connections.some((connection) => connection.id === previous.id)) {
        continue;
      }
      if (connectionRemaps.has(previous.id)) {
        continue;
      }
      const merged = absorbRemoved(previous);
      if (merged) {
        connectionRemaps.set(previous.id, merged.id);
      }
    }
    if (absorbed.size) {
      next = createFavoriteRequestSchema.parse({
        ...next,
        connections: next.connections.map(
          (connection) => absorbed.get(connection.id) ?? connection,
        ),
      });
      this.validateConnections(next);
      for (const { ref, connectionId } of remaps) {
        const connection = next.connections.find((entry) => entry.id === connectionId);
        if (!connection || !pickProtocolForHarness(connection, ref.harness)) {
          throw new HttpError(409, ERROR_CODES.favoriteConnectionInUse, {
            code: ERROR_CODES.favoriteConnectionInUse,
          });
        }
      }
    }
    // liveWrite snapshots favorites/profiles/toolModels and restores them if any step
    // fails — backups.protect alone only records a restore point, it does not roll back.
    return this.backups.protect(
      'change',
      () =>
        this.liveWrite.transaction(
          {
            kind: 'favorite-apply',
            harness: remaps[0]?.ref.harness ?? 'claude',
            profile: current.name,
            writes: [],
            metadata: connectionRemaps.size
              ? ['favorites', 'profiles', 'toolModels']
              : ['favorites'],
          },
          () => {
            const updated = this.store.update(id, next, input.expectedRevision);
            for (const { ref, connectionId } of remaps) {
              this.profiles.setFavoriteLink(ref.harness, ref.name, {
                ...ref.link,
                connectionId,
              });
            }
            this.toolModels.remapFavoriteConnections(id, connectionRemaps);
            return updated;
          },
        ),
      { action: 'update', name: current.name },
    );
  }

  remove(id: string, revision: number | undefined): void {
    this.store.assertRevision(id, revision);
    if (this.references(id).length) {
      throw new HttpError(409, ERROR_CODES.favoriteInUse, { code: ERROR_CODES.favoriteInUse });
    }
    this.backups.protect('change', () => this.store.remove(id, revision), {
      action: 'delete',
      name: this.store.get(id).name,
    });
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
    return this.backups.protect(
      'change',
      () =>
        this.liveWrite.transaction(
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
                  ...syncConnectionProtocols([extracted.protocol]),
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
        ),
      { action: 'capture', name: input.favoriteName, tools: [input.harness] },
    );
  }

  detach(harness: HarnessId, name: string, fingerprint: string): void {
    if (this.sourceFingerprint(harness, name) !== fingerprint) {
      throw new HttpError(409, ERROR_CODES.favoritePlanStale, {
        code: ERROR_CODES.favoritePlanStale,
      });
    }
    this.backups.protect('change', () => this.profiles.setFavoriteLink(harness, name, undefined), {
      action: 'detach',
      name,
      tools: [harness],
    });
  }

  ignoreUpdates(id: string, revision: number): void {
    const favorite = this.store.get(id);
    if (favorite.revision !== revision) {
      throw new HttpError(409, ERROR_CODES.favoritePlanStale, {
        code: ERROR_CODES.favoritePlanStale,
      });
    }
    this.backups.protect('change', () => {
      for (const ref of this.references(id)) {
        this.profiles.setFavoriteLink(ref.harness, ref.name, {
          ...ref.link,
          ignoredRevision: revision,
        });
      }
    });
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

function sameAccountModel(
  previous: Pick<FavoriteConnection, 'providerId' | 'endpointKey' | 'requestModelId'>,
  connections: FavoriteConnection[],
) {
  return connections.find(
    (connection) =>
      connection.providerId === previous.providerId &&
      connection.endpointKey === previous.endpointKey &&
      connection.requestModelId === previous.requestModelId,
  );
}
