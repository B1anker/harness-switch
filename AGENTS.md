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
bun test apps/server # server suite (bun test)
npm run --workspace @seaveyon/harness-switch-web test # web suite (rstest)
npm run typecheck # both tsc projects
npm run lint # oxlint
npx biome check --write <paths> # formatter + import order; run after bulk edits
```

The shell here is fish. Wrap every command in `bash -c '...'`.

## Server architecture

`main.ts` → `bootstrap.ts` builds the service graph → `app.ts` mounts middleware and
`http/routes/*`. Nothing else knows how the graph is wired.

- `di/` — the container. `createDecorator`, `ServiceCollection`, `SyncDescriptor`,
  `InstantiationService`.
- `services/` — all domain logic, one concern per file. `adapters/` is the only subtree:
  one file per harness over a shared `base.ts`, which owns validation and field tables.
- `http/` — thin route handlers plus the middleware they share (`assets`, `localize`,
  `error-handler`, `params`, `validate`).
- `common/` — `errors.ts` (`HttpError`), `localize.ts`, `paths.ts`, `guards.ts`.
- `cli/` — the terminal front end, over the same services.

**DI.** Services are registered in `bootstrap.ts` and consumed by identifier, never
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
`common/errors.ts` with an explicit `code` from `ERROR_CODES` (shared package). A missing
code silently degrades to `requestFailed` — always pass one.

**Messages.** Responses carry `{ code, data, msg }` and nothing else: a service emits a
code plus its interpolation data, and the middleware in `app.ts` resolves `msg` from the
catalog per `Accept-Language`. The same shape applies to the prefixed variants
(`noteCode`/`noteData`/`noteMsg`, `blockCode`/…). Never hand-write user-facing prose in a
service or a route — add a catalog key in `packages/shared/src/locales` (**both** `zh-CN`
and `en`, they must stay key-for-key equal). `catalogKey()` decides the namespace, so a
new code group needs one line there rather than a prefix at each call site.

**Untrusted input** — anything read off disk or off the network — is parsed with a zod
schema, not a hand-written type guard. Schemas live in `packages/shared/src/schemas.ts`
when a client also needs them, beside the service otherwise.

**Routes** stay thin. Use `param(c, name)` from `http/params.ts` and
`readJsonBody`/`readOptionalJsonBody` from `http/validate.ts`; domain logic belongs in a
service.

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

const context = await createTestApp(); // boots the graph, logs in, keeps the cookie
await context.post('/api/harnesses/claude/profiles', body);
const summary = await context.json<HarnessSummary>('/api/harnesses/claude');
```

- `createSandbox(prefix, opts)` — temp HOME + data dir, auto-restoring env, `home()`/`data()`/`root()` path helpers, `setEnv`, `stubFetch`; `dispose()` undoes all of it.
- `createTestApp({ services? })` — pass a graph you adjusted first when a service must be stubbed before any route observes it.
- `createTestServices()` — graph only, for suites that never make a request.
- `restartApp()` / `loginAgain()` / `asSession()` — process-restart and multi-session cases.
- `stubFetch`, `OFFLINE`, `respondJson`, `loopbackOnly()` — network control.
- `expectHttpError(response, code)` — asserts the error contract, not the prose.

## Web architecture

`stores/` — one `useAppStore`, assembled in `app-store.ts` from `slices/*`. A slice is a
file boundary, not a state boundary: each is written against the whole `AppState`, because
loading harnesses refreshes drift and adopting drift reloads harnesses. A
`{ x, xLoading, xError }` collection is loaded through `loadResource` from `resource.ts`,
which owns the flag, the failure and the expired-session path.

Components read the store through selectors and call its actions; they do not call `api()`
for anything the store owns, and do not keep server data in `useState`. `lib/api.ts` owns
every path — never write an API path as a literal at a call site.

`components/ui/` holds the primitives. Reach for them before writing markup:
`form-field` (label + control + error, and the `aria-*` wiring between them), `alert`,
`tabs` (`TabList`/`TabPanel` for panels, `SegmentedControl` for a mode switch),
`dropdown-menu`, plus the Radix-backed dialog/select/checkbox family.

A component over ~300 lines becomes a directory with an `index.tsx` and the parts it was
already made of — see `profile-dialog/`, `provider-vault-dialog/`, `transfer/gist-pane/`.
Stateful behaviour worth a second reader goes in a hook (`lib/use-probe.ts`,
`gist-pane/use-device-flow.ts`).

Behaviour that differs only in wording between harnesses belongs in `lib/harness-words.ts`,
not in a `harness.id === 'dsh'` branch at the label.

## Web tests

`apps/web/tests/support/` mirrors the server layer; `rstest.setup.ts` restores fetch and
the store after every test, so no file does that itself.

- `stubFetch(handler)` — the handler gets `(url, init)` and returns the JSON body directly; `status(code, body)` for anything but a 200, `routes({...})` to answer per path, `recordRequests(inner)` to assert what was sent, `OFFLINE` to refuse.
- `setStoreState(partial)` / `stubStoreActions([...])` — seed state, record actions.
- `renderWithI18n(ui)` — for components that resolve their own prose.
- `harnessFixture`, `profileFixture`, `providerFixture`, `driftSummaryFixture`, `doctorReportFixture`, … — fixtures, never inline literals.

## Rules that matter

- **Never log or echo secret values.** Plaintext keys flow through `GET /api/providers/:id/reveal`, and encrypted envelopes/OAuth tokens through `transfer.ts` and `github-sync.ts`. Tests assert non-leakage — keep those assertions when touching those files.
- Locale catalogs must stay key-for-key identical between `zh-CN` and `en`.
- Every user-visible string is a catalog key. No Chinese (or English) literals as data in
  server or web source — use constants from `packages/shared`.
- Comments explain **why**, not what. Match the surrounding density; don't narrate the diff.
- Keep the four baselines green — server tests, web tests, typecheck, lint — and commit
  once they are, rather than at the end of a long branch.
