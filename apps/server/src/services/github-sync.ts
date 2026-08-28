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
} from '@seaveyon/harness-switch-shared';
import { HttpError } from '../common/errors';
import { createDecorator, inject } from '../di';
import { type EncryptedValue, ICryptoService } from './crypto';
import { IEnvironmentService } from './environment';
import { IFileService } from './files';
import { ILogService } from './log';
import { IProfileService } from './profiles';
import { ITransferService } from './transfer';
import { IVaultService } from './vault';

const DEFAULT_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '178c6fc778ccc68e1d6a';
const GIST_FILENAME = 'harness-switch-backup.json';
const GIST_DESCRIPTION = 'harness-switch sync vault (Encrypted backup)';
const USER_AGENT = 'harness-switch';

type GitHubStore = {
  token?: EncryptedValue;
  username?: string;
  avatarUrl?: string;
  gistId?: string;
  lastSyncedAt?: string;
};

type GitHubGistFile = {
  filename?: string;
  content?: string;
  raw_url?: string;
  truncated?: boolean;
};

type GitHubGist = {
  id: string;
  description: string;
  updated_at: string;
  files: Record<string, GitHubGistFile>;
};

type GitHubUser = {
  login: string;
  avatar_url: string;
};

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
  ) {}

  private readStore(): GitHubStore {
    return this.files.readJson<GitHubStore>(this.environment.files.github, {});
  }

  private writeStore(store: GitHubStore): void {
    this.files.writeJson(this.environment.files.github, store);
  }

  private getToken(): string | undefined {
    const store = this.readStore();
    if (!store.token) return undefined;
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
    const response = await fetch(url, {
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
        const errorJson = JSON.parse(errorText) as { message?: string };
        if (errorJson.message) {
          errorMsg = `GitHub: ${errorJson.message}`;
        }
      } catch {
        // use default error message
      }
      throw new HttpError(response.status, errorMsg, { code: ERROR_CODES.requestFailed });
    }

    return (await response.json()) as T;
  }

  async getStatus(): Promise<GitHubSyncStatus> {
    const store = this.readStore();
    const token = this.getToken();
    if (!token) {
      return { connected: false };
    }

    try {
      const user = await this.githubFetch<GitHubUser>('/user', {}, token);
      let gistId = store.gistId;
      let gistUpdatedAt: string | undefined;

      if (gistId) {
        try {
          const gist = await this.githubFetch<GitHubGist>(`/gists/${gistId}`, {}, token);
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
      const gists = await this.githubFetch<GitHubGist[]>('/gists?per_page=100', {}, token);
      return gists.find((g) => g.files && Boolean(g.files[GIST_FILENAME]));
    } catch {
      return undefined;
    }
  }

  async getDeviceCode(clientId?: string): Promise<GitHubDeviceCodeResponse> {
    const id = clientId || DEFAULT_CLIENT_ID;
    const response = await fetch('https://github.com/login/device/code', {
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

    if (!response.ok) {
      throw new HttpError(response.status, '获取 GitHub 设备验证码失败', {
        code: ERROR_CODES.requestFailed,
      });
    }

    const data = (await response.json()) as {
      device_code: string;
      user_code: string;
      verification_uri: string;
      expires_in: number;
      interval: number;
      error?: string;
      error_description?: string;
    };

    if (data.error) {
      throw new HttpError(400, data.error_description || data.error, {
        code: ERROR_CODES.githubAuthFailed,
      });
    }

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
    const response = await fetch('https://github.com/login/oauth/access_token', {
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

    if (!response.ok) {
      return { status: 'error', error: 'GitHub 认证请求失败' };
    }

    const data = (await response.json()) as {
      access_token?: string;
      token_type?: string;
      scope?: string;
      error?: string;
      error_description?: string;
      interval?: number;
    };

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
        const user = await this.githubFetch<GitHubUser>('/user', {}, data.access_token);
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

    const user = await this.githubFetch<GitHubUser>('/user', {}, trimmed);
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

  async push(passphrase: string, includeCodexLoginCache = false): Promise<GitHubPushResponse> {
    const token = this.requireToken();
    const envelope = this.transfer.exportAll(passphrase, includeCodexLoginCache);
    const content = JSON.stringify(envelope, null, 2);

    const store = this.readStore();
    let gistId = store.gistId;

    if (gistId) {
      try {
        const updatedGist = await this.githubFetch<GitHubGist>(
          `/gists/${gistId}`,
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
      const updatedGist = await this.githubFetch<GitHubGist>(
        `/gists/${existingGist.id}`,
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

    const newGist = await this.githubFetch<GitHubGist>(
      '/gists',
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

    const gist = await this.githubFetch<GitHubGist>(`/gists/${gistId}`, {}, token);
    const file = gist.files?.[GIST_FILENAME];
    if (!file) {
      throw new HttpError(404, 'Gist 中未找到配置文件', {
        code: ERROR_CODES.githubGistNotFound,
      });
    }

    let rawContent = file.content;
    if (file.truncated && file.raw_url) {
      const rawRes = await fetch(file.raw_url, {
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
      const envelope = JSON.parse(rawContent) as TransferEnvelope;
      if (envelope.format !== 'harness-switch-encrypted-export') {
        throw new HttpError(400, '不支持的备份文件格式', {
          code: ERROR_CODES.transferEnvelopeInvalid,
        });
      }
      return { envelope, updatedAt: gist.updated_at };
    } catch (err) {
      if (err instanceof HttpError) throw err;
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
    migrateCodexLoginCache = false,
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
