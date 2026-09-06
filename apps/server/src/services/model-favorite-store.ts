import { randomUUID } from 'node:crypto';
import {
  createFavoriteRequestSchema,
  ERROR_CODES,
  type FavoriteInput,
  favoriteStoreSchema,
  type ModelFavorite,
  modelFavoriteSchema,
} from '@seaveyon/harness-switch-shared';
import { HttpError } from '../common/errors';
import { createDecorator, inject } from '../di';
import { IEnvironmentService } from './environment';
import { IFileService } from './files';

export interface IModelFavoriteStore {
  assertRevision(id: string, revision: number | undefined): void;
  readonly _serviceBrand: undefined;
  list(): ModelFavorite[];
  get(id: string): ModelFavorite;
  create(input: FavoriteInput): ModelFavorite;
  update(id: string, input: FavoriteInput, expectedRevision: number | undefined): ModelFavorite;
  remove(id: string, expectedRevision: number | undefined): void;
}
export const IModelFavoriteStore = createDecorator<IModelFavoriteStore>('modelFavoriteStore');

@inject(IEnvironmentService, IFileService)
export class ModelFavoriteStore implements IModelFavoriteStore {
  declare readonly _serviceBrand: undefined;
  constructor(
    private readonly environment: IEnvironmentService,
    private readonly files: IFileService,
  ) {}

  list(): ModelFavorite[] {
    const content = this.files.readRegularOptional(this.environment.files.favorites);
    if (content === undefined) {
      return [];
    }
    try {
      return favoriteStoreSchema.parse(JSON.parse(content)).favorites;
    } catch {
      throw new HttpError(409, ERROR_CODES.favoriteStoreInvalid, {
        code: ERROR_CODES.favoriteStoreInvalid,
      });
    }
  }

  get(id: string): ModelFavorite {
    const favorite = this.list().find((item) => item.id === id);
    if (!favorite) {
      throw new HttpError(404, ERROR_CODES.favoriteNotFound, {
        code: ERROR_CODES.favoriteNotFound,
      });
    }
    return favorite;
  }

  assertRevision(id: string, revision: number | undefined): void {
    this.compare(this.get(id), revision);
  }

  create(input: FavoriteInput): ModelFavorite {
    const favorites = this.list();
    if (favorites.length >= 1000) {
      throw new HttpError(409, ERROR_CODES.favoriteLimitReached, {
        code: ERROR_CODES.favoriteLimitReached,
      });
    }
    const now = new Date().toISOString();
    const favorite = modelFavoriteSchema.parse({
      ...createFavoriteRequestSchema.parse(input),
      id: randomUUID(),
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
    this.write([...favorites, favorite]);
    return favorite;
  }

  update(id: string, input: FavoriteInput, expectedRevision: number | undefined): ModelFavorite {
    const previous = this.get(id);
    this.compare(previous, expectedRevision);
    const next = modelFavoriteSchema.parse({
      ...previous,
      ...createFavoriteRequestSchema.parse(input),
      revision: previous.revision + 1,
      updatedAt: new Date().toISOString(),
    });
    this.write(this.list().map((favorite) => (favorite.id === id ? next : favorite)));
    return next;
  }

  remove(id: string, expectedRevision: number | undefined): void {
    this.compare(this.get(id), expectedRevision);
    this.write(this.list().filter((favorite) => favorite.id !== id));
  }

  private compare(favorite: ModelFavorite, revision: number | undefined): void {
    if (revision === undefined) {
      throw new HttpError(428, ERROR_CODES.favoriteRevisionRequired, {
        code: ERROR_CODES.favoriteRevisionRequired,
      });
    }
    if (favorite.revision !== revision) {
      throw new HttpError(409, ERROR_CODES.favoriteRevisionConflict, {
        code: ERROR_CODES.favoriteRevisionConflict,
      });
    }
  }

  private write(favorites: ModelFavorite[]): void {
    this.files.writeJson(
      this.environment.files.favorites,
      favoriteStoreSchema.parse({ schemaVersion: 1, favorites }),
    );
  }
}
