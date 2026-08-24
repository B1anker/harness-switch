# harness-switch

[![npm version](https://img.shields.io/npm/v/%40seaveyon%2Fharness-switch.svg)](https://www.npmjs.com/package/@seaveyon/harness-switch)

English | [简体中文](https://github.com/B1anker/harness-switch/blob/main/README.zh-CN.md)

**harness-switch** is a local control plane for switching the API configuration used by **Claude Code**, **Codex**, **Kimi Code**, **Pi**, and **DeepSeek Harness (DSH)**. Run it on the computer that runs those tools; open its browser UI, choose a saved profile, and activate it.

It writes the tools’ native configuration files directly. It is not a proxy, never receives model traffic, and does not need you to source a shell script.

## What you get

| Capability | What it means |
|---|---|
| One profile per provider or use case | Switch base URL, key, model, and harness-specific options from one UI. |
| Safe native-file writes | Every activation is validated, transactional, backed up, and can be undone. |
| Credential reuse | Store a key once in Provider Vault and reuse it across profiles. |
| Import, export, and sync | Adopt existing configs, move encrypted bundles between machines, or copy config between Unix users. |
| Diagnostics | Compare the active profile with live files, detect drift, and re-apply or adopt changes. |

## Compatibility

| Area | Support |
|---|---|
| Operating systems | macOS, Windows, Linux |
| Runtime | Node.js >= 18.17 or Bun >= 1.2 |
| Browser access | Open `http://127.0.0.1:8787` on the same machine by default |
| Remote access | Optional SSH tunnel or a properly secured reverse proxy |
| Multiple local users | Unix-like hosts; Windows manages the account that starts the service |

## Get started

Start with any package runner:

```bash
npx -y @seaveyon/harness-switch@latest
pnpm dlx @seaveyon/harness-switch@latest
bunx @seaveyon/harness-switch@latest
```

`pnpx @seaveyon/harness-switch@latest` is also supported where `pnpx` is available. Or install it globally:

```bash
npm install -g @seaveyon/harness-switch
# pnpm add -g @seaveyon/harness-switch
# bun add -g @seaveyon/harness-switch
harness-switch
```

The command starts a background daemon on `127.0.0.1:8787` and prints the path to the generated Web password. Then:

1. Open [http://127.0.0.1:8787](http://127.0.0.1:8787) in a browser on that machine.
2. Sign in with the generated password.
3. Create a profile for one harness and select **Activate**.

Use `harness-switch status` to see the URL, log, data directory, and password-file location. On macOS and Linux, the default password file is:

```bash
cat ~/.harness-switch/web_password
```

### Accessing a remote machine

SSH is optional. When harness-switch runs on a remote or headless host, keep it bound to loopback and forward the port:

```bash
ssh -N -L 8787:127.0.0.1:8787 user@your-server
```

Then open <http://127.0.0.1:8787> in your local browser. Use `harness-switch status`, `stop`, or `server` to inspect, stop, or run the service in the foreground.

### Interface language

The web UI supports English and Simplified Chinese. Use the language button in the login page or dashboard header to switch languages. Chinese remains the default for existing behavior; your selection is stored in the browser and is reused on later visits. The setting affects only the web interface—it does not change profile data or generated configuration files.

## Switch a tool

Create one or more profiles per harness in the web UI. A profile holds a display name, API Base URL, API key, model, notes, and whatever extra fields that harness needs. Select **Activate** to make a profile current.

Activation writes each tool's own configuration file. Changes apply to the machine where harness-switch runs; it cannot change a tool already running elsewhere.

| Harness | File written | Write mode | Takes effect |
|---|---|---|---|
| Claude Code | `~/.claude/settings.json` (`env` block) | replace | Immediately; Claude Code re-reads the file and its `env` values win over inherited shell variables |
| Codex | `$CODEX_HOME/config.toml`, plus `auth.json` only if you pick that auth mode | replace | Next `codex` start |
| Kimi Code | `$KIMI_CODE_HOME/config.toml` (`~/.kimi-code`) | additive | Next `kimi` start |
| Pi | `~/.pi/agent/models.json` and `settings.json` | additive | Next `pi` start |
| DeepSeek Harness | `$DSH_HOME/settings.yaml` and `.credentials.yaml` (`~/.dsh`) | additive | Hot reload; default applies to new sessions |

**Replace mode** means the file holds exactly one provider, so activating replaces it. **Additive mode** means the file holds many providers plus a pointer to the current one, so activating only moves that pointer and leaves providers you wrote by hand alone.

Notes on individual harnesses:

- **Claude Code** defaults to `ANTHROPIC_AUTH_TOKEN`, which is what most third-party relays require. Switch the profile to `ANTHROPIC_API_KEY` for the official API.
- **Codex** defaults to putting the token in `config.toml` as `experimental_bearer_token`. The alternative that writes `auth.json` will overwrite your ChatGPT login cache, so it is opt-in; the previous `auth.json` is captured in a backup first either way.
- **Kimi Code** (`~/.kimi-code`) is a different product from Kimi CLI (`~/.kimi`), even though both provide a `kimi` command. This project targets Kimi Code, which does not read credentials from the shell at all.
- **Pi** (`@earendil-works/pi-coding-agent`) registers a custom provider in `models.json` and points `settings.json` at it via `defaultProvider` / `defaultModel`. The API key must live in that provider entry (or `auth.json`); otherwise Pi shows "No models available" and asks for `/login`. A `--model` flag still overrides the default at runtime.
- **DeepSeek Harness** registers a custom `llm-pi-ai` provider, stores the API key in its separate credentials document, and updates `agent-default-model`. Existing sessions keep their selected route; newly created sessions use the activated profile.

`~/.harness-switch/env.sh` is only a compatibility layer for Codex’s environment-variable auth mode:

```bash
source ~/.harness-switch/env.sh
```

Keep in mind:

- Writing TOML goes through parse and re-serialize, so comments and layout in `config.toml` are lost. YAML and JSON keep their comments and key order.
- It cannot rewrite the environment of an already-running shell.

### Advanced: taking over the raw file

Any field the form does not expose can be set by editing the raw file content in the profile's **Advanced: raw configuration** section. Once edited, that file is generated from your text instead of the form fields until you select **Restore automatic generation**. Content that cannot be parsed back is rejected before it reaches disk.

## Keep changes safe

Before every write, the previous content of each target file is snapshotted into `~/.harness-switch/backups/`, keeping the most recent 10. The backup panel restores a snapshot verbatim, comments included. Snapshots never land next to the live file, because tools like Claude Code scan their own config directory.

A write either lands completely or not at all: content is validated first, and a failure part way through restores the previous state, deleting files that did not exist before rather than leaving them empty. A restore carries the same guarantee and snapshots the live files it is about to overwrite, so the restore itself can be undone.

Backup directories live in the managed user's own home, so on a root-run service that account can rewrite its own manifests. Nothing in a manifest is therefore treated as a destination: it records the harness and the target key, the path is re-derived from that harness's adapter at restore time, and a payload name has to be a plain regular file inside the backup directory. Any path that resolves outside the user's manageable directories — a `~/.claude` symlinked elsewhere, for instance — is refused for both reads and writes.

Switching away from a profile first reads the live file back into that profile's record, so edits you made directly in the CLI tool are not lost on the next switch.

### Recovery after an interrupted write

An in-process `try/catch` only covers a thrown error. A power cut, SIGKILL, OOM or an upgrade restart never gives it the chance to run, and the native config, the profile store and the recorded active profile can be left describing three different states.

So before any native file is written, a record lands in `~/.harness-switch/journal/` and advances with the operation:

```
PREPARED → APPLYING → METADATA_COMMITTED → COMMITTED
                              ↘ ROLLED_BACK / DEGRADED
```

On startup the service settles whatever it finds, for every account it may manage. The boundary that matters is `METADATA_COMMITTED`: by then everything the operation set out to change is already on disk, so it rolls forward to `COMMITTED` rather than undoing a switch the user saw succeed. Anything still at `APPLYING` may be half written and is rolled back whole. A rollback that itself fails is recorded as `DEGRADED` and surfaced in the UI for a human.

Writing `active.json` now happens inside the same transaction as the native files, so the config on disk and the record of what is live can no longer disagree. Each record doubles as a receipt: the files it changed, the backup id, the target user and where it got to. Each harness’s right-hand **Operation history** card lists them and offers a one-click undo that puts the native files *and* `active.json` back together, rather than just restoring a few files. The undo takes its own snapshot first. Once a backup has been rotated away, its receipt is automatically marked as no longer undoable.

`HSW_JOURNAL_RETAIN` controls how many receipts are kept; the default is 50.

## Bring in and move configuration

### Import configuration you already have

If you configured these tools by hand before installing harness-switch, **Import existing config** in the top bar adopts that setup instead of making you retype it.

The scan reads what the five tools currently have on disk and lists every provider it finds. The additive tools (Codex, Kimi Code, Pi, DeepSeek Harness) report one candidate per provider entry, with the one currently in use flagged; Claude Code holds a single routing, so it yields at most one. Credentials are not returned with the scan — the UI only ever sees a mask — and an import re-reads them from disk server-side, so the plaintext never passes through the browser.

Each candidate is decided on its own: store it as a standalone profile, or extract the credential into the Provider Vault and reference it. When the vault already holds the identical credential, the wizard offers to reuse that entry instead of creating a duplicate. A name collision is skipped unless you explicitly ask to overwrite. Some providers read their key from the environment instead of a file (Codex's `env_key` mode, for example); those have nothing on disk to import, so the wizard asks you to supply one.

**Neither the scan nor the import touches the tools' own config files.** An import writes only to harness-switch's own profile store and vault; making it take effect still requires an explicit activation. A config file that exists but cannot be parsed causes that tool to be skipped with a reason, rather than guessed at.

### Move profiles to another machine

Use **Import / Export** in the top bar to create one `.hsw-backup` file containing every Harness profile, Provider Vault credential and endpoint, API key, raw-file override, and current activation choice. The bundle is encrypted with a migration password you choose, so it does not depend on the source machine's `aes-256-gcm.key`.

On the destination machine, select the bundle and enter the migration password. The UI shows profile counts, credential counts, and same-name profile conflicts before it writes anything. Import keeps destination profiles by default; overwriting is an explicit choice. Provider Vault entries are always restored as isolated copies and never replace a destination credential; an ID conflict gets a new imported ID, and imported profiles reference that copy. Restoring the exported activation state is optional.

A Codex official-login cache (`$CODEX_HOME/auth.json`) is **excluded by default**. When a valid cache is available, you may explicitly include it in the encrypted bundle. Import offers the separate migration choice only when the bundled and destination JSON values differ. This carries a reusable Codex/ChatGPT login session: share such a bundle only with a trusted recipient, and expect upstream expiry or revocation to still require a fresh `codex login`. An existing destination cache is backed up before replacement; copied caches are written as the destination user with mode `0600`.

Keep the migration password separately from the bundle. It cannot be recovered from the export file.

### Reuse credentials with Provider Vault

The **Provider Vault** stores an API key once under a named entry with one or more named endpoints (each a base URL), encrypted with the same AES-256-GCM key that protects `profiles.json`. A profile can reference a vault entry instead of carrying its own key:

- The vault owns the credential; the profile keeps a materialized cache so existing readers (transfer export, `active.json`, `env.sh`) keep working unchanged.
- Rotating the vault key or an endpoint re-applies every **active** profile that references the entry, so the live files follow immediately. Failures are reported as warnings.
- An entry that is referenced by any profile cannot be deleted (HTTP `409`).
- Detach a profile by clearing the provider selection in the profile form; the cached key stays as the profile's own inline key.

## Verify and repair configuration

### Test endpoint connectivity

Every place a credential meets a base URL offers a **Test connection** button: the profile form (draft values, before saving), each Provider Vault entry (stored credential, against any of its endpoints), and Doctor's `--probe`. The server sends one lightweight `GET {base}/v1/models` request — falling back to `{base}/models`, and carrying both `Authorization: Bearer` and Anthropic-style headers, so OpenAI- and Anthropic-shaped relays both work.

The result reports latency and translates one stable code (`probe.timeout`, `probe.unauthorized`, …) instead of a raw stack trace. A successful probe also returns the endpoint's **model catalog**, which fills the model field's dropdown in the profile form — no more mistyped model names discovered only when the CLI fails. The credential itself never appears in any response; draft keys are tested server-side without saving them first.

### Detect configuration drift

The dashboard **Diagnostics** panel also compares what the active profile would render against the actual files on disk, using parsed-value comparison for JSON/TOML/YAML so a re-render that only reorders keys does not count as drift. Each file is reported as:

- `in-sync` — disk matches what the profile would write,
- `drifted` — disk differs from what the profile would write,
- `missing` — the file does not exist yet,
- `invalid` — the live file cannot be parsed,
- `unknown` — nothing is active for this tool (official-login `text` files cannot be verified).

Two repair actions are offered per harness:

- **Re-apply** rewrites the live files from the active profile, with the usual backup-before-write and all-or-nothing rollback.
- **Adopt live configuration** reads the live files back into the profile record (same path as the pre-switch backfill). It refuses with `409` when the profile has manual raw overrides, and never adopts content the tool itself could not parse.

### Run diagnostics

**Diagnostics (Doctor)** run per harness from that tool’s right-hand column: for CLI-delivered tools, whether the executable is on `PATH` (`install`; skipped for web-service harnesses such as DeepSeek Harness), whether each target file exists and is readable/writable (`files`, with a warning when a config file holding credentials is group/other-readable), whether the files parse (`parse`), and whether live state drifts from the active profile (`drift`). A global update check reports whether a newer release exists (`updatedAvailable`).

Passing `--probe` adds one more check per harness: a real request against the active profile's endpoint. Reachable endpoints report `ok` with latency and model count; timeouts, refused credentials and other failures report `error`, since the tool itself would fail too. Harnesses without an active profile skip the check as `unknown`. Probes for all harnesses run concurrently.

## Manage local Unix users

This optional multi-user feature is for Unix-like hosts. On Windows, harness-switch manages the account that starts it.

The account menu at the right of the dashboard header switches between local login users such as `root` and `alice`, and keeps sign-out alongside those identity actions. Each user has independent profiles, Provider Vault, encryption key, active state and backups under their own home. Selecting a user does not write any harness file; only an explicit activation does.

“Sync user config” performs a one-time copy of another user's profiles and referenced Provider Vault credentials into the selected user. Secrets are decrypted only on the server and re-encrypted with the destination user's local key. Active state, backups and native config files are not copied. Same-name profiles are skipped by default and can be explicitly overwritten.

A source user's Codex official-login cache (`auth.json`) is the sole optional exception. The migration choice appears only when the source and destination JSON values differ; it remains unchecked by default and requires an irreversible confirmation that identifies both users. Choose it only when the destination user is allowed to use that login session. The previous destination cache is backed up, and the replacement is destination-owned with mode `0600`; source ownership and permissions are never copied.

Cross-user writes require access to the destination home. Managing both `root` and regular users therefore normally requires running harness-switch as root; newly created files and directories are assigned to the destination UID/GID. The Web password then grants control over every exposed user's configs, so keep the loopback bind and SSH tunnel. Use `HSW_USERS=root,alice` to restrict the manageable accounts.

## Automate with the CLI

The CLI talks to the running local daemon and uses the same authenticated HTTP API as the Web UI. Start the daemon once before using API-backed commands. `help` and `version` work offline; data commands support `--json` (or `-j`) for scripting:

```bash
harness-switch list                          # harnesses, active profile, profile counts
harness-switch profiles [claude]             # secret-free profile list, optionally filtered
harness-switch create claude main \
  --base-url https://api.example.com/v1 \
  --model claude-sonnet-4-5 \
  --api-key-env ANTHROPIC_TOKEN              # safer than putting a key in shell history
harness-switch providers                     # Provider Vault entries
harness-switch doctor                        # read-only diagnostics
harness-switch doctor --strict --harness claude  # exit 1 if a check has error status
harness-switch plan claude main              # exact native files activation would write
harness-switch activate claude main --yes    # activate a profile
harness-switch official claude --yes         # return to the tool's built-in login
harness-switch delete claude old --yes        # inactive profiles only
harness-switch users                         # manageable local Unix users
harness-switch list --user alice             # inspect alice's independent store
harness-switch activate codex main --user alice --yes
harness-switch sync --from root --to alice   # one-time copy; skips conflicts
harness-switch sync --from root --to alice --overwrite
harness-switch sync --from root --to alice --copy-codex-auth  # explicitly copy Codex auth.json
harness-switch scan                          # providers the five tools already have on disk
harness-switch import codex:alpha --name main   # save as a profile; tools untouched
harness-switch import claude:claude --vault  # extract the credential into the vault
harness-switch operations                    # operation receipts, newest first
harness-switch undo <operation-id>           # revert one complete operation
```

`plan <harness> <profile>` includes exact rendered content and therefore may include an API key. Mutating commands prompt on a TTY and require `--yes` in non-interactive terminals (CI). Prefer `--api-key-env VAR` to `--api-key VALUE` so credentials do not enter shell history or the process list. Run `harness-switch help` for the complete command reference. `HSW_URL` selects a non-default local endpoint; `HSW_DATA_DIR` tells the CLI where to find `web_password`.

JSON failures retain the HTTP status and stable server error code when available. Each CLI invocation logs out its temporary API session before exiting, so repeated automation does not grow the persisted Web session table.

## Security

The service defaults to loopback only. Do **not** expose the management port directly to the public Internet. Use SSH port forwarding or a TLS-enabled reverse proxy with additional access control.

API keys are encrypted with AES-256-GCM in `~/.harness-switch/profiles.json`; the local encryption key lives in `~/.harness-switch/aes-256-gcm.key`. Those files, the generated password, and `env.sh` are stored with permissions set to `0600` on POSIX systems. When writing a harness's own configuration file, existing permissions are preserved and newly created files start at `0600`.

Web sessions live in `~/.harness-switch/sessions.json` (also `0600`) so restarting the service does not log you out. Only a SHA-256 digest of each session token is stored, so the file cannot be replayed as a cookie, and the table is tied to a fingerprint of the password that issued it: replacing `web_password` invalidates every existing session.

Two places deliberately expose a key to an authenticated session: the raw config preview and the generated files themselves must contain the credential to be useful. Profile listings never echo it.

This protects against accidental plaintext disclosure in profile storage, but does not replace host-level controls such as disk encryption and a secure Unix account.

## Environment variables

| Variable | Default | Purpose |
|---|---:|---|
| `HOST` | `127.0.0.1` | Bind address. Keep the default when using SSH tunnelling. |
| `PORT` | `8787` | Listening port. |
| `HSW_URL` | `http://127.0.0.1:$PORT` | Base URL used by API-backed CLI commands. |
| `HSW_DATA_DIR` | `~/.harness-switch` | Control-plane and service-owner data directory; other users use `.harness-switch` in their own home. |
| `HSW_HOME_DIR` | `$HOME` | Service owner's home override, mainly for tests and containers. |
| `HSW_USERS` | auto-discovered | Comma-separated allowlist such as `root,alice`. The service owner is always manageable. |
| `HSW_UPDATE_CHECK` | `1` | Set to `0` to skip npm registry update checks. The local development command sets this automatically. |
| `HSW_SESSION_TTL_HOURS` | `24` | How long a Web login stays valid. Sessions survive a service restart. |
| `HSW_BACKUP_RETAIN` | `10` | Number of snapshots to keep. |
| `HSW_JOURNAL_RETAIN` | `50` | Number of operation receipts to keep. |
| `HSW_PUBLIC_DIR` | auto | Optional override for the built frontend directory. |

The tools' own overrides are honoured when locating their config: `CODEX_HOME`, `KIMI_CODE_HOME`, and `PI_CODING_AGENT_DIR`.

## HTTP API

The UI is a React SPA. Authentication uses an HttpOnly `hsw_session` cookie.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/healthz` | Liveness |
| `POST` | `/api/auth/login` | `{ "password": "..." }` |
| `POST` | `/api/auth/logout` | Clears the session cookie |
| `GET` | `/api/auth/session` | `401` when unauthenticated |
| `GET` | `/api/users` | Manageable local users and the user selected by this session |
| `POST` | `/api/users/:username/select` | Select the target user for this Web session without writing harness files |
| `POST` | `/api/users/sync/preview` | Preview counts and conflicts for a cross-user config copy |
| `POST` | `/api/users/sync` | Copy profiles and referenced credentials using `skip` or `overwrite` conflicts |
| `GET` | `/api/harnesses` | Collection with nested profiles, form field specs, and live file paths |
| `GET` | `/api/harnesses/:id` | One harness |
| `POST` | `/api/harnesses/:id/profiles` | Create |
| `PATCH` | `/api/harnesses/:id/profiles/:name` | Update; omit `apiKey` to keep the stored secret. Rewrites the live files when the profile is active |
| `DELETE` | `/api/harnesses/:id/profiles/:name` | Delete; `409` for the active profile |
| `GET` | `/api/harnesses/:id/profiles/:name/preview` | The exact content that would be written |
| `POST` | `/api/harnesses/:id/profiles/:name/activate` | Write the native config, then commit the switch |
| `POST` | `/api/harnesses/:id/profiles/:name/probe` | Test the stored credential against the stored base URL |
| `POST` | `/api/harnesses/:id/official/activate` | Return a supported harness to its built-in account login |
| `GET` | `/api/backups` | Snapshots, newest first |
| `POST` | `/api/backups/:id/restore` | Restore a snapshot verbatim |
| `POST` | `/api/transfer/export` | Create a passphrase-encrypted portable bundle |
| `POST` | `/api/transfer/preview` | Decrypt and report profile counts and conflicts without writing |
| `POST` | `/api/transfer/import` | Import with `skip` or `overwrite` conflict handling |
| `GET` | `/api/providers` | Provider Vault entries (no key material) |
| `POST` | `/api/providers` | Create a vault entry |
| `PATCH` | `/api/providers/:id` | Update; re-applies referencing active profiles |
| `POST` | `/api/providers/:id/probe` | Test the stored key against an endpoint (`{ "endpoint": "key" }`, default first) |
| `DELETE` | `/api/providers/:id` | Delete; `409` while referenced by a profile |
| `POST` | `/api/probe` | Test unsaved values: `{ "baseUrl", "apiKey" }` or `{ "baseUrl", "providerId" }`, stored nowhere |
| `GET` | `/api/drift` | Drift report for every harness |
| `POST` | `/api/drift/:harnessId/reapply` | Rewrite live files from the active profile |
| `POST` | `/api/drift/:harnessId/adopt` | Read live files back into the profile record |
| `GET` | `/api/doctor` | Read-only diagnostics (`?probe=1` also tests each active profile's endpoint) |
| `GET` | `/api/scan` | Providers the five tools already have on disk; read-only, credentials masked |
| `POST` | `/api/scan/import` | Save selected candidates as profiles or vault entries; the tools' own config is untouched |
| `GET` | `/api/operations` | Operation receipts, newest first (`?harness=claude` to filter) |
| `GET` | `/api/operations/:id` | One receipt |
| `POST` | `/api/operations/:id/undo` | Put the native files and the active profile back to before that operation |

Every POST/PATCH body is validated against a shared Zod schema (`packages/shared/src/schemas.ts`) that the server and the web client both build on. A malformed shape is rejected with a `400` naming the field *before* it reaches storage, instead of being persisted and only surfacing as a `500` on the next activation. Unknown fields are dropped rather than rejected, so an older client keeps working while nothing unrecognised enters the store.

## Background daemon (npx / pnpm / Bun)

The published CLI runs as a background daemon by default: the command returns
immediately, the server keeps running after the terminal is closed, and
re-running after a release restarts the daemon on the newest version.

```bash
npx -y @seaveyon/harness-switch@latest             # start, or update + restart the daemon
npx -y @seaveyon/harness-switch@latest status      # pid, url, log path
npx -y @seaveyon/harness-switch@latest stop        # stop the daemon
npx -y @seaveyon/harness-switch@latest server      # run in the foreground instead
npx -y @seaveyon/harness-switch@latest list        # CLI automation (see above)
```

Replace `npx -y` with `pnpm dlx`, `pnpx`, or `bunx` as preferred. Append `@latest`
so the package runner fetches the newest release before running. The same executable supports both Node.js and Bun; use `node dist/harness-switch.js` or `bun dist/harness-switch.js` when running an installed build directly.

The daemon writes its PID, instance identity, and listening address to `~/.harness-switch/daemon.pid` and its log to
`~/.harness-switch/daemon.log` (a fresh log per start). The first run creates
the web password in `~/.harness-switch/web_password` and prints it to the log.
When a daemon is already running, a new invocation stops it before starting the
new process, so the port never conflicts and the newest code wins.

Startup reports success only after the new process answers `/healthz`. `status` returns a non-zero exit code when the recorded daemon is not healthy. Before `stop` or an update sends a signal, the recorded instance identity is verified so a stale, reused PID cannot terminate an unrelated process.

The dashboard polls the npm registry and shows a one-click **update button**
next to the version badge when a newer release exists; it uses `npx -y` under Node.js or `bun x` under Bun to restart, then reloads the page once the
new version is up. Update logs land in `~/.harness-switch/update.log`.

Under systemd (or any supervisor), run the CLI in the foreground instead:

```ini
[Service]
Type=simple
ExecStart=/usr/local/bin/harness-switch server
Restart=on-failure
RestartSec=3
```

## Development

This is a Bun workspace:

```text
apps/web      React + Zustand + shadcn/ui, built with Rspack
apps/server   Hono + VS Code-style DI, published as @seaveyon/harness-switch
packages/shared   Shared TypeScript types
```

```bash
git clone <your-repository-url>
cd harness-switch
bun install
bun run test
bun run check
bun run dev:server
bun run dev:web
```

Quality gates are three-layered: **tsc** for type checking, **Oxlint** for diagnostics, **Biome** for format and import organization. `bun run check` runs all three.

```bash
bun run lint
bun run lint:fix
bun run typecheck
bun run format
bun run format:check
bun run check
```

`bun install` installs a git `pre-commit` hook that runs `bun run check` and `bun run test`. Commits are blocked if either step fails. To run the same gate manually:

```bash
bun run precommit
```

Production build (frontend assets are copied into `apps/server/public`, then the CLI is bundled). `bun run start` starts the daemon; use `bun run start:foreground` for the foreground server:

```bash
bun run build
bun run start
bun run pack:check
```

The web dev server listens on `http://127.0.0.1:5173` and proxies `/api` to the backend on `8787`.

## Release

Pushes to `main` run [semantic-release](https://semantic-release.gitbook.io/). It reads conventional commits, bumps `@seaveyon/harness-switch`, tags `v*`, and publishes to npm via Trusted Publishing. The tarball is published to the npm registry **before** the `v*` tag and GitHub release are created, so a failed registry publish never leaves a tag without a matching npm version, and a re-run skips versions that are already on the registry.

| Commit | Version bump |
|---|---|
| `fix:` | patch (`0.1.0` → `0.1.1`) |
| `feat:` | minor (`0.1.0` → `0.2.0`) |
| `feat!:` / `BREAKING CHANGE:` | major (`0.2.0` → `1.0.0`) |
| `chore:` / `ci:` / `docs:` | no release |

You can also run **Publish npm** manually from the Actions tab (`workflow_dispatch`). Commits that do not need a release will no-op.

## License

[MIT](./LICENSE)
