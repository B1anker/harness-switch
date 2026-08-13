import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { createDecorator, inject } from '../di';
import { IEnvironmentService } from './environment';
import { IFileService } from './files';

export type EncryptedValue = {
  iv: string;
  tag: string;
  data: string;
};

export interface ICryptoService {
  readonly _serviceBrand: undefined;
  encrypt(plain: string): EncryptedValue;
  decrypt(value: EncryptedValue | Record<string, unknown>): string;
  randomPassword(bytes?: number): string;
  timingSafeEqual(left: string, right: string): boolean;
}

export const ICryptoService = createDecorator<ICryptoService>('cryptoService');

@inject(IEnvironmentService, IFileService)
export class CryptoService implements ICryptoService {
  declare readonly _serviceBrand: undefined;

  constructor(
    private readonly environment: IEnvironmentService,
    private readonly files: IFileService,
  ) {}

  encrypt(plain: string): EncryptedValue {
    const key = this.getKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return {
      iv: iv.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'),
      data: ciphertext.toString('base64url'),
    };
  }

  decrypt(value: EncryptedValue | Record<string, unknown>): string {
    try {
      const payload = value as EncryptedValue;
      if (!payload?.iv || !payload?.tag || !payload?.data) {
        return '';
      }
      const key = this.getKey();
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(payload.tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(payload.data, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      return '';
    }
  }

  randomPassword(bytes = 18): string {
    return randomBytes(bytes).toString('base64url');
  }

  timingSafeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    if (leftBuffer.byteLength !== rightBuffer.byteLength) {
      return false;
    }
    return timingSafeEqual(leftBuffer, rightBuffer);
  }

  private getKey(): Buffer {
    const file = this.environment.files.key;
    if (!this.files.exists(file)) {
      this.files.writeSecure(file, `${randomBytes(32).toString('base64url')}\n`);
    }
    return Buffer.from(this.files.readText(file).trim(), 'base64url');
  }
}
