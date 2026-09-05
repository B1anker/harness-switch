import type { HarnessId, MessageParams } from '@seaveyon/harness-switch-shared';
import { i18n } from '@/lib/i18n';

/**
 * A failed request. `message` is the server-provided localized prose; `code` remains
 * authoritative so an already-open view updates immediately when its language changes.
 */
export class ApiError extends Error {
  readonly code?: string;
  readonly data?: MessageParams;

  constructor(
    readonly status: number,
    message: string,
    options: { code?: string; data?: MessageParams } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = options.code;
    this.data = options.data;
  }
}

export function harnessesPath(): string {
  return '/api/harnesses';
}

export function profilesCollectionPath(harnessId: HarnessId | string): string {
  return `${harnessesPath()}/${harnessId}/profiles`;
}

export function profileActivatePath(harnessId: HarnessId | string, name: string): string {
  return `${profilePath(harnessId, name)}/activate`;
}

export function profilePreviewPath(harnessId: HarnessId | string, name: string): string {
  return `${profilePath(harnessId, name)}/preview`;
}

export function officialActivatePath(harnessId: HarnessId | string): string {
  return `${harnessesPath()}/${harnessId}/official/activate`;
}

export function profilePath(harnessId: HarnessId | string, name: string): string {
  return `${profilesCollectionPath(harnessId)}/${encodeURIComponent(name)}`;
}

export function officialPreviewPath(harnessId: HarnessId | string): string {
  return `${harnessesPath()}/${harnessId}/official/preview`;
}

export function backupsPath(id?: string): string {
  return id ? `/api/backups/${encodeURIComponent(id)}` : '/api/backups';
}

export function backupRestorePath(id: string): string {
  return `${backupsPath(id)}/restore`;
}

/** Provider Vault: shared credential entries any profile can reference. */
export function providersPath(): string {
  return '/api/providers';
}

export function providerPath(id: string): string {
  return `${providersPath()}/${encodeURIComponent(id)}`;
}

/** Reveals an entry's plaintext key; the only route that returns key material. */
export function providerRevealPath(id: string): string {
  return `${providerPath(id)}/reveal`;
}

/** Connectivity probe for unsaved form values, against an explicit base URL. */
export function probePath(): string {
  return '/api/probe';
}

/** Connectivity probe with the credential already stored on a saved profile. */
export function profileProbePath(harnessId: HarnessId | string, name: string): string {
  return `${profilePath(harnessId, name)}/probe`;
}

/** Connectivity probe with the credential stored in a vault entry. */
export function providerProbePath(id: string): string {
  return `${providerPath(id)}/probe`;
}

export function doctorPath(harnessId?: HarnessId | string): string {
  return harnessId ? `/api/doctor?harness=${encodeURIComponent(harnessId)}` : '/api/doctor';
}

/** Drift reports for every harness, or a single harness when an id is given. */
export function driftPath(harnessId?: HarnessId | string): string {
  return harnessId ? `/api/drift/${encodeURIComponent(harnessId)}` : '/api/drift';
}

export function driftReapplyPath(harnessId: HarnessId | string): string {
  return `${driftPath(harnessId)}/reapply`;
}

export function driftAdoptPath(harnessId: HarnessId | string): string {
  return `${driftPath(harnessId)}/adopt`;
}

/** Read-only inspection of the config the five tools already have on disk. */
export function scanPath(): string {
  return '/api/scan';
}

export function scanImportPath(): string {
  return `${scanPath()}/import`;
}

/** Receipts for completed operations, and the undo built on them. */
export function operationsPath(harnessId?: HarnessId | string): string {
  return harnessId ? `/api/operations?harness=${encodeURIComponent(harnessId)}` : '/api/operations';
}

export function operationUndoPath(id: string): string {
  return `${operationsPath()}/${encodeURIComponent(id)}/undo`;
}

/** Session and the Unix accounts this process may manage on the user's behalf. */
export const authPath = {
  session: '/api/auth/session',
  login: '/api/auth/login',
  logout: '/api/auth/logout',
} as const;

export function usersPath(): string {
  return '/api/users';
}

export function userSelectPath(username: string): string {
  return `${usersPath()}/${encodeURIComponent(username)}/select`;
}

/** Copying one local account's configuration into another. */
export const userSyncPath = {
  preview: '/api/users/sync/preview',
  run: '/api/users/sync',
} as const;

/** The encrypted portable package, as a file the user holds. */
export const transferPath = {
  preview: '/api/transfer/preview',
  import: '/api/transfer/import',
  export: '/api/transfer/export',
} as const;

/** The same package kept in a private Gist, plus the GitHub connection behind it. */
export const githubPath = {
  status: '/api/github/status',
  token: '/api/github/token',
  disconnect: '/api/github/disconnect',
  deviceCode: '/api/github/device/code',
  devicePoll: '/api/github/device/poll',
  push: '/api/github/push',
  pullPreview: '/api/github/pull/preview',
  pull: '/api/github/pull',
} as const;

export const versionPath = '/api/version';

/** The self-update check and the update it triggers. */
export const updatePath = {
  check: '/api/update/check',
  run: '/api/update',
} as const;

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Accept-Language', i18n.language);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(path, {
    credentials: 'include',
    ...options,
    headers,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(response.status, payload.msg ?? '', {
      code: payload.code,
      data: payload.data,
    });
  }
  return payload as T;
}

export const favoritesPath = (suffix?: string) =>
  `/api/model-favorites${suffix ? `/${suffix}` : ''}`;
export const favoritePath = (id: string) => `${favoritesPath()}/${encodeURIComponent(id)}`;
export const favoriteTargetsPath = (id: string) => `${favoritePath(id)}/targets`;
export const favoriteSourcePath = (harness: string, name: string, detach = false) =>
  `${favoritesPath()}/source/${encodeURIComponent(harness)}/${encodeURIComponent(name)}${detach ? '/detach' : ''}`;
export const favoritePlansPath = () => '/api/model-favorite-plans';
export const favoriteBackupsPath = (id?: string) =>
  `${favoritesPath('backups')}${id ? `/${encodeURIComponent(id)}/restore` : ''}`;
export const favoriteApplyPath = (id: string) =>
  `${favoritePlansPath()}/${encodeURIComponent(id)}/apply`;
