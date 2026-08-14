# harness-switch

[![npm version](https://img.shields.io/npm/v/%40seaveyon%2Fharness-switch.svg)](https://www.npmjs.com/package/@seaveyon/harness-switch)

**harness-switch** is a Bun-powered web control plane for managing API profiles on an SSH or headless server. It switches API Base URL, API key, and model profiles for **Claude Code**, **Codex**, **Kimi Code**, and **oh-my-pi**.

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

## Configuration

Create one or more profiles per harness in the web UI. A profile holds a display name, API Base URL, API key, model, notes, and whatever extra fields that harness needs. Select **Activate** to make a profile current.

Activation writes each tool's own configuration file. Nothing depends on you having sourced a shell script, which is what makes it work for long-lived processes that spawn a CLI as a child.

| Harness | File written | Write mode | Takes effect |
|---|---|---|---|
| Claude Code | `~/.claude/settings.json` (`env` block) | replace | Immediately; Claude Code re-reads the file and its `env` values win over inherited shell variables |
| Codex | `$CODEX_HOME/config.toml`, plus `auth.json` only if you pick that auth mode | replace | Next `codex` start |
| Kimi Code | `$KIMI_CODE_HOME/config.toml` (`~/.kimi-code`) | additive | Next `kimi` start |
| oh-my-pi | `~/.omp/agent/models.yml` and `config.yml` | additive | Next `omp` start |

**Replace mode** means the file holds exactly one provider, so activating replaces it. **Additive mode** means the file holds many providers plus a pointer to the current one, so activating only moves that pointer and leaves providers you wrote by hand alone.

Notes on individual harnesses:

- **Claude Code** defaults to `ANTHROPIC_AUTH_TOKEN`, which is what most third-party relays require. Switch the profile to `ANTHROPIC_API_KEY` for the official API.
- **Codex** defaults to putting the token in `config.toml` as `experimental_bearer_token`. The alternative that writes `auth.json` will overwrite your ChatGPT login cache, so it is opt-in; the previous `auth.json` is captured in a backup first either way.
- **Kimi Code** (`~/.kimi-code`) is a different product from Kimi CLI (`~/.kimi`), even though both provide a `kimi` command. This project targets Kimi Code, which does not read credentials from the shell at all.
- **oh-my-pi** has no single "current provider" key. Activating registers the provider in `models.yml` and moves it to the front of `modelProviderOrder`, which is what breaks ties between providers offering the same model id. A `--model` flag still overrides it at runtime.

`~/.harness-switch/env.sh` remains as a compatibility layer and only contains variables the corresponding tool genuinely honours. It is needed only when a Codex profile uses the environment-variable auth mode:

```bash
source ~/.harness-switch/env.sh
```

Two known limitations:

- Writing TOML goes through parse and re-serialize, so comments and layout in `config.toml` are lost. YAML and JSON keep their comments and key order.
- The web UI changes files on the **server**. It cannot touch an already-running shell or your local machine.

### Advanced: taking over the raw file

Any field the form does not expose can be set by editing the raw file content in the profile's **高级：原始配置** section. Once edited, that file is generated from your text instead of the form fields until you select **恢复为自动生成**. Content that cannot be parsed back is rejected before it reaches disk.

### Backups and rollback

Before every write, the previous content of each target file is snapshotted into `~/.harness-switch/backups/`, keeping the most recent 10. The backup panel restores a snapshot verbatim, comments included. Snapshots never land next to the live file, because tools like Claude Code scan their own config directory.

A write either lands completely or not at all: content is validated first, and a failure part way through restores the previous state, deleting files that did not exist before rather than leaving them empty.

Switching away from a profile first reads the live file back into that profile's record, so edits you made directly in the CLI tool are not lost on the next switch.

## Security

The service defaults to loopback only. Do **not** expose the management port directly to the public Internet. Use SSH port forwarding or a TLS-enabled reverse proxy with additional access control.

API keys are encrypted with AES-256-GCM in `~/.harness-switch/profiles.json`; the local encryption key lives in `~/.harness-switch/aes-256-gcm.key`. Those files, the generated password, and `env.sh` are stored with permissions set to `0600` on POSIX systems. When writing a harness's own configuration file, existing permissions are preserved and newly created files start at `0600`.

Two places deliberately expose a key to an authenticated session: the raw config preview and the generated files themselves must contain the credential to be useful. Profile listings never echo it.

This protects against accidental plaintext disclosure in profile storage, but does not replace host-level controls such as disk encryption and a secure Unix account.

## Environment variables

| Variable | Default | Purpose |
|---|---:|---|
| `HOST` | `127.0.0.1` | Bind address. Keep the default when using SSH tunnelling. |
| `PORT` | `8787` | Listening port. |
| `HSW_DATA_DIR` | `~/.harness-switch` | Directory for encrypted profiles, active state, key, password, backups, and env file. |
| `HSW_HOME_DIR` | `$HOME` | Home directory used to locate the harness config directories. |
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
| `GET` | `/api/harnesses` | Collection with nested profiles, form field specs, and live file paths |
| `GET` | `/api/harnesses/:id` | One harness |
| `POST` | `/api/harnesses/:id/profiles` | Create |
| `PATCH` | `/api/harnesses/:id/profiles/:name` | Update; omit `apiKey` to keep the stored secret. Rewrites the live files when the profile is active |
| `DELETE` | `/api/harnesses/:id/profiles/:name` | Delete; `409` for the active profile |
| `GET` | `/api/harnesses/:id/profiles/:name/preview` | The exact content that would be written |
| `POST` | `/api/harnesses/:id/profiles/:name/activate` | Write the native config, then commit the switch |
| `GET` | `/api/backups` | Snapshots, newest first |
| `POST` | `/api/backups/:id/restore` | Restore a snapshot verbatim |

## systemd

Create `/etc/systemd/system/harness-switch.service`:

```ini
[Unit]
Description=Harness Switch Web Control Plane
After=network.target

[Service]
Type=simple
User=ubuntu
Environment=HOST=127.0.0.1
Environment=PORT=8787
ExecStart=/usr/bin/env harness-switch
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Then run:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now harness-switch
sudo journalctl -u harness-switch -f
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

Linting and formatting are split: **Oxlint** for diagnostics, **Biome** for format and import organization.

```bash
bun run lint
bun run lint:fix
bun run format
bun run format:check
bun run check
```

`bun install` installs a git `pre-commit` hook that runs `bun run check` and `bun run test`. Commits are blocked if either step fails. To run the same gate manually:

```bash
bun run precommit
```

Production build (frontend assets are copied into `apps/server/public`, then the CLI is bundled):

```bash
bun run build
bun run start
bun run pack:check
```

The web dev server listens on `http://127.0.0.1:5173` and proxies `/api` to the backend on `8787`.

## Release

Pushes to `main` run [semantic-release](https://semantic-release.gitbook.io/). It reads conventional commits, bumps `@seaveyon/harness-switch`, tags `v*`, and publishes to npm via Trusted Publishing.

| Commit | Version bump |
|---|---|
| `fix:` | patch (`0.1.0` → `0.1.1`) |
| `feat:` | minor (`0.1.0` → `0.2.0`) |
| `feat!:` / `BREAKING CHANGE:` | major (`0.2.0` → `1.0.0`) |
| `chore:` / `ci:` / `docs:` | no release |

You can also run **Publish npm** manually from the Actions tab (`workflow_dispatch`). Commits that do not need a release will no-op.

## License

[MIT](./LICENSE)
