import { describe, expect, test } from 'bun:test';
import {
  assertParsable,
  ensureObject,
  isPlainObject,
  parseJsonObject,
  parseTomlObject,
  parseYamlDocument,
  readString,
  slugify,
  stringifyJson,
  stringifyToml,
} from '../src/services/adapters/serialize';

describe('json helpers', () => {
  test('treats missing, blank and non-object content as an empty object', () => {
    expect(parseJsonObject(undefined)).toEqual({});
    expect(parseJsonObject('   ')).toEqual({});
    expect(parseJsonObject('[1,2]')).toEqual({});
    expect(parseJsonObject('"text"')).toEqual({});
  });

  test('propagates malformed json so the caller can refuse to write it', () => {
    expect(() => parseJsonObject('{ nope')).toThrow();
  });

  test('keeps the original key order and appends new keys at the end', () => {
    const settings = parseJsonObject('{"z":1,"a":2}');
    settings.m = 3;
    expect(stringifyJson(settings)).toBe('{\n  "z": 1,\n  "a": 2,\n  "m": 3\n}\n');
  });
});

describe('toml helpers', () => {
  test('round trips a nested table', () => {
    const parsed = parseTomlObject('[providers.a]\nkey = "value"\n');
    expect(parseTomlObject(stringifyToml(parsed))).toEqual(parsed);
  });

  test('reads an absent file as empty', () => {
    expect(parseTomlObject(undefined)).toEqual({});
    expect(parseTomlObject('\n')).toEqual({});
  });
});

describe('yaml helpers', () => {
  test('preserves comments through a round trip', () => {
    const document = parseYamlDocument('# keep me\nproviders:\n  a: 1\n');
    document.setIn(['providers', 'b'], 2);
    expect(document.toString()).toContain('# keep me');
  });

  test('rejects content the parser cannot read', () => {
    expect(() => parseYamlDocument('a:\n- b\n  c: 1\n')).toThrow();
  });
});

describe('assertParsable', () => {
  test('accepts valid content for each format', () => {
    expect(() => assertParsable('json', '/tmp/a.json', '{"a":1}')).not.toThrow();
    expect(() => assertParsable('toml', '/tmp/a.toml', 'a = 1')).not.toThrow();
    expect(() => assertParsable('yaml', '/tmp/a.yml', 'a: 1')).not.toThrow();
    expect(() => assertParsable('text', '/tmp/a.txt', 'anything at all')).not.toThrow();
  });

  test('names the file and the format when content is unusable', () => {
    expect(() => assertParsable('json', '/tmp/settings.json', '{ nope')).toThrow(
      /\/tmp\/settings\.json is not valid json/,
    );
    expect(() => assertParsable('toml', '/tmp/config.toml', 'a =')).toThrow(/not valid toml/);
    expect(() => assertParsable('yaml', '/tmp/models.yml', 'a:\n- b\n  c: 1\n')).toThrow(
      /not valid yaml/,
    );
  });

  test('reports a 400 rather than a crash, since the content came from the user', () => {
    try {
      assertParsable('json', '/tmp/a.json', 'nope');
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as { status?: number }).status).toBe(400);
    }
  });
});

describe('object helpers', () => {
  test('ensureObject reuses an existing table and replaces a non-table', () => {
    const parent: Record<string, unknown> = { keep: { a: 1 }, scalar: 'no' };
    const kept = ensureObject(parent, 'keep');
    kept.b = 2;
    expect(parent.keep).toEqual({ a: 1, b: 2 });

    expect(ensureObject(parent, 'scalar')).toEqual({});
    expect(ensureObject(parent, 'fresh')).toEqual({});
    expect(parent.fresh).toBeDefined();
  });

  test('readString only returns actual strings', () => {
    expect(readString({ a: 'value' }, 'a')).toBe('value');
    expect(readString({ a: 7 }, 'a')).toBe('');
    expect(readString(undefined, 'a')).toBe('');
    expect(readString('not an object', 'a')).toBe('');
  });

  test('isPlainObject rejects arrays and null', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
  });
});

describe('slugify', () => {
  test('produces a config-safe id', () => {
    expect(slugify('OpenRouter Main', 'provider')).toBe('openrouter-main');
    expect(slugify('  spaced  ', 'provider')).toBe('spaced');
    expect(slugify('keep_under-score', 'provider')).toBe('keep_under-score');
  });

  test('strips dots, which TOML would read as a nested table', () => {
    expect(slugify('gpt-4.1', 'provider')).toBe('gpt-4-1');
  });

  test('falls back to a per-name hash so distinct names stay distinct', () => {
    const first = slugify('主力', 'provider');
    const second = slugify('备用', 'provider');
    expect(first).toStartWith('provider-');
    expect(first).not.toBe(second);
    // Stable across calls, otherwise a profile would lose track of its own entry.
    expect(slugify('主力', 'provider')).toBe(first);
  });
});
