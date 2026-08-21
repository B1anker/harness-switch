# harness-switch

[![npm version](https://img.shields.io/npm/v/%40seaveyon%2Fharness-switch.svg)](https://www.npmjs.com/package/@seaveyon/harness-switch)

English | [简体中文](https://github.com/B1anker/harness-switch/blob/main/README.zh-CN.md)

**harness-switch** is a Bun-powered web control plane for managing API profiles on an SSH or headless server. It switches API Base URL, API key, and model profiles for **Claude Code**, **Codex**, **Kimi Code**, **Pi**, and **DeepSeek Harness (DSH)**.

It is a configuration manager, not an API proxy: it does not route or inspect model traffic.

## Install and run

Requires [Bun](https://bun.sh) >= 1.2.

```bash
bunx @seaveyon/harness-switch
```

Or install it globally:

```bash
bun add -g @seaveyon/harness-switch
harness-switch
```

The server listens on `127.0.0.1:8787` by default. The first startup prints a randomly generated Web password in the terminal.

For a remote SSH server, keep the server bound to loopback and use an SSH tunnel:

```bash
ssh -N -L 8787:127.0.0.1:8787 user@your-server
```

Then open <http://127.0.0.1:8787> in your local browser.

### Interface language

The web UI supports English and Simplified Chinese. Use the language button in the login page or dashboard header to switch languages. Chinese remains the default for existing behavior; your selection is stored in the browser and is reused on later visits. The setting affects only the web interface—it does not change profile data or generated configuration files.

## Configuration

Create one or more profiles per harness in the web UI. A profile holds a display name, API Base URL, API key, model, notes, and whatever extra fields that harness needs. Select **Activate** to make a profile current.

Activation writes each tool's own configuration file. Nothing depends on you having sourced a shell script, which is what makes it work for long-lived processes that spawn a CLI as a child.

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

`~/.harness-switch/env.sh` remains as a compatibility layer and only contains variables the corresponding tool genuinely honours. It is needed only when a Codex profile uses the environment-variable auth mode:

```bash
source ~/.harness-switch/env.sh
```

Two known limitations:

- Writing TOML goes through parse and re-serialize, so comments and layout in `config.toml` are lost. YAML and JSON keep their comments and key order.
- The web UI changes files on the **server**. It cannot touch an already-running shell or your local machine.

### Advanced: taking over the raw file

Any field the form does not expose can be set by editing the raw file content in the profile's **Advanced: raw configuration** section. Once edited, that file is generated from your text instead of the form fields until you select **Restore automatic generation**. Content that cannot be parsed back is rejected before it reaches disk.

### Backups and rollback

Before every write, the previous content of each target file is snapshotted into `~/.harness-switch/backups/`, keeping the most recent 10. The backup panel restores a snapshot verbatim, comments included. Snapshots never land next to the live file, because tools like Claude Code scan their own config directory.

A write either lands completely or not at all: content is validated first, and a failure part way through restores the previous state, deleting files that did not exist before rather than leaving them empty.

Switching away from a profile first reads the live file back into that profile's record, so edits you made directly in the CLI tool are not lost on the next switch.

### Moving every profile to another machine

Use **Import / Export** in the top bar to create one `.hsw-backup` file containing every Harness profile, API key, raw-file override, and current activation choice. The bundle is encrypted with a migration password you choose, so it does not depend on the source machine's `aes-256-gcm.key`.

On the destination machine, select the bundle and enter the migration password. The UI shows profile counts and same-name conflicts before it writes anything. Import keeps destination profiles by default; overwriting is an explicit choice. Restoring the exported activation state is optional.

A Codex official-login cache (`$CODEX_HOME/auth.json`) is **excluded by default**. When a valid cache is available, you may explicitly include it in the encrypted bundle. Import offers the separate migration choice only when the bundled and destination JSON values differ. This carries a reusable Codex/ChatGPT login session: share such a bundle only with a trusted recipient, and expect upstream expiry or revocation to still require a fresh `codex login`. An existing destination cache is backed up before replacement; copied caches are written as the destination user with mode `0600`.

Keep the migration password separately from the bundle. It cannot be recovered from the export file.

### Provider Vault: shared credentials

The **Provider Vault** stores an API key once under a named entry with one or more named endpoints (each a base URL), encrypted with the same AES-256-GCM key that protects `profiles.json`. A profile can reference a vault entry instead of carrying its own key:

- The vault owns the credential; the profile keeps a materialized cache so existing readers (transfer export, `active.json`, `env.sh`) keep working unchanged.
- Rotating the vault key or an endpoint re-applies every **active** profile that references the entry, so the live files follow immediately. Failures are reported as warnings.
- An entry that is referenced by any profile cannot be deleted (HTTP `409`).
- Detach a profile by clearing the provider selection in the profile form; the cached key stays as the profile's own inline key.

### Configuration drift

The dashboard's **Configuration drift** panel compares what the active profile would render against the actual files on disk, using parsed-value comparison for JSON/TOML/YAML so a re-render that only reorders keys does not count as drift. Each file is reported as:

- `in-sync` — disk matches what the profile would write,
- `drifted` — disk differs from what the profile would write,
- `missing` — the file does not exist yet,
- `invalid` — the live file cannot be parsed,
- `unknown` — nothing is active for this tool (official-login `text` files cannot be verified).

Two repair actions are offered per harness:

- **Re-apply** rewrites the live files from the active profile, with the usual backup-before-write and all-or-nothing rollback.
- **Adopt live configuration** reads the live files back into the profile record (same path as the pre-switch backfill). It refuses with `409` when the profile has manual raw overrides, and never adopts content the tool itself could not parse.

### Diagnostics (Doctor)

The **Diagnostics (Doctor)** panel runs read-only checks per harness: whether the tool's CLI is on `PATH` (`install`), whether each target's config directory exists (`configDir`), whether each target file exists and is readable/writable (`files`, with a warning when a config file holding credentials is group/other-readable), whether the files parse (`parse`), and whether live state drifts from the active profile (`drift`). A global update check reports whether a newer release exists (`updatedAvailable`).

The connectivity probe is **disabled by default in the MVP**: passing `--probe` only records a `unknown`-status check that reports the active base URL and explains that no network request is made.

### Local Unix users

The dashboard header can switch between local login users such as `root` and `alice`. Each user has independent profiles, Provider Vault, encryption key, active state and backups under their own home. Selecting a user does not write any harness file; only an explicit activation does.

“Sync user config” performs a one-time copy of another user's profiles and referenced Provider Vault credentials into the selected user. Secrets are decrypted only on the server and re-encrypted with the destination user's local key. Active state, backups and native config files are not copied. Same-name profiles are skipped by default and can be explicitly overwritten.

A source user's Codex official-login cache (`auth.json`) is the sole optional exception. The migration choice appears only when the source and destination JSON values differ; it remains unchecked by default and requires an irreversible confirmation that identifies both users. Choose it only when the destination user is allowed to use that login session. The previous destination cache is backed up, and the replacement is destination-owned with mode `0600`; source ownership and permissions are never copied.

Cross-user writes require access to the destination home. Managing both `root` and regular users therefore normally requires running harness-switch as root; newly created files and directories are assigned to the destination UID/GID. The Web password then grants control over every exposed user's configs, so keep the loopback bind and SSH tunnel. Use `HSW_USERS=root,alice` to restrict the manageable accounts.

### CLI automation

The same business logic is available from the terminal without opening the browser or starting any listener: the CLI builds the same service graph in-process and reads/writes the same data directory, so it works even when the daemon is not running. Every command supports `--json` for scripting:

```bash
harness-switch list                          # harnesses, active profile, profile counts
harness-switch providers                     # Provider Vault entries
harness-switch doctor                        # read-only diagnostics
harness-switch doctor --probe --harness claude
harness-switch plan claude                   # drift inspection for a harness
harness-switch activate claude main --yes    # activate a profile
harness-switch users                         # manageable local Unix users
harness-switch list --user alice             # inspect alice's independent store
harness-switch activate codex main --user alice --yes
harness-switch sync --from root --to alice   # one-time copy; skips conflicts
harness-switch sync --from root --to alice --overwrite
harness-switch sync --from root --to alice --copy-codex-auth  # explicitly copy Codex auth.json
```

`plan <harness>` prints the drift inspection of the active profile (expected vs. current content per file); without an active profile it reports `status: unknown`. `activate` prompts for confirmation on a TTY and requires `--yes` in non-interactive terminals (CI). JSON output mirrors the HTTP API response shapes (`HarnessesResponse`, `ProvidersResponse`, `DoctorResponse`, `DriftSummary`, `ActivateResponse`), so scripts can reuse the same field names. `HSW_DATA_DIR` and `HSW_HOME_DIR` override where it reads state (defaults: `~/.harness-switch` and `$HOME`).

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
| `HSW_DATA_DIR` | `~/.harness-switch` | Control-plane and service-owner data directory; other users use `.harness-switch` in their own home. |
| `HSW_HOME_DIR` | `$HOME` | Service owner's home override, mainly for tests and containers. |
| `HSW_USERS` | auto-discovered | Comma-separated allowlist such as `root,alice`. The service owner is always manageable. |
| `HSW_UPDATE_CHECK` | `1` | Set to `0` to skip npm registry update checks. The local development command sets this automatically. |
| `HSW_SESSION_TTL_HOURS` | `24` | How long a Web login stays valid. Sessions survive a service restart. |
| `HSW_BACKUP_RETAIN` | `10` | Number of snapshots to keep. |
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
| `GET` | `/api/backups` | Snapshots, newest first |
| `POST` | `/api/backups/:id/restore` | Restore a snapshot verbatim |
| `POST` | `/api/transfer/export` | Create a passphrase-encrypted portable bundle |
| `POST` | `/api/transfer/preview` | Decrypt and report profile counts and conflicts without writing |
| `POST` | `/api/transfer/import` | Import with `skip` or `overwrite` conflict handling |
| `GET` | `/api/providers` | Provider Vault entries (no key material) |
| `POST` | `/api/providers` | Create a vault entry |
| `PATCH` | `/api/providers/:id` | Update; re-applies referencing active profiles |
| `DELETE` | `/api/providers/:id` | Delete; `409` while referenced by a profile |
| `GET` | `/api/drift` | Drift report for every harness |
| `POST` | `/api/drift/:harnessId/reapply` | Rewrite live files from the active profile |
| `POST` | `/api/drift/:harnessId/adopt` | Read live files back into the profile record |
| `GET` | `/api/doctor` | Read-only diagnostics (`?probe=1` includes the MVP-disabled, non-network probe check) |

## Background daemon (bunx / npx)

The published CLI runs as a background daemon by default: the command returns
immediately, the server keeps running after the terminal is closed, and
re-running after a release restarts the daemon on the newest version.

```bash
bunx @seaveyon/harness-switch@latest             # start, or update + restart the daemon
bunx @seaveyon/harness-switch@latest status      # pid, url, log path
bunx @seaveyon/harness-switch@latest stop        # stop the daemon
bunx @seaveyon/harness-switch@latest server      # run in the foreground instead
bunx @seaveyon/harness-switch@latest list        # CLI automation (see above)
```

`npx -y @seaveyon/harness-switch@latest` works the same way. Append `@latest`
so `bunx`/`npx` fetch the newest release before running.

The daemon writes its pid to `~/.harness-switch/daemon.pid` and its log to
`~/.harness-switch/daemon.log` (a fresh log per start). The first run creates
the web password in `~/.harness-switch/web_password` and prints it to the log.
When a daemon is already running, a new invocation stops it before starting the
new process, so the port never conflicts and the newest code wins.

The dashboard polls the npm registry and shows a one-click **update button**
next to the version badge when a newer release exists; it runs the same
`bunx <package>@latest` restart under the hood and reloads the page once the
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
