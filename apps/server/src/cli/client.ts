import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { daemonDataDir } from '../daemon';
import { CliError } from './args';

export type ApiErrorPayload = {
  error?: unknown;
  code?: unknown;
  params?: unknown;
};

/**
 * Thin client over the local Web API. The CLI logs in with the password stored in
 * `web_password` (created by the first daemon start), so every command reuses the
 * server's business logic instead of duplicating it.
 */
export class CliClient {
  private cookie = '';

  constructor(
    private readonly baseUrl: string,
    private readonly password: string,
  ) {}

  async login(): Promise<void> {
    const response = await this.fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: this.password }),
    });
    const setCookie = response.headers.get('set-cookie') ?? '';
    const match = /hsw_session=([^;]+)/.exec(setCookie);
    if (!response.ok || !match) {
      if (response.ok) throw new CliError('登录失败：服务端未返回会话');
      const error = await responseError(response);
      throw new CliError(`登录失败：${error.message}`, error);
    }
    this.cookie = match[1]!;
  }

  async logout(): Promise<void> {
    if (!this.cookie) return;
    try {
      await this.request('POST', '/api/auth/logout');
    } finally {
      this.cookie = '';
    }
  }

  async get(path: string): Promise<unknown> {
    return this.request('GET', path);
  }

  async post(path: string, body?: unknown): Promise<unknown> {
    return this.request('POST', path, body);
  }

  async delete(path: string): Promise<unknown> {
    return this.request('DELETE', path);
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const response = await this.fetch(path, {
      method,
      headers: {
        Cookie: `hsw_session=${this.cookie}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const payload = (await response.json().catch(() => null)) as ApiErrorPayload | null;
    if (!response.ok) {
      throw new CliError(
        payload && typeof payload.error === 'string'
          ? payload.error
          : `请求失败：HTTP ${response.status}`,
        {
          status: response.status,
          ...(payload && typeof payload.code === 'string' ? { code: payload.code } : {}),
          ...(payload && isMessageParams(payload.params) ? { params: payload.params } : {}),
        },
      );
    }
    return payload;
  }

  private async fetch(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl}${path}`, init);
    } catch {
      throw new CliError(
        `无法连接本地服务 ${this.baseUrl}，请先启动服务（harness-switch daemon 或 server）`,
      );
    }
  }
}

export function resolveBaseUrl(): string {
  return process.env.HSW_URL || `http://127.0.0.1:${process.env.PORT || 8787}`;
}

export function readWebPassword(): string {
  const file = join(daemonDataDir(), 'web_password');
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    throw new CliError(
      `未找到 ${file}。请先运行一次服务（harness-switch daemon 或 server）生成密码，再使用 CLI。`,
    );
  }
}

async function responseError(response: Response): Promise<{
  message: string;
  status: number;
  code?: string;
  params?: Record<string, string | number | boolean>;
}> {
  try {
    const payload = (await response.json()) as ApiErrorPayload;
    return {
      message: typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`,
      status: response.status,
      ...(typeof payload.code === 'string' ? { code: payload.code } : {}),
      ...(isMessageParams(payload.params) ? { params: payload.params } : {}),
    };
  } catch {
    return { message: `HTTP ${response.status}`, status: response.status };
  }
}

function isMessageParams(value: unknown): value is Record<string, string | number | boolean> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(
      (item) => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean',
    )
  );
}
