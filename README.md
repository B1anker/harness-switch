# harness-switch

[![npm version](https://img.shields.io/npm/v/%40seaveyon%2Fharness-switch.svg)](https://www.npmjs.com/package/@seaveyon/harness-switch)

**harness-switch** is a dependency-free Node.js web control plane for managing API profiles on an SSH or headless server. It switches API Base URL, API key, and model profiles for **Claude Code**, **pi**, **Codex**, **zcode**, and **Kimi Code**.

It is a configuration manager, not an API proxy: it does not route or inspect model traffic.

## Install and run

```bash
npx @seaveyon/harness-switch
```

Or install it globally:

```bash
npm install -g @seaveyon/harness-switch
harness-switch
```

The server listens on `127.0.0.1:8787` by default. The first startup prints a randomly generated Web password in the terminal.

For a remote SSH server, keep the server bound to loopback and use an SSH tunnel:

```bash
ssh -N -L 8787:127.0.0.1:8787 user@your-server
```

Then open <http://127.0.0.1:8787> in your local browser.

## Configuration

Create one or more profiles per harness in the web UI. A profile contains a display name, API Base URL, API key, model, and notes. Select **Activate** to make a profile current.

Every activation writes `~/.harness-switch/env.sh`. In the exact SSH shell that launches a harness, load it with:

```bash
source ~/.harness-switch/env.sh
```

| Harness | Activation behaviour | Environment variables |
|---|---|---|
| Claude Code | Updates `~/.claude/settings.json` and the shared env file | `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` |
| Codex | Writes the shared env file without overwriting complex native config | `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `CODEX_MODEL` |
| pi | Writes the shared env file without overwriting custom provider files | `PI_API_BASE`, `PI_API_KEY`, `PI_MODEL` |
| zcode | Writes the shared env file; variable names are a portable bridge | `ZCODE_BASE_URL`, `ZCODE_API_KEY`, `ZCODE_MODEL` |
| Kimi Code | Updates `~/.kimi/config.toml` and the shared env file | `KIMI_BASE_URL`, `KIMI_API_KEY`, `KIMI_MODEL` |

> The web UI changes files on the **server**; it cannot modify an existing parent shell or the browser computer. Source the generated file again after changing profiles, or use a new shell session.

## Security

The service defaults to loopback only. Do **not** expose the management port directly to the public Internet. Use SSH port forwarding or a TLS-enabled reverse proxy with additional access control.

API keys are encrypted with AES-256-GCM in `~/.harness-switch/profiles.json`; the local encryption key lives in `~/.harness-switch/aes-256-gcm.key`. Both files, the generated password, and `env.sh` are stored with permissions set to `0600` on POSIX systems. This protects against accidental plaintext disclosure in profile storage, but does not replace host-level controls such as disk encryption and a secure Unix account.

## Environment variables

| Variable | Default | Purpose |
|---|---:|---|
| `HOST` | `127.0.0.1` | Bind address. Keep the default when using SSH tunnelling. |
| `PORT` | `8787` | Listening port. |
| `HSW_DATA_DIR` | `~/.harness-switch` | Directory for encrypted profiles, active state, key, password, and env file. |

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

```bash
git clone <your-repository-url>
cd harness-switch
npm test
npm start
npm pack --dry-run
```

## License

[MIT](./LICENSE)
