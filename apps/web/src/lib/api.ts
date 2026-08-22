import type { HarnessId, MessageParams } from '@seaveyon/harness-switch-shared';

/**
 * A failed request. `message` is the server's own prose, kept so anything without a
 * translation still reads; `code` is the stable identifier the UI translates instead.
 */
export class ApiError extends Error {
  readonly code?: string;
  readonly params?: MessageParams;

  constructor(
    readonly status: number,
    message: string,
    options: { code?: string; params?: MessageParams } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = options.code;
    this.params = options.params;
  }
}

export function profilesCollectionPath(harnessId: HarnessId | string): string {
  return `/api/harnesses/${harnessId}/profiles`;
}

export function profilePath(harnessId: HarnessId | string, name: string): string {
  return `${profilesCollectionPath(harnessId)}/${encodeURIComponent(name)}`;
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

export function doctorPath(): string {
  return '/api/doctor';
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
export function operationsPath(): string {
  return '/api/operations';
}

export function operationUndoPath(id: string): string {
  return `${operationsPath()}/${encodeURIComponent(id)}/undo`;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
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
    throw new ApiError(response.status, payload.error ?? '', {
      code: payload.code,
      params: payload.params,
    });
  }
  return payload as T;
}
