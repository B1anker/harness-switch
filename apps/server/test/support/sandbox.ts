import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type FetchHandler, stubFetch } from './fetch';

/** A path builder rooted at one directory, so callers never re-`join` a stored string. */
type PathAt = (...segments: string[]) => string;

export type Sandbox = {
  /** The temp directory the whole sandbox lives in. */
  readonly rootDir: string;
  /** What `HSW_HOME_DIR` points at — the manager's HOME for this test. */
  readonly homeDir: string;
  /** What `HSW_DATA_DIR` points at. */
  readonly dataDir: string;
  readonly root: PathAt;
  readonly home: PathAt;
  readonly data: PathAt;
  /** Sets an env variable for the sandbox's lifetime; restored by {@link dispose}. */
  setEnv(name: string, value: string | undefined): void;
  /**
   * Replaces `globalThis.fetch` for the sandbox's lifetime. Restored by {@link dispose},
   * so a suite cannot leak a stub into whichever one runs next.
   */
  stubFetch(handler: FetchHandler): void;
  dispose(): void;
};

export type SandboxOptions = {
  /**
   * Extra process env for the sandbox's lifetime. Resolved against the temp home, since
   * the interesting values — `CODEX_HOME`, `PATH` under a fake bin — are paths inside it.
   */
  env?: (home: PathAt, root: PathAt) => Record<string, string | undefined>;
  /**
   * Puts HOME in a named subdirectory instead of the temp root, leaving room beside it
   * for a second account. The multi-user suites need somewhere to stage a peer home that
   * is not inside the manager's own.
   */
  owner?: string;
};

/**
 * A throwaway HOME with the environment aimed at it.
 *
 * Every server test needs the same four things: a temp directory, `HSW_HOME_DIR` and
 * `HSW_DATA_DIR` pointing inside it, whichever harness-home overrides the test cares
 * about, and a teardown that puts the environment back. Inline, that was a `let homeDir`
 * plus a `beforeEach`/`afterEach` pair per file differing only in the mkdtemp prefix —
 * and a file that forgot one `delete process.env.X` leaked it into whatever suite ran
 * next, which is the kind of failure that only shows up in a full-run ordering.
 */
export function createSandbox(prefix: string, options: SandboxOptions = {}): Sandbox {
  const rootDir = mkdtempSync(join(tmpdir(), prefix.endsWith('-') ? prefix : `${prefix}-`));
  const root: PathAt = (...segments) => join(rootDir, ...segments);
  const homeDir = options.owner ? root(options.owner) : rootDir;
  const home: PathAt = (...segments) => join(homeDir, ...segments);
  const dataDir = home('.harness-switch');
  const data: PathAt = (...segments) => join(dataDir, ...segments);
  if (options.owner) {
    mkdirSync(homeDir, { recursive: true });
  }

  const restore = new Map<string, string | undefined>();
  const setEnv = (name: string, value: string | undefined): void => {
    if (!restore.has(name)) {
      restore.set(name, process.env[name]);
    }
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  };

  setEnv('HSW_HOME_DIR', homeDir);
  setEnv('HSW_DATA_DIR', dataDir);
  for (const [name, value] of Object.entries(options.env?.(home, root) ?? {})) {
    setEnv(name, value);
  }

  let restoreFetch: (() => void) | undefined;

  return {
    rootDir,
    homeDir,
    dataDir,
    root,
    home,
    data,
    setEnv,
    stubFetch(handler: FetchHandler): void {
      const undo = stubFetch(handler);
      // Keep the first original: re-stubbing mid-test must still restore the real fetch.
      restoreFetch ??= undo;
    },
    dispose(): void {
      restoreFetch?.();
      restoreFetch = undefined;
      for (const [name, value] of restore) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      restore.clear();
      rmSync(rootDir, { recursive: true, force: true });
    },
  };
}
