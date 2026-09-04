import { existsSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import type { Hono } from 'hono';

/**
 * Serves the built SPA, falling back to `index.html` so client-side routes resolve.
 *
 * The dev server writes `publicDir` after the API process starts, so the route is
 * registered even when the directory is absent now: a later first build becomes visible
 * without restarting the API process.
 */
export function registerAssetRoutes(app: Hono, publicDir: string): void {
  app.get('*', async (c, next) => {
    if (c.req.path.startsWith('/api') || c.req.path === '/healthz') {
      return next();
    }
    const assetPath = resolve(publicDir, c.req.path.replace(/^\//, ''));
    if (c.req.path !== '/' && isPublicAsset(publicDir, assetPath) && existsSync(assetPath)) {
      c.header('Content-Type', contentType(assetPath));
      return c.body(readFileSync(assetPath));
    }
    const index = join(publicDir, 'index.html');
    if (existsSync(index)) {
      c.header('Cache-Control', 'no-store');
      return c.html(readFileSync(index, 'utf8'));
    }
    return c.text('frontend not built', 503);
  });
}

/** Keeps a `..` traversal in the request path from reaching outside the built bundle. */
function isPublicAsset(publicDir: string, assetPath: string): boolean {
  const path = relative(publicDir, assetPath);
  return path !== '' && !path.startsWith('..') && !path.includes('..\\');
}

function contentType(path: string): string {
  switch (extname(path)) {
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.png':
      return 'image/png';
    case '.ico':
      return 'image/x-icon';
    default:
      return 'application/octet-stream';
  }
}
