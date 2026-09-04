/**
 * A stubbed `fetch`, given the resolved URL as a plain string.
 *
 * Return the JSON body and it is wrapped in a 200; return {@link status} for anything else,
 * or a `Response` when the test needs a non-JSON body.
 */
export type FetchHandler = (url: string, init: RequestInit) => unknown;

/**
 * The `fetch` installed once for the whole suite, delegating to whatever the current test
 * set through {@link stubFetch}.
 *
 * Nine files used to swap `globalThis.fetch` themselves, which meant each had to capture
 * the original first and restore it in an `afterEach`; one that forgot broke whichever
 * suite ran after it rather than itself. Routing through a single indirection lets the
 * global teardown drop the handler, so the restore cannot be missed.
 */
const realFetch = globalThis.fetch;
let handler: FetchHandler | null = null;

globalThis.fetch = ((input: string | URL | Request, init: RequestInit = {}) => {
  if (!handler) return realFetch(input as RequestInfo, init);
  return Promise.resolve(handler(requestUrl(input), init)).then(asResponse);
}) as typeof globalThis.fetch;

/** Answers requests with `next` until the test ends. */
export function stubFetch(next: FetchHandler): void {
  handler = next;
}

/** Called from the global teardown; individual tests should not need it. */
export function resetFetch(): void {
  handler = null;
}

/** A body carried by some status other than 200. */
export function status(code: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status: code,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Routes by path, answering anything unlisted with a 404.
 *
 * A route may be the body itself, or a handler for the cases that assert on what was sent
 * or answer differently on a later call.
 */
export function routes(table: Record<string, unknown>): FetchHandler {
  return (url, init) => {
    if (!(url in table)) return status(404, { code: 'notFound' });
    const route = table[url];
    return typeof route === 'function' ? (route as FetchHandler)(url, init) : route;
  };
}

/** A network that refuses every call, for asserting the offline path. */
export const OFFLINE: FetchHandler = () => {
  throw new Error('offline');
};

/** Records each request while answering through `inner`, for asserting what was sent. */
export function recordRequests(inner: FetchHandler): {
  handler: FetchHandler;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  return {
    requests,
    handler: (url, init) => {
      requests.push({ path: url, method: init.method ?? 'GET', body: String(init.body ?? '') });
      return inner(url, init);
    },
  };
}

export type RecordedRequest = { path: string; method: string; body: string };

/**
 * A handler may answer with a `Response`, a `{ ok, json }` stand-in for the components that
 * read only those two fields, or the body itself — the last being what most tests want and
 * what the two hand-rolled `json()` helpers in the old suites spelled out each time.
 */
function asResponse(value: unknown): unknown {
  if (value instanceof Response || isResponseLike(value)) return value;
  return status(200, value ?? {});
}

function isResponseLike(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'ok' in value && 'json' in value;
}

function requestUrl(input: string | URL | Request): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
