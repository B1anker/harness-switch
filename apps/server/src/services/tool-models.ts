import { createHash, randomUUID } from 'node:crypto';
import {
  createFavoriteRequestSchema,
  ERROR_CODES,
  type ModelFavoriteLink,
  type ToolModelItem,
  type ToolModelsHarness,
  type ToolModelsPreview,
  type ToolModelsRequest,
  type ToolModelsState,
  toolModelDraftSchema,
  toolModelsHarnessSchema,
  toolModelsRequestSchema,
} from '@seaveyon/harness-switch-shared';
import { z } from 'zod';
import { HttpError } from '../common/errors';
import { createDecorator, inject } from '../di';
import { IActivationService } from './activation';
import { type AdapterProfile, type CurrentFiles, IAdapterRegistry } from './adapters';
import { IEnvironmentService } from './environment';
import { IFileService } from './files';
import { ILiveWriteService, type PlannedWrite } from './live-write';
import { favoriteNativePreview } from './model-favorite-preview';
import { IModelFavoriteStore } from './model-favorite-store';
import { IProfileService, type ProfileInput } from './profiles';
import { IVaultService } from './vault';

const stateSchema = z.object({
  revision: z.number().int().nonnegative(),
  draft: toolModelDraftSchema,
  applied: z.array(z.object({ id: z.uuid(), profile: z.string().min(1).max(120) })).max(50),
});
const storeSchema = z.object({
  version: z.literal(1),
  collections: z.partialRecord(toolModelsHarnessSchema, stateSchema),
});
type Model = {
  item: ToolModelItem;
  profile: AdapterProfile;
  input?: ProfileInput;
  link?: ModelFavoriteLink;
  summary: ToolModelsPreview['items'][number];
};
type Plan = {
  user: string;
  session: string;
  expires: number;
  fingerprint: string;
  harness: ToolModelsHarness;
  request: ToolModelsRequest;
  models: Model[];
  writes: PlannedWrite[];
  preview: ToolModelsPreview;
  completed?: ToolModelsState;
};

export interface IToolModelsService {
  readonly _serviceBrand: undefined;
  get(harness: ToolModelsHarness): ToolModelsState;
  save(harness: ToolModelsHarness, request: ToolModelsRequest): ToolModelsState;
  preview(
    harness: ToolModelsHarness,
    request: ToolModelsRequest,
    session: string,
  ): ToolModelsPreview;
  apply(harness: ToolModelsHarness, planId: string, session: string): ToolModelsState;
}
export const IToolModelsService = createDecorator<IToolModelsService>('toolModelsService');

@inject(
  IEnvironmentService,
  IFileService,
  IProfileService,
  IModelFavoriteStore,
  IVaultService,
  IAdapterRegistry,
  IActivationService,
  ILiveWriteService,
)
export class ToolModelsService implements IToolModelsService {
  declare readonly _serviceBrand: undefined;
  private readonly plans = new Map<string, Plan>();
  constructor(
    private readonly environment: IEnvironmentService,
    private readonly files: IFileService,
    private readonly profiles: IProfileService,
    private readonly favorites: IModelFavoriteStore,
    private readonly vault: IVaultService,
    private readonly adapters: IAdapterRegistry,
    private readonly activation: IActivationService,
    private readonly liveWrite: ILiveWriteService,
  ) {}

  get(harness: ToolModelsHarness): ToolModelsState {
    const stored = this.read().collections[harness];
    if (stored) {
      return { ...stored, nativeStatus: this.nativeStatus(harness, stored) };
    }
    const active = this.activation.getActive(harness);
    const profile =
      active && !active.official ? this.profiles.get(harness, active.name) : undefined;
    const id = profile ? stableUuid(`${harness}/${profile.name}`) : undefined;
    return {
      revision: 0,
      draft: {
        items:
          profile && id
            ? [
                {
                  id,
                  source: { kind: 'profile', name: profile.name },
                  factOverrides: {},
                  preferenceOverrides: {},
                },
              ]
            : [],
        defaultItemId: null,
      },
      applied: profile && id ? [{ id, profile: profile.name }] : [],
    };
  }

  save(harness: ToolModelsHarness, input: ToolModelsRequest): ToolModelsState {
    const request = toolModelsRequestSchema.parse(input);
    const state = this.compare(harness, request.expectedRevision);
    this.resolve(harness, request);
    const next = { ...state, revision: state.revision + 1, draft: request.draft };
    this.liveWrite.transaction(
      { kind: 'favorite-apply', harness, profile: harness, writes: [], metadata: ['toolModels'] },
      () => this.write(harness, next),
    );
    return this.get(harness);
  }

  preview(
    harness: ToolModelsHarness,
    input: ToolModelsRequest,
    session: string,
  ): ToolModelsPreview {
    const request = toolModelsRequestSchema.parse(input);
    const state = this.compare(harness, request.expectedRevision);
    const models = this.resolve(harness, request);
    const adapter = this.adapters.get(harness);
    const current: CurrentFiles = Object.fromEntries(
      adapter.targets().map((target) => [target.key, this.files.readOptional(target.path)]),
    );
    let rendered = { ...current };
    const removed = state.applied.filter((entry) => {
      const next = models.find((model) => model.profile.name === entry.profile);
      if (!next) {
        return true;
      }
      if (!this.profiles.get(harness, entry.profile)) {
        return false;
      }
      const previous = this.profiles.decrypt(harness, entry.profile);
      return (
        previous.model !== next.profile.model ||
        previous.extras.providerId !== next.profile.extras.providerId
      );
    });
    const active = this.activation.getActive(harness);
    if (!request.draft.defaultItemId && removed.some((entry) => entry.profile === active?.name)) {
      throw failure(ERROR_CODES.toolModelsDefaultRequired);
    }
    for (const entry of removed) {
      if (!this.profiles.get(harness, entry.profile)) {
        continue;
      }
      const profile = this.profiles.decrypt(harness, entry.profile);
      // An external CLI may have selected a different default since our last activation.
      const detected = adapter.detect?.(rendered) ?? [];
      if (
        !request.draft.defaultItemId &&
        detected.some(
          (candidate) =>
            candidate.active &&
            candidate.extras.providerId === profile.extras.providerId &&
            candidate.model === profile.model,
        )
      ) {
        throw failure(ERROR_CODES.toolModelsDefaultRequired);
      }
      rendered = { ...rendered, ...adapter.revoke!(profile, rendered) };
    }
    for (const model of models) {
      rendered = {
        ...rendered,
        ...(adapter.renderCollectionModel ?? adapter.renderAvailable)!.call(
          adapter,
          model.profile,
          rendered,
        ),
      };
    }
    const selected = models.find((model) => model.item.id === request.draft.defaultItemId);
    if (selected) {
      rendered = { ...rendered, ...adapter.render(selected.profile, rendered) };
    }
    const writes = adapter
      .targets()
      .flatMap((target): PlannedWrite[] =>
        rendered[target.key] === undefined
          ? []
          : [{ ...target, content: rendered[target.key]!, secret: true }],
      );
    const secrets = [
      ...models.map((model) => model.profile.apiKey),
      ...state.applied
        .filter((entry) => this.profiles.get(harness, entry.profile))
        .map((entry) => this.profiles.decrypt(harness, entry.profile).apiKey),
    ];
    const preview: ToolModelsPreview = {
      id: randomUUID(),
      items: models.map((model) => model.summary),
      removed: removed.map((entry) => entry.profile),
      defaultItemId: request.draft.defaultItemId,
      files: writes.map((write) => ({
        key: write.key,
        changed: write.content !== current[write.key],
        before:
          favoriteNativePreview(
            write.format,
            current[write.key],
            secrets,
            write.key === 'credentials',
          ) ?? '',
        after:
          favoriteNativePreview(
            write.format,
            write.content,
            secrets,
            write.key === 'credentials',
          ) ?? '',
      })),
    };
    for (const [id, plan] of this.plans) {
      if (plan.expires < Date.now()) {
        this.plans.delete(id);
      }
    }
    if (this.plans.size >= 1000) {
      throw failure(ERROR_CODES.favoriteLimitReached);
    }
    this.plans.set(preview.id, {
      user: this.environment.dataDir,
      session,
      expires: Date.now() + 600000,
      fingerprint: this.fingerprint(harness),
      harness,
      request,
      models,
      writes,
      preview,
    });
    return preview;
  }

  apply(harness: ToolModelsHarness, planId: string, session: string): ToolModelsState {
    const plan = this.plans.get(planId);
    if (
      !plan ||
      plan.harness !== harness ||
      plan.user !== this.environment.dataDir ||
      plan.session !== session ||
      plan.expires < Date.now()
    ) {
      throw failure(ERROR_CODES.favoritePlanExpired);
    }
    if (plan.completed) {
      return plan.completed;
    }
    if (plan.fingerprint !== this.fingerprint(harness)) {
      throw failure(ERROR_CODES.favoritePlanStale);
    }
    const next: ToolModelsState = {
      revision: plan.request.expectedRevision + 1,
      draft: plan.request.draft,
      applied: plan.models.map((model) => ({ id: model.item.id, profile: model.profile.name })),
    };
    const selected = plan.models.find((model) => model.item.id === next.draft.defaultItemId);
    this.liveWrite.transaction(
      {
        kind: 'favorite-apply',
        harness,
        profile: selected?.profile.name ?? harness,
        writes: plan.writes,
        metadata: ['profiles', 'active', 'toolModels'],
        beforeWrites: selected
          ? () => this.activation.commitFavorite(harness, selected.profile)
          : undefined,
      },
      () => {
        for (const model of plan.models) {
          if (model.input) {
            const existing = !!this.profiles.get(harness, model.profile.name);
            if (existing) {
              this.profiles.setFavoriteLink(harness, model.profile.name, undefined);
            }
            this.profiles.upsert(harness, model.input, !existing);
            this.profiles.setFavoriteLink(harness, model.profile.name, model.link);
          }
        }
        for (const entry of this.get(harness).applied) {
          const profile = this.profiles.get(harness, entry.profile);
          if (
            profile?.modelFavorite?.collectionOverrides &&
            profile.extras.modelId === `hsw-model-${entry.id}` &&
            !next.applied.some((model) => model.profile === entry.profile)
          ) {
            this.profiles.remove(harness, entry.profile);
          }
        }
        this.write(harness, next);
      },
    );
    plan.completed = this.get(harness);
    return plan.completed;
  }

  private resolve(harness: ToolModelsHarness, request: ToolModelsRequest): Model[] {
    const adapter = this.adapters.get(harness);
    const state = this.get(harness);
    const seen = new Set<string>();
    const names = new Set<string>();
    return request.draft.items.map((item): Model => {
      if (item.source.kind === 'profile') {
        const profile = {
          ...this.profiles.decrypt(harness, item.source.name),
          favoriteManaged: true,
        };
        if (
          Object.keys(profile.overrides).length ||
          Object.keys(item.factOverrides).length ||
          Object.keys(item.preferenceOverrides).length
        ) {
          throw failure(ERROR_CODES.favoriteRawOverrideConflict);
        }
        return {
          item,
          profile,
          summary: {
            id: item.id,
            name: profile.name,
            model: profile.model,
            connection: profile.baseUrl,
            warnings: [],
            notRepresented: [],
          },
        };
      }
      const source = item.source;
      const favorite = this.favorites.get(source.favoriteId);
      const connection = favorite.connections.find((entry) => entry.id === source.connectionId);
      if (!connection) {
        throw failure(ERROR_CODES.favoriteEndpointMissing);
      }
      const provider = this.vault.get(connection.providerId);
      const endpoint = provider.endpoints.find((entry) => entry.key === connection.endpointKey);
      if (!endpoint) {
        throw failure(ERROR_CODES.favoriteEndpointMissing);
      }
      const route = `${provider.id}/${endpoint.key}/${connection.protocol}`;
      const identity = `${route}/${connection.requestModelId}`;
      if (seen.has(identity)) {
        throw failure(ERROR_CODES.toolModelsConflict);
      }
      seen.add(identity);
      const effective = {
        ...connection,
        factOverrides: { ...connection.factOverrides, ...item.factOverrides },
        preferenceOverrides: { ...connection.preferenceOverrides, ...item.preferenceOverrides },
      };
      if (
        !createFavoriteRequestSchema.safeParse({
          ...favorite,
          connections: favorite.connections.map((entry) =>
            entry.id === effective.id ? effective : entry,
          ),
        }).success
      ) {
        throw new HttpError(400, ERROR_CODES.toolModelsFactsInvalid, {
          code: ERROR_CODES.toolModelsFactsInvalid,
        });
      }
      const projection = adapter.projectFavorite(favorite, effective);
      if (projection.blockers.length) {
        throw failure(projection.blockers[0]!.code);
      }
      const baseName = `${favorite.name} · ${connection.label}`
        .replace(/[\\/]/g, '-')
        .slice(0, 120);
      const existingName = state.applied.find((entry) => entry.id === item.id)?.profile;
      const name =
        existingName ??
        (this.profiles.get(harness, baseName) || names.has(baseName)
          ? `${baseName.slice(0, 110)}-${item.id.slice(0, 8)}`
          : baseName);
      names.add(name);
      const prior = this.profiles.get(harness, name);
      if (
        prior &&
        (!state.applied.some((entry) => entry.id === item.id && entry.profile === name) ||
          prior.overriddenTargets.length)
      ) {
        throw failure(ERROR_CODES.toolModelsConflict);
      }
      const preserved = { ...prior?.extras };
      for (const key of Object.keys(prior?.modelFavorite?.baseline.extras ?? {})) {
        delete preserved[key];
      }
      const extras = {
        ...preserved,
        ...Object.fromEntries(
          Object.entries(projection.projection.extras).filter(
            (entry): entry is [string, string] => entry[1] !== null,
          ),
        ),
        providerId: `hsw-mc-${hash(route).slice(0, 24)}`,
        providerName: provider.name,
        modelId: `hsw-model-${item.id}`,
        models: '',
      };
      const profile: AdapterProfile = {
        favoriteManaged: true,
        name,
        baseUrl: endpoint.baseUrl,
        apiKey: this.vault.decrypt(provider.id),
        model: connection.requestModelId,
        extras,
      };
      adapter.validate?.(profile);
      return {
        item,
        profile,
        input: {
          name,
          baseUrl: profile.baseUrl,
          model: profile.model,
          extras,
          providerId: provider.id,
          providerEndpoint: endpoint.key,
        },
        link: {
          favoriteId: favorite.id,
          connectionId: connection.id,
          appliedRevision: favorite.revision,
          projectionVersion: projection.projectionVersion,
          baseline: projection.projection,
          collectionOverrides: {
            factOverrides: item.factOverrides,
            preferenceOverrides: item.preferenceOverrides,
          },
        },
        summary: {
          id: item.id,
          name: favorite.name,
          model: profile.model,
          connection: `${provider.name} · ${connection.protocol}`,
          warnings: projection.warnings,
          notRepresented: projection.notRepresented,
        },
      };
    });
  }

  private compare(harness: ToolModelsHarness, revision: number): ToolModelsState {
    const state = this.get(harness);
    if (state.revision !== revision) {
      throw failure(ERROR_CODES.favoriteRevisionConflict);
    }
    return state;
  }
  private nativeStatus(
    harness: ToolModelsHarness,
    state: ToolModelsState,
  ): NonNullable<ToolModelsState['nativeStatus']> {
    if (!state.applied.length) {
      return 'unknown';
    }
    const adapter = this.adapters.get(harness);
    try {
      const current = Object.fromEntries(
        adapter.targets().map((target) => [target.key, this.files.readOptional(target.path)]),
      );
      let expected = { ...current };
      for (const entry of state.applied) {
        if (!this.profiles.get(harness, entry.profile)) {
          return 'drifted';
        }
        expected = {
          ...expected,
          ...(adapter.renderCollectionModel ?? adapter.renderAvailable)!.call(
            adapter,
            this.profiles.decrypt(harness, entry.profile),
            expected,
          ),
        };
      }
      return Object.keys(expected).some((key) => expected[key] !== current[key])
        ? 'drifted'
        : 'in-sync';
    } catch {
      return 'invalid';
    }
  }
  private read() {
    const content = this.files.readRegularOptional(this.environment.files.toolModels);
    try {
      return storeSchema.parse(
        content === undefined ? { version: 1, collections: {} } : JSON.parse(content),
      );
    } catch {
      throw failure(ERROR_CODES.toolModelsInvalid);
    }
  }
  private write(harness: ToolModelsHarness, state: ToolModelsState): void {
    const store = this.read();
    store.collections[harness] = stateSchema.parse(state);
    this.files.writeJson(this.environment.files.toolModels, store);
  }
  private fingerprint(harness: ToolModelsHarness): string {
    return hash({
      user: this.environment.dataDir,
      state: this.read(),
      profiles: this.files.readOptional(this.environment.files.profiles),
      vault: this.files.readOptional(this.environment.files.vault),
      favorites: this.favorites.list(),
      active: this.activation.fingerprint(harness),
      files: this.adapters
        .get(harness)
        .targets()
        .map((target) => this.files.readOptional(target.path)),
    });
  }
}
function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function stableUuid(value: string): string {
  const id = hash(value);
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-4${id.slice(13, 16)}-a${id.slice(17, 20)}-${id.slice(20, 32)}`;
}
function failure(code: string): HttpError {
  return new HttpError(409, code, { code: code as (typeof ERROR_CODES)[keyof typeof ERROR_CODES] });
}
