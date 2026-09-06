export type CliFlags = Record<string, string | boolean>;

export type ParsedArgs = {
  flags: CliFlags;
  positional: string[];
};

const VALUE_FLAGS = new Set([
  'connection',
  'profile',
  'request-id',
  'api-key',
  'api-key-env',
  'base-url',
  'endpoint',
  'from',
  'harness',
  'model',
  'name',
  'notes',
  'provider',
  'to',
  'user',
]);

const SHORT_FLAGS: Record<string, string> = {
  h: 'help',
  j: 'json',
  V: 'version',
  y: 'yes',
};

/** Small, predictable GNU-style parser used by every CLI command. */
export function parseArgs(argv: string[]): ParsedArgs {
  const flags: CliFlags = {};
  const positional: string[] = [];
  let optionsEnded = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (optionsEnded) {
      positional.push(arg);
    } else if (arg === '--') {
      optionsEnded = true;
    } else if (/^-[^-]$/.test(arg)) {
      const name = SHORT_FLAGS[arg.slice(1)];
      if (!name) {
        throw new CliError(`未知选项：${arg}`);
      }
      flags[name] = true;
    } else if (arg.startsWith('--')) {
      const body = arg.slice(2);
      if (!body) {
        throw new CliError('无效选项：--');
      }
      const separator = body.indexOf('=');
      if (separator !== -1) {
        const name = body.slice(0, separator);
        const value = body.slice(separator + 1);
        if (!VALUE_FLAGS.has(name)) {
          throw new CliError(`选项 --${name} 不接受值`);
        }
        if (!value) {
          throw new CliError(`选项 --${name} 需要一个值`);
        }
        flags[name] = value;
      } else {
        const next = argv[index + 1];
        if (VALUE_FLAGS.has(body)) {
          if (!next || next.startsWith('-')) {
            throw new CliError(`选项 --${body} 需要一个值`);
          }
          flags[body] = next;
          index++;
        } else {
          flags[body] = true;
        }
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

export function flagValue(flags: CliFlags, name: string, fallback = ''): string {
  const value = flags[name];
  return typeof value === 'string' ? value : fallback;
}

export function hasFlag(flags: CliFlags, name: string): boolean {
  return flags[name] === true || (typeof flags[name] === 'string' && flags[name] !== '');
}

export function validateFlags(flags: CliFlags, allowed: readonly string[]): void {
  const accepted = new Set(['json', 'user', ...allowed]);
  const unknown = Object.keys(flags).find((name) => !accepted.has(name));
  if (unknown) {
    throw new CliError(`未知选项：--${unknown}`);
  }
}

export function validatePositionals(
  positional: string[],
  min: number,
  max: number,
  usage: string,
): void {
  if (positional.length < min || positional.length > max) {
    throw new CliError(`用法：harness-switch ${usage}`);
  }
}

export function requirePositional(positional: string[], index: number, what: string): string {
  const value = positional[index];
  if (!value) {
    throw new CliError(`缺少参数：${what}`);
  }
  return value;
}

export class CliError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly params?: Record<string, string | number | boolean>;

  constructor(
    message: string,
    options: {
      status?: number;
      code?: string;
      params?: Record<string, string | number | boolean>;
    } = {},
  ) {
    super(message);
    this.name = 'CliError';
    this.status = options.status;
    this.code = options.code;
    this.params = options.params;
  }
}
