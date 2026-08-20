export type CliFlags = Record<string, string | boolean>;

export type ParsedArgs = {
  flags: CliFlags;
  positional: string[];
};

/** Minimal `--flag` / `--flag=value` parser. Positional arguments come after flags. */
export function parseArgs(argv: string[]): ParsedArgs {
  const flags: CliFlags = {};
  const positional: string[] = [];
  const valueFlags = new Set(['user', 'from', 'to', 'harness']);
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg.startsWith('--')) {
      const body = arg.slice(2);
      const separator = body.indexOf('=');
      if (separator !== -1) {
        flags[body.slice(0, separator)] = body.slice(separator + 1);
      } else {
        const next = argv[index + 1];
        if (valueFlags.has(body) && next && !next.startsWith('--')) {
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

export function requirePositional(positional: string[], index: number, what: string): string {
  const value = positional[index];
  if (!value) {
    throw new CliError(`缺少参数：${what}`);
  }
  return value;
}

export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliError';
  }
}
