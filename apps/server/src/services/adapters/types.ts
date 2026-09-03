import type {
  CompletionProtocol,
  FieldSpec,
  HarnessId,
  HarnessMode,
  ProfilePublic,
  TargetSpec,
} from '@seaveyon/harness-switch-shared';
import type { DetectedProfile } from './detect';

/** The profile values an adapter renders from. */
export type AdapterProfile = {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  extras: Record<string, string>;
};

/** One native config file an adapter owns. */
export type AdapterTarget = TargetSpec;

/**
 * Existing content of every target, keyed by target key. `undefined` means the file
 * does not exist yet, which matters for rollback: those files must be deleted rather
 * than truncated when a write fails.
 */
export type CurrentFiles = Record<string, string | undefined>;

/** Rendered content per target key. */
export type RenderedFiles = Record<string, string>;

/** Adapter-only metadata used by the API to project a public OfficialEntry. */
export type OfficialCapability = {
  kind: 'account-login' | 'native-api';
  available: boolean;
  titleCode: string;
  hintCode: string;
  matchesProfile?: (profile: ProfilePublic) => boolean;
};

export interface HarnessAdapter {
  readonly id: HarnessId;
  readonly mode: HarnessMode;
  /** Harness-specific form fields; core fields are handled by the caller. */
  readonly fields: FieldSpec[];
  /** Whether the shared model field must be filled before this adapter can render. */
  readonly modelRequired?: boolean;
  /** Names of the env vars this harness honours, for display. Empty when it honours none. */
  readonly envVarNames: string[];
  /** Explains why the env.sh layer cannot help, when it cannot. */
  readonly envNote?: string;
  /** Catalog key for {@link HarnessAdapter.envNote}, so the UI can localize it. */
  readonly envNoteCode?: string;

  /**
   * Environment variables to emit into env.sh for this profile. Empty when the harness
   * never reads credentials from the shell, so the file stays truthful.
   */
  envVars(profile: AdapterProfile): Record<string, string>;

  /**
   * Wire protocol this profile would actually be called over, so a completion probe
   * tests the same shape the tool will use rather than guessing. Undefined when the
   * harness's protocol cannot be determined from the profile, which leaves the probe
   * to try each protocol in turn.
   */
  completionProtocol?(profile: AdapterProfile): CompletionProtocol | undefined;

  /**
   * Every live file this harness may own. `render` decides which ones it actually
   * writes, so a mode that leaves a file alone simply omits it.
   */
  targets(): AdapterTarget[];

  /** Rejects profiles this harness cannot express, before anything is stored or written. */
  validate?(profile: AdapterProfile): void;

  /** Produce the full content of every target for this profile. */
  render(profile: AdapterProfile, current: CurrentFiles): RenderedFiles;

  /** Add or update an additive entry without changing the harness's current default. */
  renderAvailable?(profile: AdapterProfile, current: CurrentFiles): RenderedFiles;

  /**
   * Remove this manager's provider routing and return control to the harness's built-in
   * account login. Only implemented by harnesses with a native official login flow.
   */
  renderOfficial?(profile: AdapterProfile | undefined, current: CurrentFiles): RenderedFiles;

  /** Describe the native official route without leaking its storage details to the UI. */
  official?(current: CurrentFiles): OfficialCapability | undefined;
  /** Set only when official-route detection needs to inspect native config files. */
  readonly officialNeedsCurrent?: boolean;

  /**
   * Additive mode only: drop this profile's provider entry from the live files, used
   * when the profile is deleted so no orphan provider is left behind.
   */
  revoke?(profile: AdapterProfile, current: CurrentFiles): RenderedFiles;

  /**
   * Read the live files back into profile values so hand edits made directly in the
   * CLI tool survive a switch. Only returns keys it can confidently recover.
   */
  backfill?(profile: AdapterProfile, current: CurrentFiles): Partial<AdapterProfile>;

  /**
   * Enumerate the providers already configured in the tool's own files, for the import
   * wizard. Unlike `backfill` this has no profile to tell it where to look, so an
   * additive harness reports one candidate per provider entry it finds.
   */
  detect?(current: CurrentFiles): DetectedProfile[];
}
