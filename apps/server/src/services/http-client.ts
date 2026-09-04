import { createDecorator } from '../di';

export interface IHttpClient {
  readonly _serviceBrand: undefined;
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
}

export const IHttpClient = createDecorator<IHttpClient>('httpClient');

/**
 * The one seam every outbound request in the server process goes through, so a test can
 * inject a stub instead of reassigning `globalThis.fetch`.
 *
 * `globalThis.fetch` is read per call rather than captured in the constructor: the sandbox
 * helper still patches the global for suites that have no container to configure, and a
 * captured reference would silently bypass that patch.
 */
export class HttpClient implements IHttpClient {
  declare readonly _serviceBrand: undefined;

  fetch(input: string | URL, init?: RequestInit): Promise<Response> {
    return globalThis.fetch(input, init);
  }
}
