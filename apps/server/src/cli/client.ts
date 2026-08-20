import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { daemonDataDir } from '../daemon';
import { CliError } from './args';

export type ApiErrorPayload = { error?: unknown };

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
      throw new CliError(
        response.ok ? '登录失败：服务端未返回会话' : `登录失败：${await errorMessage(response)}`,
      );
    }
    this.cookie = match[1]!;
  }

  async get(path: string): Promise<unknown> {
    return this.request('GET', path);
  }

  async post(path: string, body?: unknown): Promise<unknown> {
    return this.request('POST', path, body);
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
      const message =
        payload && typeof payload.error === 'string'
          ? payload.error
          : `请求失败：HTTP ${response.status}`;
      throw new CliError(message);
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

async function errorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as ApiErrorPayload;
    if (typeof payload.error === 'string') {
      return payload.error;
    }
  } catch {
    // fall through to status text
  }
  return `HTTP ${response.status}`;
}
