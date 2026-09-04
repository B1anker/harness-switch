import type { HarnessId } from '@seaveyon/harness-switch-shared';

/**
 * What a harness calls the things this app manages.
 *
 * dsh registers *providers* and picks a *default* among them, where the other four keep
 * *profiles* and *activate* one. Nothing behaves differently — only the noun changes — so
 * the check lives here instead of at each of the six labels that used to ask
 * `harness.id === 'dsh'` on their own.
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

export function harnessWords(id: HarnessId): HarnessWords {
  return id === 'dsh' ? PROVIDER_WORDS : PROFILE_WORDS;
}
