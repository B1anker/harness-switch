import type {
  CompletionProtocol,
  ProbeCompletion,
  ProbeResult,
} from '@seaveyon/harness-switch-shared';
import { PROBE_CODES } from '@seaveyon/harness-switch-shared';
import { isRecord } from '../common/guards';
import { createDecorator, inject } from '../di';
import { IHttpClient } from './http-client';

export type ProbeInput = {
  baseUrl: string;
  apiKey: string;
  /**
   * Also send one minimal completion after the catalog read. Off by default: it costs
   * the user a token or two, so only an explicit ask triggers it.
   */
  completion?: boolean;
  /** Model to complete against; falls back to the first id the catalog returned. */
  model?: string;
  /** Protocol to try first. The remaining ones are still tried as fallbacks. */
  protocol?: CompletionProtocol;
};

export interface IProbeService {
  readonly _serviceBrand: undefined;
  probe(input: ProbeInput): Promise<ProbeResult>;
}

export const IProbeService = createDecorator<IProbeService>('probeService');

/** One unanswered request is enough to make a user think the feature is broken. */
const TIMEOUT_MS = 10_000;

/**
 * A completion has to wait for the model to actually run, not just for a relay to
 * answer, so it gets a longer budget than the catalog read.
 */
const COMPLETION_TIMEOUT_MS = 30_000;

/** Catalog responses are small; anything past this is treated as a malformed body. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

/** Upper bound on catalog entries kept, so a hostile endpoint cannot balloon a response. */
const MAX_MODELS = 1000;

/**
 * The smallest request each protocol accepts. One token of output is all that has to come
 * back: the point is to learn whether the model runs at all, not to read what it says.
 */
const COMPLETION_PROMPT = 'hi';
const COMPLETION_MAX_TOKENS = 1;

/** Tried in this order unless the caller names a protocol to put first. */
const COMPLETION_PROTOCOLS: readonly CompletionProtocol[] = [
  'openai-chat',
  'openai-responses',
  'anthropic-messages',
];

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
 *
 * A catalog read alone is not proof the endpoint works: relays commonly serve a full
 * `/v1/models` list and then 5xx on the models in it. `completion: true` therefore sends
 * one minimal request and reports its outcome separately, so "lists models" and "answers
 * with one" never get conflated.
 */
@inject(IHttpClient)
export class ProbeService implements IProbeService {
  declare readonly _serviceBrand: undefined;

  constructor(private readonly http: IHttpClient) {}

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

    const catalog = await this.readCatalog(base, input.apiKey);
    if (!input.completion) {
      return catalog;
    }

    // The completion runs even when the catalog failed, as long as the caller named a
    // model: plenty of relays serve no catalog at all yet complete perfectly well, and
    // reporting only "no model catalog" would hide that the endpoint actually works.
    const model = input.model?.trim() || catalog.models?.[0] || '';
    if (!model) {
      return {
        ...catalog,
        completion: completionFailure(
          PROBE_CODES.missingModel,
          '没有可用于补全测试的模型：请填写模型名称，或先获取模型目录',
        ),
      };
    }
    return { ...catalog, completion: await this.complete(base, input, model) };
  }

  /**
   * A base URL that already ends in /v1 (Codex convention) gets /models appended
   * directly; otherwise /v1/models is tried first and the bare path is the fallback.
   */
  private async readCatalog(base: URL, apiKey: string): Promise<ProbeResult> {
    const candidates = versioned(base)
      ? [joinUrl(base, 'models')]
      : [joinUrl(base, 'v1/models'), joinUrl(base, 'models')];

    let lastStatus: number | undefined;
    for (let index = 0; index < candidates.length; index++) {
      const result = await this.request(candidates[index]!, apiKey);
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
      response = await this.http.fetch(url, {
        headers: authHeaders(apiKey, { Accept: 'application/json' }),
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

    const text = await readBody(response);
    if (text === null) {
      return failure(PROBE_CODES.invalidResponse, '响应体过大，不是模型目录', shared);
    }

    const models = extractModels(text);
    if (models === null) {
      return failure(PROBE_CODES.invalidResponse, '响应不是已知的模型目录格式', shared);
    }
    return { ok: true, ...shared, models };
  }

  /**
   * Sends the smallest possible completion, trying each protocol until one is not a 404.
   *
   * A 404 is the only status that means "wrong protocol for this endpoint"; anything else
   * is the endpoint's verdict on the request we sent and ends the attempt. That matters
   * for the case this whole test exists for: a relay that lists a model and then answers
   * 500 for it must report that 500, not fall through and blame the next protocol.
   */
  private async complete(base: URL, input: ProbeInput, model: string): Promise<ProbeCompletion> {
    const protocols = ordered(input.protocol);
    let last: ProbeCompletion | undefined;
    for (let index = 0; index < protocols.length; index++) {
      const protocol = protocols[index]!;
      const attempt = await this.sendCompletion(base, input.apiKey, model, protocol);
      if (attempt.status !== 404 || index === protocols.length - 1) {
        return attempt;
      }
      last = attempt;
    }
    return (
      last ?? completionFailure(PROBE_CODES.completionUnsupported, '端点不接受任何已知的补全协议')
    );
  }

  private async sendCompletion(
    base: URL,
    apiKey: string,
    model: string,
    protocol: CompletionProtocol,
  ): Promise<ProbeCompletion> {
    const url = joinUrl(base, completionPath(base, protocol));
    const started = performance.now();
    let response: Response;
    try {
      response = await this.http.fetch(url, {
        method: 'POST',
        headers: authHeaders(apiKey, {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify(completionBody(protocol, model)),
        signal: AbortSignal.timeout(COMPLETION_TIMEOUT_MS),
        redirect: 'follow',
      });
    } catch (error) {
      const latencyMs = Math.round(performance.now() - started);
      const shared = { model, protocol, latencyMs, requestUrl: url.toString() };
      if (isTimeout(error)) {
        return completionFailure(
          PROBE_CODES.timeout,
          `补全请求超时（${COMPLETION_TIMEOUT_MS / 1000} 秒）`,
          shared,
        );
      }
      return completionFailure(PROBE_CODES.networkError, reason(error), shared);
    }

    const latencyMs = Math.round(performance.now() - started);
    const shared = {
      model,
      protocol,
      status: response.status,
      latencyMs,
      requestUrl: url.toString(),
    };

    if (response.status === 401 || response.status === 403) {
      return completionFailure(
        PROBE_CODES.unauthorized,
        `端点可达但拒绝了凭据（HTTP ${response.status}），请检查 API Key`,
        { ...shared, params: { status: response.status } },
      );
    }
    if (!response.ok) {
      // The whole point of this test: the catalog said yes, the model says no.
      return completionFailure(
        PROBE_CODES.completionHttpError,
        `模型 ${model} 的补全请求返回 HTTP ${response.status}`,
        { ...shared, params: { status: response.status, model } },
      );
    }

    const text = await readBody(response);
    if (text === null) {
      return completionFailure(PROBE_CODES.completionInvalid, '补全响应体过大', shared);
    }
    const produced = extractCompletionText(text);
    if (produced === null) {
      return completionFailure(
        PROBE_CODES.completionInvalid,
        '补全响应不是已知的格式，无法确认模型真的作答',
        shared,
      );
    }
    // An empty string is still a valid answer: `max_tokens: 1` can be spent entirely on
    // a stop token. The envelope parsing above is what proves the model ran.
    return { ok: true, ...shared, produced: produced.length > 0 };
  }
}

/**
 * Both auth conventions travel on every request. Relays ignore headers they do not know,
 * and picking only one would report healthy endpoints as broken.
 */
function authHeaders(apiKey: string, extra: Record<string, string>): Record<string, string> {
  return {
    ...extra,
    Authorization: `Bearer ${apiKey}`,
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  };
}

/** Puts the caller's preferred protocol first without dropping the fallbacks. */
function ordered(preferred: CompletionProtocol | undefined): CompletionProtocol[] {
  if (!preferred) {
    return [...COMPLETION_PROTOCOLS];
  }
  return [preferred, ...COMPLETION_PROTOCOLS.filter((item) => item !== preferred)];
}

/** Suffix relative to the base URL, with `/v1` added only when the base lacks it. */
function completionPath(base: URL, protocol: CompletionProtocol): string {
  const suffix =
    protocol === 'openai-chat'
      ? 'chat/completions'
      : protocol === 'openai-responses'
        ? 'responses'
        : 'messages';
  return versioned(base) ? suffix : `v1/${suffix}`;
}

function completionBody(protocol: CompletionProtocol, model: string): Record<string, unknown> {
  // The Responses API rejects a max_output_tokens below 16, so that protocol cannot use
  // the single-token budget the other two accept.
  if (protocol === 'openai-responses') {
    return { model, input: COMPLETION_PROMPT, max_output_tokens: 16, stream: false };
  }
  return {
    model,
    messages: [{ role: 'user', content: COMPLETION_PROMPT }],
    max_tokens: COMPLETION_MAX_TOKENS,
    stream: false,
  };
}

/** True when the base URL already carries an API version segment, e.g. `/v1`. */
function versioned(base: URL): boolean {
  const path = base.pathname.replace(/\/+$/, '');
  return /\/v\d+$/.test(path);
}

/**
 * `Response.text()` buffers the entire body before returning. Catalogs should be tiny,
 * so enforce the advertised limit while reading instead of after memory was consumed.
 */
async function readBody(response: Response): Promise<string | null> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength && Number(declaredLength) > MAX_BODY_BYTES) {
    return null;
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel('catalog body too large');
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
}

function joinUrl(base: URL, suffix: string): URL {
  const next = new URL(base.toString());
  next.pathname = `${next.pathname.replace(/\/+$/, '')}/${suffix}`;
  return next;
}

function failure(code: string, message: string, extra: Partial<ProbeResult> = {}): ProbeResult {
  return { ok: false, code, message, ...extra };
}

function completionFailure(
  code: string,
  message: string,
  extra: Partial<ProbeCompletion> = {},
): ProbeCompletion {
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

/**
 * The assistant text out of any completion envelope in common use, or null when the body
 * is not a completion at all.
 *
 * Returning `''` for a well-formed envelope that carried no text is deliberate: with
 * `max_tokens: 1` the budget can go entirely to a stop token, and that still proves the
 * model ran. Only an unrecognised shape is a failure — that is how an HTML error page or
 * a relay's own JSON error served with 200 gets caught.
 */
export function extractCompletionText(body: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }

  // A 200 carrying an `error` object is a relay reporting failure with the wrong status.
  if (isRecord(parsed.error)) {
    return null;
  }

  // OpenAI chat completions: choices[].message.content, or .text for legacy completions.
  if (Array.isArray(parsed.choices)) {
    return parsed.choices
      .map((choice) => {
        if (!isRecord(choice)) return '';
        const message = isRecord(choice.message) ? choice.message : undefined;
        return (
          contentText(message?.content) ||
          (typeof choice.text === 'string' ? choice.text : '') ||
          contentText(isRecord(choice.delta) ? choice.delta.content : undefined)
        );
      })
      .join('')
      .trim();
  }

  // Anthropic messages: content[] of typed blocks. Also covers Responses' `output[]`,
  // whose entries nest their own `content[]` array of typed blocks.
  if (Array.isArray(parsed.content)) {
    return contentText(parsed.content).trim();
  }
  if (Array.isArray(parsed.output)) {
    return parsed.output
      .map((entry) => (isRecord(entry) ? contentText(entry.content) : ''))
      .join('')
      .trim();
  }
  // Responses API convenience field, present when the SDK-shaped body is returned.
  if (typeof parsed.output_text === 'string') {
    return parsed.output_text.trim();
  }

  return null;
}

/** Text out of a `content` value, which may be a bare string or an array of blocks. */
function contentText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((block) => {
      if (typeof block === 'string') return block;
      if (!isRecord(block)) return '';
      return firstString(block, ['text', 'output_text', 'content']);
    })
    .join('');
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
