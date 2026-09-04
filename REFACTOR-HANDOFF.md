# Refactor handoff

Status of the multi-phase refactor agreed with the user. **Phases 2–5 remain.** Work them
in order; each phase's tests must be green before starting the next.

## Ground rules the user set

- Frontend: state consolidation goes into **domain slices composed inside one `useAppStore`** — *not* separate stores. Component selectors must keep working unchanged, so slices can migrate one at a time.
- Backend: wrap the remaining loose tools/services and consume them through DI.
- The legacy `message`/`label`/`params` compatibility window **is to be closed** (Phase 4).
- Read `CLAUDE.md` first — it holds the conventions (DI shape, error codes, localization, test-support layer).

## Baselines — do not regress

| Suite | Command | Expected |
|---|---|---|
| Server | `bun test apps/server` | **363 pass / 0 fail, 21 files** |
| Web | `npm run --workspace @seaveyon/harness-switch-web test` | **24 files / 169 tests** (re-measure before editing; it was not re-run after the server migration) |
| Types | `npm run typecheck` | clean |
| Lint | `npm run lint` | no errors (pre-existing warnings in `i18n.tsx`, `src/app.ts`, `adapters.test.ts` are fine) |

Run `npx biome format --write <paths>` after any bulk/scripted edit.

## Phase 1 — done, uncommitted

Delivered: dead code removed (`src/http/errors.ts`, `src/types.ts`, `createServiceMiddleware`);
`src/http/params.ts` with `param()`; `readOptionalJsonBody` in `src/http/validate.ts`;
`apps/server/test/support/` extracted and **all 17 former `createServices()` test call sites
migrated**; `CLAUDE.md` written.

Working tree has 27 modified files + 5 new (`src/http/params.ts`, `test/support/*`), all
verified green. **Nothing is half-edited.** Consider committing this before starting Phase 2.

One Phase-1 item was left undone by scope choice: the **web render helper** (a
`renderWithI18n` counterpart to the server `support/` layer). It is folded into Phase 5
below, since the same files get rewritten there anyway.

## Phase 2 — backend DI completion

Loose module-level functions that should become injectable services:

| New service | Wraps | Notes |
|---|---|---|
| `IUpdateService` | `src/update.ts` (`checkForUpdate`, `triggerUpdate`, `compareVersions`) | consumed by `src/http/routes/update.ts:3`, which imports the functions directly today |
| `IVersionService` | `src/version.ts` (`packageInfo`, `serverVersion`, `packageName`) | `src/app.ts:25` imports `serverVersion` directly |
| `IProbeProfileService` | `src/services/probe-profile.ts` (`probeSavedProfile` + its hand-rolled `ProfileProbeDeps` bag) | `ProfileProbeDeps` is manual DI — replace it with real injection |
| `IHttpClient` | the 5 raw `fetch(` call sites: `services/probe.ts:149,231`, `services/github-sync.ts:142,519`, `update.ts:55` | lets tests inject instead of patching `globalThis.fetch`; keep `daemon.ts:244` and `cli/client.ts` out — they are separate processes/clients |
| `JsonStore<T>` | the repeated read-parse-guard-write-atomically pattern in `journal.ts:420`, `backup.ts:373`, `profiles.ts`, `vault.ts` | each has its own `isRecord` guard; register via `new SyncDescriptor(JsonStore, ['<file>.json'])` |

Also:
- `services/transfer.ts` should use `ICryptoService` rather than its own crypto calls.
- `src/bootstrap.ts` is 24 flat eager `collection.set(...)` lines. Group them by layer (infrastructure → domain → orchestration) and pass `supportsDelayedInstantiation = true` (third `SyncDescriptor` arg, already supported — see `src/di/descriptors.ts`) for services only some requests touch.

## Phase 3 — backend layering and dedup

- **`src/http/routes/harnesses.ts` (240 lines)** — sink the summary assembly and the snapshot/rollback transaction into a service; merge the rollback path with `transfer.restore`, which duplicates it.
- **`src/http/routes/providers.ts`** — sink the PATCH handler's logic into `IVaultService`.
- **`src/app.ts` (209 lines)** — split into three: static-asset serving (`isPublicAsset` + `contentType`), the localize middleware (`localizeResponsePayload` + `isMessageParams`), and the error handler (`notFound` + `onError`). `createApp` should read as routing only.
- **Adapters** (`services/adapters/`, 1769 lines across claude 435 / dsh 460 / codex 308 / kimi 293 / pi 273) — introduce a base class; unify the five `validate` implementations; generate the Claude field table (it is a hand-written 14-entry list — see `apps/web/tests/fixtures.ts:56` for its shape) instead of enumerating it; dedup `dsh.ts`.

## Phase 4 — contract tightening

- **`services/transfer.ts` has 17 `new HttpError(...)` without a `code`** — all silently degrade to `requestFailed`. Give each a specific `ERROR_CODES` entry (add codes + both locale catalogs as needed).
- Chinese string literals used as data → constants in `packages/shared`.
- Hand-written type guards → zod schemas: `app.ts:175`, `cli/client.ts:150`, `probe.ts:531`, `codex-login-cache.ts:158`, `journal.ts:420`, `backup.ts:373`, `adapters/dsh.ts:450`.
- Frontend validation constants should be read from `packages/shared`, not re-declared.
- **Close the compat window** — `localizeResponsePayload` in `src/app.ts:155-173`. Drop the `message`/`label`/`params` emission; keep only `{ code, data, msg }` (and `noteCode`/`noteData`/`noteMsg`). This touches web components that still read `.message`/`.label`, `src/lib/messages.ts`, and both suites' fixtures — grep before cutting.

## Phase 5 — frontend state and UI

**Store** (`src/stores/app-store.ts`, 537 lines, one flat `create<AppState>`): split into domain
slices — session/users, harnesses/profiles, backups, providers, doctor/drift, scan, operations,
notice — composed inside the **same** `useAppStore`. Add a `createAsyncResource` helper: the
`{ x, xLoading, xError }` + `set loading → try/catch → 401 check → errorLine` block is repeated
7× verbatim (`loadProviders`, `loadDoctor`, `loadDrift`, `loadScan`, `loadOperations`, …).

**Components** — move remaining direct `api()` calls into the store; extract `useProbe`,
`useDeviceFlow`, `useDialogResource`.

**Split the big files**: `profile-dialog.tsx` (1162), `provider-vault-dialog.tsx` (760),
`transfer/gist-pane.tsx` (604), `dashboard-page.tsx` (455).

**Add missing primitives** to `src/components/ui/` (has: alert-dialog, badge, button, card,
checkbox, dialog, input, label, select, separator, sonner, textarea): `dropdown-menu`, `tabs`,
`form-field`, `alert`.

**Converge the `harness.id === 'dsh' | 'claude'` special-case branches** scattered through
components.

**Web test helper** (the deferred Phase-1 item) — add to `apps/web/tests/` alongside
`fixtures.ts`:
- `renderWithI18n(ui)` — 3 files wrap in `<I18nProvider>` by hand (`theme-toggle`, `i18n`, `notice-toast`).
- A fetch-stub helper — **9 files** repeat `const realFetch = globalThis.fetch` + an `afterEach` restore (`activate-dialog`, `harness-card`, `update-button`, `version-badge`, `store`, and all 4 `transfer/*`), plus two incompatible local `json()` shapes (a bare `{ ok, json }` object vs. a real `new Response`).
- A `setStoreState(partial)` helper — **8 files** cast with `as Partial<ReturnType<typeof useAppStore.getState>> as never` (13 occurrences).

Do this **with** the slice migration, not before: the same files change in both.
