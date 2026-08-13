import type { HarnessId } from '@seaveyon/harness-switch-shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function profilesCollectionPath(harnessId: HarnessId | string): string {
  return `/api/harnesses/${harnessId}/profiles`;
}

export function profilePath(harnessId: HarnessId | string, name: string): string {
  return `${profilesCollectionPath(harnessId)}/${encodeURIComponent(name)}`;
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
    throw new ApiError(response.status, payload.error || '请求失败');
  }
  return payload as T;
}
