import { createHash, randomUUID } from 'node:crypto';
import {
  ERROR_CODES,
  type FavoriteOperation,
  type FavoritePlan,
  type FavoritePlanItem,
  type FavoritePlanRequest,
  type FavoriteProjection,
  HARNESS_IDS,
  type ModelFavoriteLink,
  type ProfilePublic,
  resolveFavorite,
  WARNING_CODES,
} from '@seaveyon/harness-switch-shared';
import { HttpError } from '../common/errors';
import { createDecorator, inject } from '../di';
import { IActivationService } from './activation';
import { type AdapterProfile, IAdapterRegistry } from './adapters';
import { IDriftService } from './drift';
import { IEnvironmentService } from './environment';
import { IFavoriteBackupService } from './favorite-backup';
import { IFileService } from './files';
import { IJournalService } from './journal';
import { ILiveWriteService, type PlannedWrite } from './live-write';
import { favoriteNativePreview } from './model-favorite-preview';
import { IModelFavoriteStore } from './model-favorite-store';
import { IProfileService, type ProfileInput } from './profiles';
import { IVaultService } from './vault';

type PreparedItem = {
  public: FavoritePlanItem;
  input: ProfileInput;
  profile: AdapterProfile;
  link: ModelFavoriteLink;
  fingerprint: string;
  writes: PlannedWrite[];
};
type PreparedPlan = {
  public: FavoritePlan;
  user: string;
  session: string;
  favoriteId: string;
  items: PreparedItem[];
};
export interface IModelFavoriteApplyService {
  readonly _serviceBrand: undefined;
  plan(request: FavoritePlanRequest, session: string): FavoritePlan;
  apply(id: string, requestId: string, session: string): FavoriteOperation;
  operation(requestId: string): FavoriteOperation;
  state(profile: ProfilePublic): {
    sourceMissing: boolean;
    connectionMissing: boolean;
    needsUpdate: boolean;
    diverged: boolean;
  };
}
export const IModelFavoriteApplyService = createDecorator<IModelFavoriteApplyService>(
  'modelFavoriteApplyService',
);

@inject(
  IEnvironmentService,
  IFileService,
  IModelFavoriteStore,
  IProfileService,
  IVaultService,
  IAdapterRegistry,
  IActivationService,
  ILiveWriteService,
  IJournalService,
  IDriftService,
  IFavoriteBackupService,
)
export class ModelFavoriteApplyService implements IModelFavoriteApplyService {
  declare readonly _serviceBrand: undefined;
  private readonly plans = new Map<string, PreparedPlan>();
  constructor(
    private readonly environment: IEnvironmentService,
    private readonly files: IFileService,
    private readonly favorites: IModelFavoriteStore,
    private readonly profiles: IProfileService,
    private readonly vault: IVaultService,
    private readonly adapters: IAdapterRegistry,
    private readonly activation: IActivationService,
    private readonly liveWrite: ILiveWriteService,
    private readonly journal: IJournalService,
    private readonly drift: IDriftService,
    private readonly backups: IFavoriteBackupService,
  ) {}

  state(profile: ProfilePublic) {
    const link = profile.modelFavorite;
    const favorite = link
      ? this.favorites.list().find((item) => item.id === link.favoriteId)
      : undefined;
    const connection = favorite?.connections.find((item) => item.id === link?.connectionId);
    const projected =
      favorite && connection
        ? this.adapters.get(profile.harness).projectFavorite(favorite, connection, link?.baseline)
        : undefined;
    return {
      sourceMissing: !!link && !favorite,
      connectionMissing: !!link && !connection,
      needsUpdate:
        !!link &&
        !!projected &&
        (link.projectionVersion !== projected.projectionVersion ||
          hash(link.baseline) !== hash(projected.projection)),
      diverged:
        !!link &&
        (profile.overriddenTargets.length > 0 ||
          hash(snapshot(profile, link.baseline)) !== hash(link.baseline)),
    };
  }

  plan(request: FavoritePlanRequest, session: string): FavoritePlan {
    const favorite = this.favorites.get(request.favoriteId);
    if (favorite.revision !== request.expectedRevision) {
      throw failure(ERROR_CODES.favoriteRevisionConflict);
    }
    for (const [id, value] of this.plans) {
      if (Date.parse(value.public.expiresAt) < Date.now()) {
        this.plans.delete(id);
      }
    }
    if (this.plans.size >= 1000) {
      throw failure(ERROR_CODES.favoriteLimitReached);
    }
    const items = request.items
      .toSorted((a, b) => HARNESS_IDS.indexOf(a.harness) - HARNESS_IDS.indexOf(b.harness))
      .map((selection): PreparedItem => {
        const connection = favorite.connections.find((item) => item.id === selection.connectionId);
        if (!connection) {
          throw failure(ERROR_CODES.favoriteEndpointMissing);
        }
        const provider = this.vault.get(connection.providerId);
        const endpoint = provider.endpoints.find((item) => item.key === connection.endpointKey);
        if (!endpoint) {
          throw failure(ERROR_CODES.favoriteEndpointMissing);
        }
        const adapter = this.adapters.get(selection.harness);
        let name = selection.profile ?? favorite.name.replace(/[\\/]/g, '-');
        if (!selection.existing && !selection.profile) {
          let suffix = 2;
          const base = name;
          while (this.profiles.get(selection.harness, name)) {
            name = `${base.slice(0, 110)}-${suffix++}`;
          }
        }
        const prior = this.profiles.get(selection.harness, name);
        if (selection.existing ? prior?.modelFavorite?.favoriteId !== favorite.id : !!prior) {
          throw failure(ERROR_CODES.favoriteInUse);
        }
        if (prior?.overriddenTargets.length) {
          throw failure(ERROR_CODES.favoriteRawOverrideConflict);
        }
        const projection = adapter.projectFavorite(
          favorite,
          connection,
          prior?.modelFavorite?.baseline,
        );
        if (prior && this.state(prior).diverged && !selection.overwriteDiverged) {
          projection.blockers.push({ code: ERROR_CODES.favoriteProfileDiverged });
        }
        if (projection.notRepresented.includes('reasoningEffort') && !selection.ignorePreference) {
          projection.blockers.push({ code: ERROR_CODES.favoritePreferenceNotRepresented });
        }
        const extras = { ...prior?.extras };
        if (!prior && ['pi', 'dsh', 'codex', 'kimi'].includes(selection.harness)) {
          extras.providerId = `hsw-mf-${randomUUID()}`;
        }
        for (const [key, value] of Object.entries(projection.projection.extras)) {
          if (value === null) {
            delete extras[key];
          } else {
            extras[key] = value;
          }
        }
        for (const key of Object.keys(projection.rendererDefaults)) {
          if (extras[key]) {
            delete projection.rendererDefaults[key];
          }
        }
        const profile: AdapterProfile = {
          favoriteManaged: true,
          name,
          model: connection.requestModelId,
          extras,
          baseUrl: endpoint.baseUrl,
          apiKey: this.vault.decrypt(provider.id),
        };
        adapter.validate?.(profile);
        const input: ProfileInput = {
          name,
          model: profile.model,
          extras,
          baseUrl: profile.baseUrl,
          providerId: provider.id,
          providerEndpoint: endpoint.key,
        };
        const diff = projection.ownedFields.flatMap((field) => {
          const before = field.startsWith('extras.')
            ? (prior?.extras[field.slice(7)] ?? null)
            : field === 'model'
              ? (prior?.model ?? null)
              : field === 'providerId'
                ? (prior?.providerId ?? null)
                : (prior?.providerEndpoint ?? null);
          const after = projection.set[field] ?? null;
          return before === after ? [] : [{ field, before, after }];
        });
        if (
          selection.mode === 'save' &&
          this.activation.getActive(selection.harness)?.name === name &&
          (diff.length || prior?.baseUrl !== endpoint.baseUrl)
        ) {
          projection.blockers.push({ code: ERROR_CODES.favoriteActiveUpdateRequiresApply });
        }
        // auth.json migration needs the existing explicit login-cache confirmation UI.
        if (
          selection.mode === 'activate' &&
          selection.harness === 'codex' &&
          extras.authMode === 'openai_auth' &&
          selection.allowAuthOverwrite !== true
        ) {
          projection.blockers.push({ code: ERROR_CODES.favoriteProjectionUnsupported });
        }
        const current = Object.fromEntries(
          adapter.targets().map((target) => [target.key, this.files.readOptional(target.path)]),
        );
        if (
          !prior &&
          extras.providerId &&
          Object.values(current).some((content) => content?.includes(extras.providerId!))
        ) {
          projection.blockers.push({ code: ERROR_CODES.favoriteInUse });
        }
        let writes: PlannedWrite[] = [];
        if (selection.mode === 'activate' && projection.blockers.length === 0) {
          try {
            writes = this.activation.prepareFavorite(selection.harness, profile);
          } catch (error) {
            projection.blockers.push({
              code: error instanceof HttpError ? error.code : ERROR_CODES.nativeConfigInvalid,
            });
          }
        }
        const item: FavoritePlanItem = {
          preservedFields: Object.keys(prior?.extras ?? {}).filter(
            (key) => !Object.hasOwn(projection.projection.extras, key),
          ),
          authMode:
            extras.authMode ??
            extras.authVar ??
            adapter.fields.find((field) => field.key === 'authMode' || field.key === 'authVar')
              ?.defaultValue ??
            'apiKey',
          liveState:
            selection.mode === 'activate'
              ? this.drift.inspect(selection.harness).status
              : 'unknown',
          ...selection,
          profile: name,
          projection,
          resolved: resolveFavorite(favorite, connection),
          diff,
          nativeFiles: writes.map((write) => ({
            key: write.key,
            changed: current[write.key] !== write.content,
            before: favoriteNativePreview(write.format, current[write.key], [profile.apiKey]),
            after: favoriteNativePreview(write.format, write.content, [profile.apiKey]),
          })),
        };
        return {
          public: item,
          input,
          profile,
          link: {
            favoriteId: favorite.id,
            connectionId: connection.id,
            appliedRevision: favorite.revision,
            projectionVersion: projection.projectionVersion,
            baseline: projection.projection,
          },
          writes,
          fingerprint: this.fingerprint(favorite.id, item),
        };
      });
    const plan: FavoritePlan = {
      id: randomUUID(),
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      favoriteRevision: favorite.revision,
      items: items.map((item) => item.public),
    };
    this.plans.set(plan.id, {
      public: plan,
      items,
      user: this.environment.dataDir,
      session,
      favoriteId: favorite.id,
    });
    return plan;
  }

  operation(requestId: string): FavoriteOperation {
    const receipts = this.journal
      .list()
      .filter((receipt) => receipt.favoriteRequest?.requestId === requestId)
      .toSorted((a, b) => a.favoriteRequest!.item - b.favoriteRequest!.item);
    return {
      requestId,
      items: [
        ...receipts.map((receipt) => ({
          harness: receipt.harness,
          profile: receipt.profile,
          operationId: receipt.id,
          code: receipt.favoriteResult?.code,
          status:
            receipt.state === 'committed' || receipt.state === 'metadata-committed'
              ? (receipt.favoriteResult?.status ?? 'applied')
              : receipt.state === 'rolled-back' || receipt.state === 'degraded'
                ? 'failed'
                : 'skipped',
        })),
        ...(receipts[0]?.favoriteRequest?.targets ?? [])
          .filter((target) => !receipts.some((receipt) => receipt.harness === target.harness))
          .map((target) => ({
            ...target,
            status: 'skipped' as const,
            code: ERROR_CODES.favoritePlanExpired,
          })),
      ],
    };
  }

  apply(id: string, requestId: string, session: string): FavoriteOperation {
    const receipts = this.journal
      .list()
      .filter((receipt) => receipt.favoriteRequest?.requestId === requestId);
    if (receipts.length) {
      if (receipts.some((receipt) => receipt.favoriteRequest?.planId !== id)) {
        throw failure(ERROR_CODES.favoriteIdempotencyConflict);
      }
      return this.operation(requestId);
    }
    const plan = this.plans.get(id);
    if (
      !plan ||
      plan.user !== this.environment.dataDir ||
      plan.session !== session ||
      Date.parse(plan.public.expiresAt) < Date.now()
    ) {
      throw failure(ERROR_CODES.favoritePlanExpired);
    }
    for (const prepared of plan.items) {
      if (!this.matchesFingerprint(plan.favoriteId, prepared)) {
        throw failure(ERROR_CODES.favoritePlanStale);
      }
      if (prepared.public.projection.blockers.length) {
        throw failure(prepared.public.projection.blockers[0]!.code);
      }
    }
    this.backups.create('apply');
    const result: FavoriteOperation = { requestId, items: [] };
    for (const [index, prepared] of plan.items.entries()) {
      const item = prepared.public;
      if (!this.matchesFingerprint(plan.favoriteId, prepared)) {
        throw failure(ERROR_CODES.favoritePlanStale);
      }
      if (item.projection.blockers.length) {
        throw failure(item.projection.blockers[0]!.code);
      }
      const unchanged =
        item.existing &&
        item.diff.length === 0 &&
        (item.mode === 'save' ||
          (this.activation.getActive(item.harness)?.name === item.profile &&
            item.nativeFiles.every((file) => !file.changed)));
      try {
        this.liveWrite.transaction(
          {
            kind: 'favorite-apply',
            harness: item.harness,
            profile: item.profile,
            writes: unchanged ? [] : prepared.writes,
            metadata:
              item.mode === 'activate' && !unchanged ? ['profiles', 'active'] : ['profiles'],
            favoriteRequest: {
              version: 1,
              requestId,
              planId: id,
              item: index,
              approvalHash: hash(plan.public),
              targets: plan.items.map((entry) => ({
                harness: entry.public.harness,
                profile: entry.public.profile,
              })),
            },
            favoriteResult: { status: unchanged ? 'unchanged' : 'applied' },
            beforeWrites:
              item.mode === 'activate' && !unchanged
                ? () => this.activation.commitFavorite(item.harness, prepared.profile)
                : undefined,
          },
          () => {
            if (unchanged) {
              this.profiles.setFavoriteLink(item.harness, item.profile, prepared.link);
              return;
            }
            if (item.existing) {
              this.profiles.setFavoriteLink(item.harness, item.profile, undefined);
            }
            this.profiles.upsert(item.harness, prepared.input, !item.existing);
            this.profiles.setFavoriteLink(item.harness, item.profile, prepared.link);
          },
        );
        if (item.mode === 'activate' && !unchanged) {
          try {
            this.activation.refreshEnv();
          } catch {
            const receipt = this.journal
              .list()
              .find(
                (entry) =>
                  entry.favoriteRequest?.requestId === requestId &&
                  entry.favoriteRequest.item === index,
              );
            if (receipt) {
              this.journal.setFavoriteResult(receipt.id, {
                status: unchanged ? 'unchanged' : 'applied',
                code: WARNING_CODES.envRebuildFailed,
              });
            }
          }
        }
      } catch (error) {
        result.items.push({
          harness: item.harness,
          profile: item.profile,
          status: 'failed',
          code: error instanceof HttpError ? error.code : ERROR_CODES.requestFailed,
        });
        if (
          this.journal
            .list()
            .some(
              (receipt) =>
                receipt.favoriteRequest?.requestId === requestId && receipt.state === 'degraded',
            ) ||
          !this.journal
            .list()
            .some(
              (receipt) =>
                receipt.favoriteRequest?.requestId === requestId &&
                receipt.favoriteRequest.item === index,
            )
        ) {
          break;
        }
      }
    }
    this.plans.delete(id);
    return {
      requestId,
      items: [
        ...this.operation(requestId).items,
        ...result.items.filter(
          (item) =>
            !this.operation(requestId).items.some((saved) => saved.harness === item.harness),
        ),
      ],
    };
  }

  private matchesFingerprint(favoriteId: string, prepared: PreparedItem): boolean {
    try {
      return prepared.fingerprint === this.fingerprint(favoriteId, prepared.public);
    } catch {
      // Deleted or unreadable dependencies invalidate an approval just like changed values.
      return false;
    }
  }

  private fingerprint(favoriteId: string, item: FavoritePlanItem): string {
    const favorite = this.favorites.get(favoriteId);
    const connection = favorite.connections.find((entry) => entry.id === item.connectionId);
    return hash({
      favorite,
      profile: this.profiles.fingerprint(item.harness, item.profile),
      credential: connection ? this.vault.decrypt(connection.providerId) : null,
      provider: connection ? this.vault.get(connection.providerId) : null,
      active: this.activation.fingerprint(item.harness),
      files: this.adapters
        .get(item.harness)
        .targets()
        .map((target) => [target.key, this.files.readOptional(target.path)]),
    });
  }
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function failure(code: string): HttpError {
  return new HttpError(409, code, { code: code as (typeof ERROR_CODES)[keyof typeof ERROR_CODES] });
}
function snapshot(profile: ProfilePublic, baseline: FavoriteProjection): FavoriteProjection {
  return {
    harness: profile.harness,
    model: profile.model,
    providerId: profile.providerId ?? '',
    providerEndpoint: profile.providerEndpoint ?? '',
    extras: Object.fromEntries(
      Object.keys(baseline.extras).map((key) => [key, profile.extras[key] ?? null]),
    ),
  };
}
