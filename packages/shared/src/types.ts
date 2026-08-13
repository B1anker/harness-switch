import type { HarnessId } from './harnesses';

export type ProfilePublic = {
  harness: HarnessId;
  name: string;
  baseUrl: string;
  model: string;
  notes: string;
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
  active: ActivePublic | null;
  profiles: ProfilePublic[];
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
};

export type UpdateProfileRequest = {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  notes?: string;
};

export type ActivateResponse = {
  ok: true;
  envFile: string;
};

export type OkResponse = {
  ok: true;
};

export type ErrorResponse = {
  error: string;
};
