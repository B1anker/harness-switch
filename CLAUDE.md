# harness-switch — working notes for agents

A local control plane that switches the API configuration of five coding harnesses
(claude, codex, kimi, pi, dsh) by writing their **native config files**. Not a proxy —
no model traffic passes through it.

## Layout

| Path | What lives there |
|---|---|
| `apps/server` | Hono API + CLI + daemon, Bun runtime, VSCode-style DI |
| `apps/web` | React 19 SPA, rspack, Tailwind 4, Radix, zustand |
| `packages/shared` | Types, zod schemas, message-code constants, locale catalogs |

## Commands

```bash
bun test apps/server                              # server suite (bun test)
npm run --workspace @seaveyon/harness-switch-web test   # web suite (rstest)
npm run typecheck                                 # both tsc projects
npm run lint                                      # oxlint
npx biome format --write <paths>                  # formatter; run after bulk edits
```

The shell here is fish. Wrap every command in `bash -c '...'`.

## Server conventions

**DI.** Services are registered in `src/bootstrap.ts` and consumed by identifier, never
imported concretely across service boundaries:

```ts
export interface IDriftService {
  readonly _serviceBrand: undefined;
  inspect(harness: HarnessId): DriftSummary;
}
export const IDriftService = createDecorator<IDriftService>('driftService');

@inject(IFileService, IProfileService)
export class DriftService implements IDriftService {
  declare readonly _serviceBrand: undefined;
  constructor(private readonly files: IFileService, ...) {}
}
```

`SyncDescriptor` takes `(ctor, staticArguments?, supportsDelayedInstantiation?)`. Anything
only some requests touch should be delayed.

**Errors.** Everything crossing the HTTP boundary throws `HttpError` from
`src/common/errors.ts` with an explicit `code` from `ERROR_CODES` (shared package). A
missing code silently degrades to `requestFailed` — always pass one.

**Localization.** Responses carry `{ code, data, msg }`. Route handlers emit codes; the
middleware in `src/app.ts` resolves `msg` from the catalog per `Accept-Language`. Never
hand-write user-facing prose in a route — add a catalog key in `packages/shared/src/locales`
(**both** `zh-CN` and `en`, they must stay key-for-key equal).

**Routes.** Use `param(c, name)` from `src/http/params.ts` and
`readJsonBody`/`readOptionalJsonBody` from `src/http/validate.ts`. Routes stay thin —
domain logic belongs in a service.

## Server tests

`apps/server/test/support/` is the shared layer; no test should build a temp HOME, an app,
or a fetch stub by hand.

```ts
import { createSandbox, createTestApp, type Sandbox, type TestApp } from './support';

let sandbox: Sandbox;
beforeEach(() => {
  sandbox = createSandbox('hsw-x', { env: (home) => ({ CODEX_HOME: home('.codex') }) });
});
afterEach(() => sandbox.dispose());

const context = await createTestApp();          // boots the graph, logs in, keeps the cookie
await context.post('/api/harnesses/claude/profiles', body);
const summary = await context.json<HarnessSummary>('/api/harnesses/claude');
```

- `createSandbox(prefix, opts)` — temp HOME + data dir, auto-restoring env, `home()`/`data()`/`root()` path helpers, `setEnv`, `stubFetch`; `dispose()` undoes all of it.
- `createTestApp({ services? })` — pass a graph you adjusted first when a service must be stubbed before any route observes it.
- `createTestServices()` — graph only, for suites that never make a request.
- `restartApp()` / `loginAgain()` / `asSession()` — process-restart and multi-session cases.
- `stubFetch`, `OFFLINE`, `respondJson`, `loopbackOnly()` — network control. `loopbackOnly()` is for suites running their own `Bun.serve` listener.
- `expectHttpError(response, code)` — asserts the error contract, not the prose.

## Web conventions

All server state lives in `useAppStore` (`src/stores/app-store.ts`). Components read via
selectors and call store actions; they do not call `api()` directly and do not hold server
data in `useState`. `src/lib/api.ts` owns path builders (`profilePath`, `driftPath`, …) —
never interpolate an API path at a call site.

Web tests use fixtures from `tests/fixtures.ts` (`harnessFixture`, `profileFixture`,
`providerFixture`, `driftSummaryFixture`, `doctorReportFixture`, `stubStoreActions`).

## Rules that matter

- **Never log or echo secret values.** Plaintext keys flow through `GET /api/providers/:id/reveal`, and encrypted envelopes/OAuth tokens through `transfer.ts` and `github-sync.ts`. Tests assert non-leakage — keep those assertions when touching those files.
- Locale catalogs must stay key-for-key identical between `zh-CN` and `en`.
- Every user-visible string is a catalog key. No Chinese (or English) literals as data in
  server or web source — use constants from `packages/shared`.
- Comments explain **why**, not what. Match the surrounding density; don't narrate the diff.
