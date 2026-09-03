import type { CompletionProtocol } from '@seaveyon/harness-switch-shared';

/**
 * Pi and DSH both name their wire protocol in an `api` field drawn from the same value
 * set, so the mapping onto the probe's protocol names lives here rather than twice. Only
 * the spelling differs: `openai-completions` is the chat-completions endpoint.
 */
const API_FIELD_PROTOCOLS: Record<string, CompletionProtocol> = {
  'openai-completions': 'openai-chat',
  'openai-responses': 'openai-responses',
  'anthropic-messages': 'anthropic-messages',
};

/**
 * Undefined for an unrecognised value, which leaves the probe to try each protocol in
 * turn rather than confidently testing the wrong shape.
 */
export function apiFieldProtocol(
  api: string | undefined,
  fallback: CompletionProtocol,
): CompletionProtocol | undefined {
  const value = api?.trim();
  return value ? API_FIELD_PROTOCOLS[value] : fallback;
}
