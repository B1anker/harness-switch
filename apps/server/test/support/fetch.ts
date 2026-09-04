/**
 * A stubbed `fetch`, given the resolved URL as a plain string.
 *
 * The return value is passed to the caller untouched. Several suites deliberately answer
 * with a hand-rolled `{ ok, json }` rather than a real `Response`, to prove the service
 * reads only the fields it claims to, so this must not normalise it.
 */
export type FetchHandler = (url: string, init?: RequestInit) => unknown;

/**
 * Replaces `globalThis.fetch` and returns the undo.
 *
 * Every suite that touches the network stubbed this by hand, and each one had to remember
 * to capture the original first and restore it in `afterEach` — a file that missed the
 * restore broke whichever suite ran next rather than itself. Prefer
 * {@link import('./sandbox').Sandbox.stubFetch}, which ties the undo to the sandbox and
 * cannot be forgotten; this bare form is for the few tests that stub inside one case.
 */
export function stubFetch(handler: FetchHandler): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(handler(requestUrl(input), init))) as unknown as typeof globalThis.fetch;
  return () => {
    globalThis.fetch = original;
  };
}

/** A network that refuses every call, for asserting the offline path. */
export const OFFLINE: FetchHandler = () => {
  throw new Error('offline');
};

/** Answers every call with this JSON body and a 200, the common registry-probe case. */
export function respondJson(body: unknown): FetchHandler {
  return () => ({ ok: true, status: 200, json: async () => body });
}

/**
 * Lets loopback requests through to the real network and refuses everything else.
 *
 * For suites that drive a listener of their own over HTTP — the CLI tests talk to an
 * in-process server on 127.0.0.1, while the update check underneath them must still be
 * kept off the registry. Evaluate this before installing it, so it closes over the real
 * `fetch` rather than the stub: `sandbox.stubFetch(loopbackOnly())`.
 */
export function loopbackOnly(): FetchHandler {
  const real = globalThis.fetch;
  return (url, init) => {
    if (!url.startsWith('http://127.0.0.1:') && !url.startsWith('http://localhost:')) {
      throw new Error('offline');
    }
    return real(url, init);
  };
}

function requestUrl(input: string | URL | Request): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
