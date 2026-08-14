import type { HarnessId } from './harnesses';

/**
 * How a harness stores providers in its own config file.
 *
 * - `replace`: the live file holds exactly one provider, so activating replaces it.
 * - `additive`: the live file holds many providers plus a "current" pointer, so
 *   activating only moves the pointer and must leave other providers untouched.
 *
 * Writing an additive file as if it were a replace file destroys the providers the
 * user configured by hand.
 */
export type HarnessMode = 'replace' | 'additive';

export type ConfigFormat = 'json' | 'toml' | 'yaml' | 'text';

export type FieldOption = {
  value: string;
  label: string;
};

/**
 * Describes one harness-specific field so the web UI can render the form without
 * duplicating each harness schema. Core fields (name, base URL, API key, model,
 * notes) are always rendered and are not part of this list.
 */
export type FieldSpec = {
  key: string;
  label: string;
  kind: 'text' | 'password' | 'select' | 'textarea';
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: FieldOption[];
  defaultValue?: string;
};

/** One native config file a harness owns. */
export type TargetSpec = {
  key: string;
  label: string;
  path: string;
  format: ConfigFormat;
};

export type ProfilePublic = {
  harness: HarnessId;
  name: string;
  baseUrl: string;
  model: string;
  notes: string;
  extras: Record<string, string>;
  /** Target keys whose content the user has taken over in the advanced editor. */
  overriddenTargets: string[];
  updatedAt: string;
};

export type ActivePublic = {
  name: string;
  baseUrl: string;
  model: string;
};

export type HarnessSummary = {
  id: HarnessId;
  label: string;
  mode: HarnessMode;
  active: ActivePublic | null;
  profiles: ProfilePublic[];
  fields: FieldSpec[];
  targets: TargetSpec[];
  /** Environment variables this harness actually honours, for the env.sh layer. */
  envVars: string[];
  /** Set when the harness ignores shell environment variables entirely. */
  envNote?: string;
};

export type HarnessesResponse = {
  envFile: string;
  items: HarnessSummary[];
};

export type SessionResponse = {
  authenticated: boolean;
};

export type LoginRequest = {
  password: string;
};

export type CreateProfileRequest = {
  name: string;
  baseUrl: string;
  apiKey?: string;
  model?: string;
  notes?: string;
  extras?: Record<string, string>;
  overrides?: Record<string, string>;
};

export type UpdateProfileRequest = {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  notes?: string;
  extras?: Record<string, string>;
  overrides?: Record<string, string>;
};

/** One rendered config file, as it would be written to disk. */
export type PreviewTarget = {
  key: string;
  label: string;
  path: string;
  format: ConfigFormat;
  content: string;
  /** True when the content comes from a user override instead of the form fields. */
  overridden: boolean;
};

export type PreviewResponse = {
  targets: PreviewTarget[];
};

export type ActivateResponse = {
  ok: true;
  envFile: string;
  /** Non-fatal problems from steps that ran after the switch already committed. */
  warnings: string[];
};

export type BackupFileEntry = {
  path: string;
  existed: boolean;
};

export type BackupEntry = {
  id: string;
  createdAt: string;
  harness: string;
  profile: string;
  files: BackupFileEntry[];
};

export type BackupsResponse = {
  items: BackupEntry[];
};

export type OkResponse = {
  ok: true;
};

export type ErrorResponse = {
  error: string;
};
