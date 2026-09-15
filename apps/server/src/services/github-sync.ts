import {
  ERROR_CODES,
  type GitHubDeviceCodeResponse,
  type GitHubDevicePollResponse,
  type GitHubPullPreviewResponse,
  type GitHubPushResponse,
  type GitHubSyncStatus,
  HARNESS_IDS,
  type TransferConflictPolicy,
  type TransferEnvelope,
  type TransferImportResponse,
  transferEnvelopeSchema,
} from '@seaveyon/harness-switch-shared';
import { z } from 'zod';
import { HttpError } from '../common/errors';
import { createDecorator, inject } from '../di';
import { encryptedValueSchema, ICryptoService } from './crypto';
import { IEnvironmentService } from './environment';
import { IFileService } from './files';
import { IHttpClient } from './http-client';
import { ILogService } from './log';
import { IProfileService } from './profiles';
import { ITransferService } from './transfer';
import { IVaultService } from './vault';

const DEFAULT_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '178c6fc778ccc68e1d6a';
const GIST_FILENAME = 'harness-switch-backup.json';
const GIST_DESCRIPTION = 'harness-switch sync vault (Encrypted backup)';
const USER_AGENT = 'harness-switch';

const githubStoreSchema = z.object({
  token: encryptedValueSchema.optional(),
  username: z.string().optional(),
  avatarUrl: z.string().optional(),
  gistId: z.string().optional(),
  lastSyncedAt: z.string().optional(),
});

type GitHubStore = z.infer<typeof githubStoreSchema>;

/**
 * Only the fields this service reads. GitHub's payloads carry far more; a schema that
 * named them all would break on every additive API change, so unknown keys are dropped.
 */
const githubGistFileSchema = z.object({
  content: z.string().optional(),
  raw_url: z.string().optional(),
  truncated: z.boolean().optional(),
});

const githubGistSchema = z.object({
  id: z.string(),
  updated_at: z.string(),
  files: z.record(z.string(), githubGistFileSchema),
});

type GitHubGist = z.infer<typeof githubGistSchema>;

const githubUserSchema = z.object({
  login: z.string(),
  avatar_url: z.string().optional().default(''),
});

const deviceCodeResponseSchema = z.object({
  device_code: z.string(),
  user_code: z.string(),
  verification_uri: z.string(),
  expires_in: z.number(),
  interval: z.number(),
});

/** Both an OAuth error and a grant come back as 200, so the two shapes share one schema. */
const accessTokenResponseSchema = z.object({
  access_token: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
  interval: z.number().optional(),
});

/** Free-form `{ error, error_description }` GitHub returns beside a 4xx or a device-flow 200. */
const githubErrorSchema = z.object({
  error: z.string().optional(),
  error_description: z.string().optional(),
  message: z.string().optional(),
});

export interface IGitHubSyncService {
  readonly _serviceBrand: undefined;
  getStatus(): Promise<GitHubSyncStatus>;
  getDeviceCode(clientId?: string): Promise<GitHubDeviceCodeResponse>;
  pollDeviceCode(deviceCode: string, clientId?: string): Promise<GitHubDevicePollResponse>;
  authenticateWithToken(token: string): Promise<GitHubSyncStatus>;
  disconnect(): void;
  push(passphrase: string, includeCodexLoginCache?: boolean): Promise<GitHubPushResponse>;
  pullPreview(
    passphrase: string,
    conflictPolicy?: TransferConflictPolicy,
    restoreActive?: boolean,
  ): Promise<GitHubPullPreviewResponse>;
  pull(
    passphrase: string,
    conflictPolicy?: TransferConflictPolicy,
    restoreActive?: boolean,
    migrateCodexLoginCache?: boolean,
  ): Promise<TransferImportResponse>;
}

export const IGitHubSyncService = createDecorator<IGitHubSyncService>('githubSyncService');

@inject(
  IEnvironmentService,
  IFileService,
  ICryptoService,
  ITransferService,
  IProfileService,
  IVaultService,
  ILogService,
  IHttpClient,
)
export class GitHubSyncService implements IGitHubSyncService {
  declare readonly _serviceBrand: undefined;

  constructor(
    private readonly environment: IEnvironmentService,
    private readonly files: IFileService,
    private readonly crypto: ICryptoService,
    private readonly transfer: ITransferService,
    private readonly profiles: IProfileService,
    private readonly vault: IVaultService,
    private readonly log: ILogService,
    private readonly http: IHttpClient,
  ) {}

  private readStore(): GitHubStore {
    // Tolerant on purpose: this file only caches a connection. A store that no longer
    // parses reads as "not connected", and the next login rewrites it.
    const parsed = githubStoreSchema.safeParse(
      this.files.readJson<unknown>(this.environment.files.github, {}),
    );
    return parsed.success ? parsed.data : {};
  }

  private writeStore(store: GitHubStore): void {
    this.files.writeJson(this.environment.files.github, store);
  }

  private getToken(): string | undefined {
    const store = this.readStore();
    if (!store.token) {
      return undefined;
    }
    const token = this.crypto.decrypt(store.token);
    return token ? token.trim() : undefined;
  }

  private requireToken(): string {
    const token = this.getToken();
    if (!token) {
      throw new HttpError(401, '未连接 GitHub，请先登录', { code: ERROR_CODES.githubNotConnected });
    }
    return token;
  }

  private countAllProfiles(): number {
    return HARNESS_IDS.reduce((acc, harness) => acc + this.profiles.list(harness).length, 0);
  }

  private async githubFetch<T>(
    path: string,
    schema: z.ZodType<T>,
    options: RequestInit = {},
    token?: string,
  ): Promise<T> {
    const bearer = token || this.requireToken();
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': USER_AGENT,
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${bearer}`,
      ...(options.headers as Record<string, string>),
    };

    const url = path.startsWith('http') ? path : `https://api.github.com${path}`;
    const response = await this.http.fetch(url, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      throw new HttpError(401, 'GitHub 授权已失效或无效，请重新登录', {
        code: ERROR_CODES.githubAuthFailed,
      });
    }
    if (response.status === 403) {
      const remaining = response.headers.get('x-ratelimit-remaining');
      if (remaining === '0') {
        throw new HttpError(403, 'GitHub API 请求速率超限，请稍后再试', {
          code: ERROR_CODES.githubRateLimitExceeded,
        });
      }
    }
    if (!response.ok) {
      const errorText = await response.text();
      let errorMsg = `GitHub 请求失败 (${response.status})`;
      try {
        const errorJson = githubErrorSchema.safeParse(JSON.parse(errorText));
        if (errorJson.success && errorJson.data.message) {
          errorMsg = `GitHub: ${errorJson.data.message}`;
        }
      } catch {
        // use default error message
      }
      throw new HttpError(response.status, errorMsg, { code: ERROR_CODES.requestFailed });
    }

    return this.parseResponse(schema, await response.json());
  }

  /** A payload GitHub sent but this service cannot read is a failed request, not a crash. */
  private parseResponse<T>(schema: z.ZodType<T>, payload: unknown): T {
    const parsed = schema.safeParse(payload);
    if (parsed.success) {
      return parsed.data;
    }
    this.log.warn(`[github-sync] unexpected response shape: ${parsed.error.issues[0]?.message}`);
    throw new HttpError(502, 'GitHub 返回了无法识别的响应', {
      code: ERROR_CODES.githubUnexpectedResponse,
    });
  }

  async getStatus(): Promise<GitHubSyncStatus> {
    const store = this.readStore();
    const token = this.getToken();
    if (!token) {
      return { connected: false };
    }

    try {
      const user = await this.githubFetch('/user', githubUserSchema, {}, token);
      let gistId = store.gistId;
      let gistUpdatedAt: string | undefined;

      if (gistId) {
        try {
          const gist = await this.githubFetch(`/gists/${gistId}`, githubGistSchema, {}, token);
          gistUpdatedAt = gist.updated_at;
        } catch {
          // Gist might have been deleted on GitHub
          gistId = undefined;
        }
      }

      if (!gistId) {
        const existingGist = await this.findSyncGist(token);
        if (existingGist) {
          gistId = existingGist.id;
          gistUpdatedAt = existingGist.updated_at;
          this.writeStore({
            ...store,
            username: user.login,
            avatarUrl: user.avatar_url,
            gistId,
          });
        }
      }

      return {
        connected: true,
        username: user.login,
        avatarUrl: user.avatar_url,
        gistId,
        gistUpdatedAt,
        lastSyncedAt: store.lastSyncedAt,
      };
    } catch {
      return { connected: false };
    }
  }

  private async findSyncGist(token: string): Promise<GitHubGist | undefined> {
    try {
      const gists = await this.githubFetch(
        '/gists?per_page=100',
        z.array(githubGistSchema),
        {},
        token,
      );
      return gists.find((g) => g.files && Boolean(g.files[GIST_FILENAME]));
    } catch {
      return undefined;
    }
  }

  async getDeviceCode(clientId?: string): Promise<GitHubDeviceCodeResponse> {
    const id = clientId || DEFAULT_CLIENT_ID;
    let response: Response;
    try {
      response = await this.http.fetch('https://github.com/login/device/code', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
        },
        body: JSON.stringify({
          client_id: id,
          scope: 'gist',
        }),
      });
    } catch (error) {
      this.log.warn(`[github-sync] getDeviceCode network error: ${String(error)}`);
      throw new HttpError(502, '无法连接 GitHub，请检查网络或代理后重试', {
        code: ERROR_CODES.requestFailed,
      });
    }

    if (!response.ok) {
      throw new HttpError(response.status, '获取 GitHub 设备验证码失败', {
        code: ERROR_CODES.requestFailed,
      });
    }

    const payload: unknown = await response.json();
    const failure = githubErrorSchema.safeParse(payload);
    if (failure.success && failure.data.error) {
      throw new HttpError(400, failure.data.error_description || failure.data.error, {
        code: ERROR_CODES.githubAuthFailed,
      });
    }
    const data = this.parseResponse(deviceCodeResponseSchema, payload);

    return {
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      expiresIn: data.expires_in,
      interval: data.interval,
    };
  }

  async pollDeviceCode(deviceCode: string, clientId?: string): Promise<GitHubDevicePollResponse> {
    const id = clientId || DEFAULT_CLIENT_ID;
    let response: Response;
    try {
      response = await this.http.fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
        },
        body: JSON.stringify({
          client_id: id,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      });
    } catch (error) {
      // Transient TLS/network failures (e.g. Bun UNKNOWN_CERTIFICATE_VERIFICATION_ERROR)
      // are common against github.com; keep polling instead of failing the flow.
      this.log.warn(`[github-sync] pollDeviceCode network error: ${String(error)}`);
      return { status: 'pending' };
    }

    if (!response.ok) {
      return { status: 'error', error: 'GitHub 认证请求失败' };
    }

    const parsed = accessTokenResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      return { status: 'error', error: 'GitHub 返回了无法识别的响应' };
    }
    const data = parsed.data;

    if (data.error) {
      this.log.info(
        `[github-sync] pollDeviceCode error response: ${data.error} - ${data.error_description || ''}`,
      );
      if (data.error === 'authorization_pending') {
        return { status: 'pending', interval: data.interval };
      }
      if (data.error === 'slow_down') {
        // According to GitHub OAuth spec, add 5 seconds on slow_down
        const nextInterval = (data.interval || 5) + 5;
        return { status: 'pending', interval: nextInterval };
      }
      if (data.error === 'expired_token') {
        return { status: 'expired', error: '设备码已过期，请重新获取' };
      }
      if (data.error === 'access_denied') {
        return { status: 'error', error: '已拒绝授权请求' };
      }
      return { status: 'error', error: data.error_description || data.error };
    }

    if (data.access_token) {
      this.log.info('[github-sync] Device code authorized successfully, saving token');
      let username: string | undefined;
      let avatarUrl: string | undefined;
      try {
        const user = await this.githubFetch('/user', githubUserSchema, {}, data.access_token);
        username = user.login;
        avatarUrl = user.avatar_url;
      } catch (e) {
        this.log.warn(`[github-sync] 获取用户信息失败: ${String(e)}`);
      }
      this.saveToken(data.access_token, username, avatarUrl);
      return { status: 'authorized', username };
    }

    return { status: 'error', error: '未返回有效令牌' };
  }

  async authenticateWithToken(token: string): Promise<GitHubSyncStatus> {
    const trimmed = token.trim();
    if (!trimmed) {
      throw new HttpError(400, 'Token 不能为空', { code: ERROR_CODES.githubAuthFailed });
    }

    const user = await this.githubFetch('/user', githubUserSchema, {}, trimmed);
    this.saveToken(trimmed, user.login, user.avatar_url);
    return this.getStatus();
  }

  private saveToken(token: string, username?: string, avatarUrl?: string): void {
    const store = this.readStore();
    const encryptedToken = this.crypto.encrypt(token);

    this.writeStore({
      ...store,
      token: encryptedToken,
      username: username || store.username,
      avatarUrl: avatarUrl || store.avatarUrl,
    });
  }

  disconnect(): void {
    const store = this.readStore();
    this.writeStore({
      ...store,
      token: undefined,
      username: undefined,
      avatarUrl: undefined,
    });
  }

  async push(passphrase: string, includeCodexLoginCache = true): Promise<GitHubPushResponse> {
    const token = this.requireToken();
    const envelope = this.transfer.exportAll(passphrase, includeCodexLoginCache);
    const content = JSON.stringify(envelope, null, 2);

    const store = this.readStore();
    let gistId = store.gistId;

    if (gistId) {
      try {
        const updatedGist = await this.githubFetch(
          `/gists/${gistId}`,
          githubGistSchema,
          {
            method: 'PATCH',
            body: JSON.stringify({
              description: GIST_DESCRIPTION,
              files: {
                [GIST_FILENAME]: { content },
              },
            }),
          },
          token,
        );
        const now = new Date().toISOString();
        this.writeStore({ ...store, gistId: updatedGist.id, lastSyncedAt: now });
        return {
          ok: true,
          gistId: updatedGist.id,
          gistUpdatedAt: updatedGist.updated_at,
          lastSyncedAt: now,
          exportedProfilesCount: this.countAllProfiles(),
          exportedVaultCount: this.vault.list().length,
        };
      } catch (err) {
        this.log.warn(`[github-sync] 更新 Gist 失败，尝试重新查找或创建: ${String(err)}`);
        gistId = undefined;
      }
    }

    const existingGist = await this.findSyncGist(token);
    if (existingGist) {
      const updatedGist = await this.githubFetch(
        `/gists/${existingGist.id}`,
        githubGistSchema,
        {
          method: 'PATCH',
          body: JSON.stringify({
            description: GIST_DESCRIPTION,
            files: {
              [GIST_FILENAME]: { content },
            },
          }),
        },
        token,
      );
      const now = new Date().toISOString();
      this.writeStore({ ...store, gistId: updatedGist.id, lastSyncedAt: now });
      return {
        ok: true,
        gistId: updatedGist.id,
        gistUpdatedAt: updatedGist.updated_at,
        lastSyncedAt: now,
        exportedProfilesCount: this.countAllProfiles(),
        exportedVaultCount: this.vault.list().length,
      };
    }

    const newGist = await this.githubFetch(
      '/gists',
      githubGistSchema,
      {
        method: 'POST',
        body: JSON.stringify({
          description: GIST_DESCRIPTION,
          public: false,
          files: {
            [GIST_FILENAME]: { content },
          },
        }),
      },
      token,
    );

    const now = new Date().toISOString();
    this.writeStore({ ...store, gistId: newGist.id, lastSyncedAt: now });

    return {
      ok: true,
      gistId: newGist.id,
      gistUpdatedAt: newGist.updated_at,
      lastSyncedAt: now,
      exportedProfilesCount: this.countAllProfiles(),
      exportedVaultCount: this.vault.list().length,
    };
  }

  private async fetchGistEnvelope(
    token: string,
  ): Promise<{ envelope: TransferEnvelope; updatedAt: string }> {
    const store = this.readStore();
    let gistId = store.gistId;

    if (!gistId) {
      const existing = await this.findSyncGist(token);
      if (!existing) {
        throw new HttpError(404, '云端未找到 harness-switch 同步备份 Gist', {
          code: ERROR_CODES.githubGistNotFound,
        });
      }
      gistId = existing.id;
      this.writeStore({ ...store, gistId });
    }

    const gist = await this.githubFetch(`/gists/${gistId}`, githubGistSchema, {}, token);
    const file = gist.files?.[GIST_FILENAME];
    if (!file) {
      throw new HttpError(404, 'Gist 中未找到配置文件', {
        code: ERROR_CODES.githubGistNotFound,
      });
    }

    let rawContent = file.content;
    if (file.truncated && file.raw_url) {
      const rawRes = await this.http.fetch(file.raw_url, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': USER_AGENT },
      });
      if (rawRes.ok) {
        rawContent = await rawRes.text();
      }
    }

    if (!rawContent) {
      throw new HttpError(400, '云端备份文件内容为空', {
        code: ERROR_CODES.transferEnvelopeInvalid,
      });
    }

    try {
      // A gist is editable by hand and by any other tool holding the token, so it gets
      // the same validation as an uploaded file rather than a check on `format` alone.
      return {
        envelope: transferEnvelopeSchema.parse(JSON.parse(rawContent)),
        updatedAt: gist.updated_at,
      };
    } catch {
      throw new HttpError(400, '云端备份文件损坏或非有效 JSON', {
        code: ERROR_CODES.transferEnvelopeInvalid,
      });
    }
  }

  async pullPreview(
    passphrase: string,
    conflictPolicy: TransferConflictPolicy = 'skip',
    restoreActive = false,
  ): Promise<GitHubPullPreviewResponse> {
    const token = this.requireToken();
    const { envelope, updatedAt } = await this.fetchGistEnvelope(token);
    const preview = this.transfer.preview(envelope, passphrase, conflictPolicy, restoreActive);
    return {
      gistUpdatedAt: updatedAt,
      preview,
    };
  }

  async pull(
    passphrase: string,
    conflictPolicy: TransferConflictPolicy = 'skip',
    restoreActive = false,
    migrateCodexLoginCache = true,
  ): Promise<TransferImportResponse> {
    const token = this.requireToken();
    const { envelope } = await this.fetchGistEnvelope(token);
    const result = this.transfer.importAll(
      envelope,
      passphrase,
      conflictPolicy,
      restoreActive,
      migrateCodexLoginCache,
    );
    const store = this.readStore();
    this.writeStore({ ...store, lastSyncedAt: new Date().toISOString() });
    return result;
  }
}
