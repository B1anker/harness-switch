import { ERROR_CODES, formatSchemaError } from '@seaveyon/harness-switch-shared';
import type { Context } from 'hono';
import type { ZodType } from 'zod';
import { HttpError } from '../common/errors';

/**
 * Parses and validates a JSON request body.
 *
 * Every mutating route goes through this, so a shape the adapters cannot render is
 * rejected with a 400 naming the field instead of being persisted and resurfacing as a
 * 500 on the next activation.
 */
export async function readJsonBody<T>(c: Context, schema: ZodType<T>): Promise<T> {
  const raw = await c.req.json().catch(() => {
    throw new HttpError(400, 'invalid json', { code: ERROR_CODES.invalidRequest });
  });
  return parseWith(schema, raw);
}

/** Validates an already-decoded value, for path parameters and CLI input. */
export function parseWith<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(400, formatSchemaError(result.error), {
      code: ERROR_CODES.invalidRequest,
      params: { fields: result.error.issues.map((issue) => issue.path.join('.')).join(', ') },
    });
  }
  return result.data;
}
