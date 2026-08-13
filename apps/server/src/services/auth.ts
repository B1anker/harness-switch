import { randomBytes } from 'node:crypto';
import { createDecorator, inject } from '../di';
import { ICryptoService } from './crypto';
import { IEnvironmentService } from './environment';
import { IFileService } from './files';
import { ILogService } from './log';

type Session = {
  expires: number;
};

export interface IAuthService {
  readonly _serviceBrand: undefined;
  ensurePassword(): string;
  login(password: string): string | null;
  logout(token: string | undefined): void;
  isAuthenticated(token: string | undefined): boolean;
}

export const IAuthService = createDecorator<IAuthService>('authService');

@inject(IEnvironmentService, IFileService, ICryptoService, ILogService)
export class AuthService implements IAuthService {
  declare readonly _serviceBrand: undefined;

  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly environment: IEnvironmentService,
    private readonly files: IFileService,
    private readonly crypto: ICryptoService,
    private readonly log: ILogService,
  ) {}

  ensurePassword(): string {
    const file = this.environment.files.password;
    if (!this.files.exists(file)) {
      const password = this.crypto.randomPassword();
      this.files.writeSecure(file, `${password}\n`);
      this.log.info(`Initial web password: ${password}`);
    }
    return this.files.readText(file).trim();
  }

  login(password: string): string | null {
    const expected = this.ensurePassword();
    if (!this.crypto.timingSafeEqual(password, expected)) {
      return null;
    }
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(token, { expires: Date.now() + this.environment.sessionTtlMs });
    return token;
  }

  logout(token: string | undefined): void {
    if (token) {
      this.sessions.delete(token);
    }
  }

  isAuthenticated(token: string | undefined): boolean {
    if (!token) {
      return false;
    }
    const session = this.sessions.get(token);
    if (!session || session.expires < Date.now()) {
      this.sessions.delete(token);
      return false;
    }
    return true;
  }
}
