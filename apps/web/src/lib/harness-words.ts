import type { HarnessId } from '@seaveyon/harness-switch-shared';

/**
 * What a harness calls the things this app manages.
 *
 * dsh and kimi register *providers* and pick a *default* among them (`default_model` /
 * agent-default-model), where the other three keep *profiles* and *activate* one.
 * Nothing behaves differently — only the noun changes — so the check lives here instead
 * of at each of the labels that used to ask `harness.id === 'dsh'` on their own.
 */
export type HarnessWords = {
  /** Heading over the list. */
  collection: string;
  /** Heading over the currently applied entry. */
  applied: string;
  /** Badge on the entry in force. */
  appliedBadge: string;
  /** Button that puts an entry in force. */
  apply: string;
  /** Button that starts a new entry. */
  add: string;
};

const PROFILE_WORDS: HarnessWords = {
  collection: 'harness.profiles',
  applied: 'harness.activeConfig',
  appliedBadge: 'harness.active',
  apply: 'harness.activate',
  add: 'harness.newProfile',
};

const PROVIDER_WORDS: HarnessWords = {
  collection: 'harness.providers',
  applied: 'harness.defaultModel',
  appliedBadge: 'harness.default',
  apply: 'harness.setDefault',
  add: 'harness.addCustomProvider',
};

/** Harnesses whose live config is a provider table plus a default pointer. */
const PROVIDER_DEFAULT_HARNESSES: ReadonlySet<HarnessId> = new Set(['dsh', 'kimi']);

export function harnessWords(id: HarnessId): HarnessWords {
  return PROVIDER_DEFAULT_HARNESSES.has(id) ? PROVIDER_WORDS : PROFILE_WORDS;
}
