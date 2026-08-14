import type { ConfigFormat } from '@seaveyon/harness-switch-shared';
import { parse as parseTomlText, stringify as stringifyTomlValue } from 'smol-toml';
import { parseDocument } from 'yaml';
import { HttpError } from '../../common/errors';

export type JsonObject = Record<string, unknown>;

export function parseJsonObject(text: string | undefined): JsonObject {
  if (!text?.trim()) {
    return {};
  }
  const parsed = JSON.parse(text) as unknown;
  return isPlainObject(parsed) ? parsed : {};
}

/**
 * Key order follows the parsed object, so merging into a user's file appends new keys
 * instead of reshuffling the whole document.
 */
export function stringifyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function parseTomlObject(text: string | undefined): JsonObject {
  if (!text?.trim()) {
    return {};
  }
  const parsed = parseTomlText(text) as unknown;
  return isPlainObject(parsed) ? parsed : {};
}

export function stringifyToml(value: JsonObject): string {
  return `${stringifyTomlValue(value)}\n`;
}

/**
 * Returns a yaml Document rather than a plain object so comments and formatting in the
 * user's file survive the merge. An absent file is parsed as empty rather than as `{}`,
 * because seeding a flow-style map makes every key added afterwards flow style too,
 * which is unreadable in a file people edit by hand.
 */
export function parseYamlDocument(text: string | undefined) {
  const document = parseDocument(text ?? '');
  if (document.errors.length > 0) {
    throw document.errors[0];
  }
  return document;
}

/**
 * Rejects content that cannot be parsed back, so a malformed override never reaches
 * disk and leaves a harness unable to start.
 */
export function assertParsable(format: ConfigFormat, path: string, content: string): void {
  try {
    if (format === 'json') {
      JSON.parse(content);
      return;
    }
    if (format === 'toml') {
      parseTomlText(content);
      return;
    }
    if (format === 'yaml') {
      const document = parseDocument(content);
      if (document.errors.length > 0) {
        throw document.errors[0];
      }
    }
  } catch (error) {
    throw new HttpError(400, `${path} is not valid ${format}: ${(error as Error).message}`);
  }
}

export function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads a nested object, creating missing levels, so callers can merge in place. */
export function ensureObject(parent: JsonObject, key: string): JsonObject {
  const existing = parent[key];
  if (isPlainObject(existing)) {
    return existing;
  }
  const created: JsonObject = {};
  parent[key] = created;
  return created;
}

export function readString(source: unknown, key: string): string {
  if (!isPlainObject(source)) {
    return '';
  }
  const value = source[key];
  return typeof value === 'string' ? value : '';
}

/**
 * Turns a profile name into an identifier usable as a config key. A name with no ASCII
 * alphanumerics at all gets a hash suffix, so two differently named profiles never
 * collapse onto the same provider entry. Reserved ids are rejected by the caller.
 */
export function slugify(value: string, fallback: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `${fallback}-${shortHash(value)}`;
}

function shortHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
