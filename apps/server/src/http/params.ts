import type { Context } from 'hono';

/**
 * A path parameter, URL-decoded.
 *
 * Every id in this API can contain characters the router leaves percent-encoded —
 * profile names hold spaces, provider ids and backup ids hold slashes — so a raw
 * `c.req.param()` would look up a name nobody stored. Decoding at one place keeps the
 * routes from each remembering to do it.
 */
export function param(c: Context, name: string): string {
  return decodeURIComponent(c.req.param(name) ?? '');
}
