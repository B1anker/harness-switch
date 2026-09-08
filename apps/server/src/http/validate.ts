import {
  ERROR_CODES,
  isValidationCode,
  schemaFields,
  schemaIssues,
} from '@seaveyon/harness-switch-shared';
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

/**
 * The same as {@link readJsonBody} for routes whose body is entirely optional, where an
 * absent or unparsable body means "no options" rather than a bad request.
 */
export async function readOptionalJsonBody<T>(c: Context, schema: ZodType<T>): Promise<T> {
  return parseWith(schema, await c.req.json().catch(() => ({})));
}

/** Validates an already-decoded value, for path parameters and CLI input. */
export function parseWith<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = schemaIssues(result.error);
    const first = issues[0];
    // The generic "invalid request" names the fields; the first field's own reason is the
    // more useful sentence, so it becomes the code whenever the schema supplied one.
    const code = first && isValidationCode(first.code) ? first.code : ERROR_CODES.invalidRequest;
    throw new HttpError(400, `invalid request: ${first?.path || 'body'}`, {
      code,
      params: { fields: schemaFields(result.error), count: issues.length },
    });
  }
  return result.data;
}
