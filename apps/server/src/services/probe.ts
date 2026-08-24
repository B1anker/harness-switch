import type { ProbeResult } from '@seaveyon/harness-switch-shared';
import { PROBE_CODES } from '@seaveyon/harness-switch-shared';
import { createDecorator, inject } from '../di';

export type ProbeInput = {
  baseUrl: string;
  apiKey: string;
};

export interface IProbeService {
  readonly _serviceBrand: undefined;
  probe(input: ProbeInput): Promise<ProbeResult>;
}

export const IProbeService = createDecorator<IProbeService>('probeService');

/** One unanswered request is enough to make a user think the feature is broken. */
const TIMEOUT_MS = 10_000;

/** Catalog responses are small; anything past this is treated as a malformed body. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

/** Upper bound on catalog entries kept, so a hostile endpoint cannot balloon a response. */
const MAX_MODELS = 1000;

/**
 * Connectivity probe against an OpenAI- or Anthropic-style endpoint.
 *
 * Deliberately dependency-free: it only needs `fetch`, so tests point it at a local
 * server and nothing else has to be constructed. Credential resolution lives with the
 * callers (routes, doctor), which know whether the key comes from a form, the vault
 * or the profile store; this service never sees where a secret came from.
 *
 * The request carries both auth header conventions at once (`Authorization: Bearer`
 * and `x-api-key` + `anthropic-version`): relays ignore what they do not know, and
 * guessing wrong would report healthy endpoints as broken.
 */
@inject()
export class ProbeService implements IProbeService {
  declare readonly _serviceBrand: undefined;

  async probe(input: ProbeInput): Promise<ProbeResult> {
    const baseUrl = input.baseUrl.trim();
    if (!baseUrl) {
      return failure(PROBE_CODES.missingBaseUrl, '未提供 Base URL，无法测试');
    }
    if (!input.apiKey.trim()) {
      return failure(PROBE_CODES.missingApiKey, '未提供 API Key，无法测试');
    }

    let base: URL;
    try {
      base = new URL(baseUrl);
    } catch {
      return failure(PROBE_CODES.badUrl, `Base URL 无法解析：${baseUrl}`);
    }
    if (base.protocol !== 'http:' && base.protocol !== 'https:') {
      return failure(PROBE_CODES.badUrl, `Base URL 必须是 http/https：${base.protocol}`);
    }

    // A base URL that already ends in /v1 (Codex convention) gets /models appended
    // directly; otherwise /v1/models is tried first and the bare path is the fallback.
    const path = base.pathname.replace(/\/+$/, '');
    const candidates =
      path.endsWith('/v1') || /\/v\d+$/.test(path)
        ? [joinUrl(base, 'models')]
        : [joinUrl(base, 'v1/models'), joinUrl(base, 'models')];

    let lastStatus: number | undefined;
    for (let index = 0; index < candidates.length; index++) {
      const result = await this.request(candidates[index]!, input.apiKey);
      // A 404 means "no catalog at this path", not "the provider is down" — fall
      // through to the next candidate shape. Anything else decides the outcome.
      if (result.status !== 404 || index === candidates.length - 1) {
        return result;
      }
      lastStatus = result.status;
    }
    return failure(PROBE_CODES.httpError, `端点返回 ${lastStatus ?? '未知状态'}，未找到模型目录`, {
      status: lastStatus,
      params: lastStatus === undefined ? undefined : { status: lastStatus },
    });
  }

  private async request(url: URL, apiKey: string): Promise<ProbeResult> {
    const started = performance.now();
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'follow',
      });
    } catch (error) {
      const latencyMs = Math.round(performance.now() - started);
      if (isTimeout(error)) {
        return failure(PROBE_CODES.timeout, `请求超时（${TIMEOUT_MS / 1000} 秒）`, {
          latencyMs,
          requestUrl: url.toString(),
        });
      }
      return failure(PROBE_CODES.networkError, reason(error), {
        latencyMs,
        requestUrl: url.toString(),
      });
    }

    const latencyMs = Math.round(performance.now() - started);
    const shared = { status: response.status, latencyMs, requestUrl: url.toString() };

    if (response.status === 401 || response.status === 403) {
      return failure(
        PROBE_CODES.unauthorized,
        `端点可达但拒绝了凭据（HTTP ${response.status}），请检查 API Key`,
        { ...shared, params: { status: response.status } },
      );
    }
    if (!response.ok) {
      return failure(PROBE_CODES.httpError, `端点返回 HTTP ${response.status}`, {
        ...shared,
        params: { status: response.status },
      });
    }

    const text = await response.text();
    if (text.length > MAX_BODY_BYTES) {
      return failure(PROBE_CODES.invalidResponse, '响应体过大，不是模型目录', shared);
    }

    const models = extractModels(text);
    if (models === null) {
      return failure(PROBE_CODES.invalidResponse, '响应不是已知的模型目录格式', shared);
    }
    return { ok: true, ...shared, models };
  }
}

function joinUrl(base: URL, suffix: string): URL {
  const next = new URL(base.toString());
  next.pathname = `${next.pathname.replace(/\/+$/, '')}/${suffix}`;
  return next;
}

function failure(code: string, message: string, extra: Partial<ProbeResult> = {}): ProbeResult {
  return { ok: false, code, message, ...extra };
}

function isTimeout(error: unknown): boolean {
  const name = (error as Error)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

function reason(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return `请求失败：${text}`;
}

/**
 * Pulls model ids out of any catalog shape in common use:
 * `{ data: [...] }` (OpenAI/Anthropic), `{ models: [...] }`, or a bare array.
 * Entries may be objects with an id/name/model field or plain strings.
 * Returns null when the body parses to none of these, distinguishing "reachable
 * but not a catalog" from "an empty but legitimate catalog" ([]).
 */
export function extractModels(body: string): string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  const list = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.data)
      ? parsed.data
      : isRecord(parsed) && Array.isArray(parsed.models)
        ? parsed.models
        : null;
  if (list === null) {
    return null;
  }

  const seen = new Set<string>();
  const models: string[] = [];
  for (const entry of list) {
    const id =
      typeof entry === 'string'
        ? entry.trim()
        : isRecord(entry)
          ? firstString(entry, ['id', 'name', 'model'])
          : '';
    if (id && !seen.has(id)) {
      seen.add(id);
      models.push(id);
      if (models.length >= MAX_MODELS) {
        break;
      }
    }
  }
  return models;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function firstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}
