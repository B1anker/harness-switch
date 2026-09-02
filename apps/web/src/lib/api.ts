import type { HarnessId, MessageParams } from '@seaveyon/harness-switch-shared';
import { i18n } from '@/lib/i18n';

/**
 * A failed request. `message` is the server-provided localized prose; `code` remains
 * authoritative so an already-open view updates immediately when its language changes.
 */
export class ApiError extends Error {
  readonly code?: string;
  readonly params?: MessageParams;

  constructor(
    readonly status: number,
    message: string,
    options: { code?: string; data?: MessageParams; params?: MessageParams } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = options.code;
    this.params = options.data ?? options.params;
  }
}

export function profilesCollectionPath(harnessId: HarnessId | string): string {
  return `/api/harnesses/${harnessId}/profiles`;
}

export function profilePath(harnessId: HarnessId | string, name: string): string {
  return `${profilesCollectionPath(harnessId)}/${encodeURIComponent(name)}`;
}

export function officialPreviewPath(harnessId: HarnessId | string): string {
  return `/api/harnesses/${harnessId}/official/preview`;
}

export function backupsPath(id?: string): string {
  return id ? `/api/backups/${encodeURIComponent(id)}` : '/api/backups';
}

/** Provider Vault: shared credential entries any profile can reference. */
export function providersPath(): string {
  return '/api/providers';
}

export function providerPath(id: string): string {
  return `${providersPath()}/${encodeURIComponent(id)}`;
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
    throw new ApiError(response.status, payload.msg ?? payload.error ?? '', {
      code: payload.code,
      data: payload.data ?? payload.params,
    });
  }
  return payload as T;
}
