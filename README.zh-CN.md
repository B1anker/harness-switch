# harness-switch

[![npm version](https://img.shields.io/npm/v/%40seaveyon%2Fharness-switch.svg)](https://www.npmjs.com/package/@seaveyon/harness-switch)

[English](./README.md) | 简体中文

**harness-switch** 是一个基于 Bun 的 Web 控制面，用于在 SSH 服务器或无图形界面的机器上管理 API 配置。它可以为 **Claude Code**、**Codex**、**Kimi Code**、**Pi** 和 **DeepSeek Harness (DSH)** 切换 API Base URL、API Key 和模型配置。

它是配置管理器，不是 API 代理：不转发、也不检查任何模型流量。

## 安装与运行

需要 [Bun](https://bun.sh) >= 1.2。

```bash
bunx @seaveyon/harness-switch
```

或全局安装：

```bash
bun add -g @seaveyon/harness-switch
harness-switch
```

服务默认监听 `127.0.0.1:8787`。首次启动会在终端打印一个随机生成的 Web 密码。

对于远程 SSH 服务器，请让服务保持绑定在回环地址，并通过 SSH 隧道访问：

```bash
ssh -N -L 8787:127.0.0.1:8787 user@your-server
```

然后在本地浏览器打开 <http://127.0.0.1:8787>。

## 配置

在 Web 界面中为每个 Harness 创建一个或多个配置。一个配置包含显示名称、API Base URL、API Key、模型、备注，以及该 Harness 需要的其他字段。点击 **激活** 即可让某个配置生效。

激活时会直接写入各个工具自己的配置文件。整个过程不依赖你 source 过某个 shell 脚本 —— 这正是它能作用于「长期运行、并把 CLI 作为子进程拉起」的场景的原因。

| Harness | 写入的文件 | 写入模式 | 生效时机 |
|---|---|---|---|
| Claude Code | `~/.claude/settings.json`（`env` 块） | 替换 | 立即生效；Claude Code 会重新读取该文件，且其 `env` 值优先于继承来的 shell 变量 |
| Codex | `$CODEX_HOME/config.toml`，仅在选择该认证模式时额外写 `auth.json` | 替换 | 下次启动 `codex` |
| Kimi Code | `$KIMI_CODE_HOME/config.toml`（`~/.kimi-code`） | 追加 | 下次启动 `kimi` |
| Pi | `~/.pi/agent/models.json` 和 `settings.json` | 追加 | 下次启动 `pi` |
| DeepSeek Harness | `$DSH_HOME/settings.yaml` 和 `.credentials.yaml`（`~/.dsh`） | 追加 | 热加载；默认值对新会话生效 |

**替换模式** 表示该文件只保存一个 provider，因此激活会直接替换它。**追加模式** 表示该文件保存多个 provider 以及一个指向当前项的指针，因此激活只移动这个指针，不会动你手写的其他 provider。

各 Harness 的注意事项：

- **Claude Code** 默认使用 `ANTHROPIC_AUTH_TOKEN`，这是大多数第三方中转服务的要求。若使用官方 API，请把配置切换为 `ANTHROPIC_API_KEY`。
- **Codex** 默认把 token 以 `experimental_bearer_token` 的形式写入 `config.toml`。另一种写 `auth.json` 的方式会覆盖你的 ChatGPT 登录缓存，因此需要显式选择；无论选哪种，原有的 `auth.json` 都会先被备份。
- **Kimi Code**（`~/.kimi-code`）与 Kimi CLI（`~/.kimi`）是两个不同的产品，尽管两者都提供 `kimi` 命令。本项目针对的是 Kimi Code，它完全不从 shell 读取凭据。
- **Pi**（`@earendil-works/pi-coding-agent`）会在 `models.json` 中注册一个自定义 provider，并通过 `defaultProvider` / `defaultModel` 让 `settings.json` 指向它。API Key 必须位于该 provider 条目中（或 `auth.json`），否则 Pi 会显示 "No models available" 并要求 `/login`。运行时的 `--model` 参数仍可覆盖默认模型。
- **DeepSeek Harness** 会注册一个自定义的 `llm-pi-ai` provider，把 API Key 存入它单独的凭据文档，并更新 `agent-default-model`。已有会话会保持各自选定的路由，新建会话则使用已激活的配置。

`~/.harness-switch/env.sh` 作为兼容层保留，其中只包含对应工具确实会读取的变量。仅当 Codex 配置使用环境变量认证模式时才需要它：

```bash
source ~/.harness-switch/env.sh
```

两个已知限制：

- 写入 TOML 会经过「解析 — 重新序列化」，因此 `config.toml` 中的注释和排版会丢失。YAML 和 JSON 会保留注释与键顺序。
- Web 界面修改的是 **服务器上** 的文件。它无法影响一个已在运行的 shell，也不会改动你的本地机器。

### 进阶：接管原始文件

表单未暴露的任何字段，都可以在配置的 **高级：原始配置** 区域直接编辑文件原文来设置。一旦编辑过，该文件就会依据你的文本生成，而不再依据表单字段，直到你选择 **恢复为自动生成**。无法被解析回来的内容会在落盘前被拒绝。

### 备份与回滚

每次写入前，各目标文件的原有内容都会被快照到 `~/.harness-switch/backups/`，保留最近 10 份。备份面板可以原样恢复某个快照，注释也一并保留。快照绝不会与实际配置文件放在同一目录，因为像 Claude Code 这类工具会扫描自己的配置目录。

一次写入要么完整生效，要么完全不生效：内容会先经过校验，中途失败则恢复到先前状态 —— 原本不存在的文件会被删除，而不是留下一个空文件。

从某个配置切走时，会先把实际文件的内容读回该配置的记录，因此你直接在 CLI 工具里做过的修改不会在下次切换时丢失。

### 把所有配置迁移到另一台机器

使用顶栏的 **导入 / 导出** 可以生成一个 `.hsw-backup` 文件，其中包含全部 Harness 配置、API Key、原始文件覆盖内容以及当前的激活选择。该包用你自己设定的迁移密码加密，因此不依赖源机器的 `aes-256-gcm.key`。

在目标机器上选择该文件并输入迁移密码。界面会在写入任何内容之前展示配置数量和同名冲突。导入默认保留目标机器上的配置；覆盖需要显式选择。是否恢复导出时的激活状态是可选的。

请将迁移密码与备份包分开保管。它无法从导出文件中还原。

### 凭据库（Provider Vault）：共享凭据

**凭据库**让一个 API Key 只保存一次，并挂在一个具名条目下，条目下可含多个具名 endpoint（每个一个 Base URL），使用与 `profiles.json` 相同的 AES-256-GCM 密钥加密。某个配置可以引用凭据库条目，而不再自带密钥：

- 凭据库拥有凭据；配置里保留一份物化缓存，因此现有读取方（迁移导出、`active.json`、`env.sh`）无需改动仍能工作。
- 轮换凭据库密钥或 endpoint 时，所有**已激活**且引用该条目的配置会被重新应用，live 文件立即跟上；失败以 warnings 报告。
- 仍被配置引用的条目无法删除（HTTP `409`）。
- 在配置表单中清除 Provider 选择即可解除引用；缓存的密钥会作为该配置自己的内联密钥保留。

### 配置漂移

仪表盘的 **配置漂移** 面板把「激活配置会渲染出的内容」与磁盘上的实际文件做比较；JSON/TOML/YAML 按解析后的值比较，因此仅键顺序变化的重新渲染不会误报为漂移。每个文件的状态为：

- `in-sync` — 磁盘与配置将写入的内容一致；
- `drifted` — 磁盘与配置将写入的内容不同；
- `missing` — 文件还不存在；
- `invalid` — live 文件无法解析；
- `unknown` — 该工具当前未激活任何配置（官方登录的 `text` 文件无法校验）。

每个 Harness 提供两种修复动作：

- **重新应用**：按激活配置重写 live 文件，沿用「写前备份 + 全有或全无回滚」。
- **采纳现场配置**：把 live 文件内容读回配置记录（与切走前回填同一路径）。当配置存在手动 override 时拒绝执行；工具自身无法解析的内容也绝不会被采纳。

### 诊断（Doctor）

**诊断** 面板对每个 Harness 执行只读检查：工具的 CLI 是否在 `PATH` 中（`install`）、每个目标文件所在目录是否存在（`configDir`）、每个目标文件是否存在且可读可写（`files`，配置文件持有凭据且 group/other 可读时给出 warning）、文件能否解析（`parse`）、live 状态是否与激活配置漂移（`drift`）。另有全局的版本更新检查，报告是否有新版本可用（`updatedAvailable`）。

连通性探测在 MVP 中**默认关闭**：传入 `--probe` 也只会记录一条 `unknown` 状态的检查，报告当前激活的 base URL 并说明未发起任何网络请求。

### 本地 Unix 多用户

Dashboard 顶栏可以在 `root`、`alice` 等本地登录用户之间切换。每个用户使用自己 Home 下独立的配置档案、凭据库、加密密钥、激活状态和备份；切换用户本身不会写入 Harness 文件，只有显式激活配置才会写入。

“同步用户配置”可以把另一个用户的配置和它引用的 Provider Vault 凭据一次性复制到当前用户。同步时密钥只在服务端解密，并使用目标用户的本地密钥重新加密；激活状态、备份和原生配置文件不会复制。同名配置默认跳过，也可以显式选择覆盖。

跨用户写入必须具备目标 Home 的权限。要同时管理 `root` 和普通用户，通常需要以 root 运行 harness-switch；新建文件和目录会设置为目标用户的 UID/GID。此时 Web 密码等同于管理所有已开放用户配置的权限，因此务必保持回环监听并使用 SSH 隧道。可用 `HSW_USERS=root,alice` 限制界面中允许管理的账号。

### CLI 自动化

不打开浏览器、也不启动任何监听进程就能在终端使用同样的业务逻辑：CLI 在进程内构建与 HTTP 服务相同的服务图，直接读写同一数据目录，即使守护进程未运行也能工作。每条命令都支持 `--json` 以便脚本化：

```bash
harness-switch list                          # Harness、激活配置与配置数量
harness-switch providers                     # 凭据库条目
harness-switch doctor                        # 只读诊断
harness-switch doctor --probe --harness claude
harness-switch plan claude                   # 该 Harness 的漂移检查
harness-switch activate claude main --yes    # 激活一个配置
harness-switch users                         # 可管理的本地 Unix 用户
harness-switch list --user alice             # 查看 alice 的独立配置
harness-switch activate codex main --user alice --yes
harness-switch sync --from root --to alice   # 一次性复制；同名项默认跳过
harness-switch sync --from root --to alice --overwrite
```

`plan <harness>` 输出激活配置的漂移检查（每个文件预期内容 vs 当前内容）；未激活任何配置时报告 `status: unknown`。`activate` 在 TTY 上会询问确认，在非交互式终端（CI）里必须加 `--yes`。JSON 输出与 HTTP API 的响应形状一致（`HarnessesResponse`、`ProvidersResponse`、`DoctorResponse`、`DriftSummary`、`ActivateResponse`），脚本可直接复用同样的字段名。`HSW_DATA_DIR` 与 `HSW_HOME_DIR` 可覆盖状态读写位置（默认 `~/.harness-switch` 与 `$HOME`）。

## 安全性

服务默认仅监听回环地址。请 **不要** 把管理端口直接暴露到公网。请使用 SSH 端口转发，或配合额外访问控制的 TLS 反向代理。

API Key 以 AES-256-GCM 加密保存在 `~/.harness-switch/profiles.json` 中；本机加密密钥位于 `~/.harness-switch/aes-256-gcm.key`。在 POSIX 系统上，这些文件、生成的密码以及 `env.sh` 的权限均为 `0600`。写入 Harness 自身的配置文件时会保留其原有权限，新建文件则以 `0600` 起始。

Web 会话保存在 `~/.harness-switch/sessions.json`（同样是 `0600`），因此重启服务不会让你退出登录。文件中只保存每个会话 token 的 SHA-256 摘要，所以它无法被当作 cookie 重放；同时整张会话表绑定了签发它的那个密码的指纹：替换 `web_password` 会使所有既有会话失效。

有两处会有意地向已认证的会话暴露密钥：原始配置预览，以及生成的文件本身 —— 它们必须包含凭据才有意义。配置列表则从不回显密钥。

这可以防止配置存储中的明文意外泄露，但不能替代主机层面的防护，例如磁盘加密和一个安全的 Unix 账户。

## 环境变量

| 变量 | 默认值 | 用途 |
|---|---:|---|
| `HOST` | `127.0.0.1` | 绑定地址。使用 SSH 隧道时请保持默认值。 |
| `PORT` | `8787` | 监听端口。 |
| `HSW_DATA_DIR` | `~/.harness-switch` | 管理端以及启动服务用户的数据目录；其他用户使用各自 Home 下的 `.harness-switch`。 |
| `HSW_HOME_DIR` | `$HOME` | 启动服务用户的 Home 覆盖值，主要用于测试和容器部署。 |
| `HSW_USERS` | 自动发现 | 逗号分隔的本地用户名允许名单，例如 `root,alice`。启动服务的用户始终可管理。 |
| `HSW_UPDATE_CHECK` | `1` | 设为 `0` 可跳过 npm registry 更新检测；本地开发命令会自动设置。 |
| `HSW_SESSION_TTL_HOURS` | `24` | Web 登录的有效时长（小时）。会话可以跨服务重启保留。 |
| `HSW_BACKUP_RETAIN` | `10` | 保留的快照数量。 |
| `HSW_PUBLIC_DIR` | 自动 | 可选，覆盖前端构建产物目录。 |

定位各工具配置时，会遵循它们自己的覆盖变量：`CODEX_HOME`、`KIMI_CODE_HOME` 和 `PI_CODING_AGENT_DIR`。

## HTTP API

界面是一个 React SPA。认证使用 HttpOnly 的 `hsw_session` cookie。

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/healthz` | 存活检查 |
| `POST` | `/api/auth/login` | `{ "password": "..." }` |
| `POST` | `/api/auth/logout` | 清除会话 cookie |
| `GET` | `/api/auth/session` | 未认证时返回 `401` |
| `GET` | `/api/users` | 可管理的本地用户和当前会话选中的用户 |
| `POST` | `/api/users/:username/select` | 为当前 Web 会话切换目标用户，不写 Harness 文件 |
| `POST` | `/api/users/sync/preview` | 预览从其他用户复制配置时的数量和冲突 |
| `POST` | `/api/users/sync` | 从其他用户复制配置和关联凭据；冲突策略为 `skip` 或 `overwrite` |
| `GET` | `/api/harnesses` | 集合，含嵌套的配置、表单字段定义和实际文件路径 |
| `GET` | `/api/harnesses/:id` | 单个 Harness |
| `POST` | `/api/harnesses/:id/profiles` | 创建 |
| `PATCH` | `/api/harnesses/:id/profiles/:name` | 更新；省略 `apiKey` 则保留已存密钥。当该配置处于激活状态时会重写实际文件 |
| `DELETE` | `/api/harnesses/:id/profiles/:name` | 删除；对已激活的配置返回 `409` |
| `GET` | `/api/harnesses/:id/profiles/:name/preview` | 将要写入的确切内容 |
| `POST` | `/api/harnesses/:id/profiles/:name/activate` | 写入原生配置，然后提交此次切换 |
| `GET` | `/api/backups` | 快照列表，最新的在前 |
| `POST` | `/api/backups/:id/restore` | 原样恢复某个快照 |
| `POST` | `/api/transfer/export` | 生成一个用密码加密的可迁移备份包 |
| `POST` | `/api/transfer/preview` | 解密并报告配置数量与冲突，不写入任何内容 |
| `POST` | `/api/transfer/import` | 导入，冲突处理方式为 `skip` 或 `overwrite` |
| `GET` | `/api/providers` | 凭据库条目（不含密钥材料） |
| `POST` | `/api/providers` | 创建凭据库条目 |
| `PATCH` | `/api/providers/:id` | 更新；自动重新应用引用它的已激活配置 |
| `DELETE` | `/api/providers/:id` | 删除；仍被配置引用时返回 `409` |
| `GET` | `/api/drift` | 每个 Harness 的漂移报告 |
| `POST` | `/api/drift/:harnessId/reapply` | 按激活配置重写 live 文件 |
| `POST` | `/api/drift/:harnessId/adopt` | 把 live 文件读回配置记录 |
| `GET` | `/api/doctor` | 只读诊断（`?probe=1` 包含默认关闭、不发网络请求的探测检查） |

## 后台守护进程（bunx / npx）

发布的 CLI 默认以后台守护进程方式运行：命令立即返回，关闭终端后服务依然在跑；发布新版本后重新运行，会重启守护进程并切换到最新版本。

```bash
bunx @seaveyon/harness-switch@latest             # 启动，或更新并重启守护进程
bunx @seaveyon/harness-switch@latest status      # 查看 pid、地址、日志路径
bunx @seaveyon/harness-switch@latest stop        # 停止守护进程
bunx @seaveyon/harness-switch@latest server      # 改为前台运行
bunx @seaveyon/harness-switch@latest list        # CLI 自动化（见上文）
```

`npx -y @seaveyon/harness-switch@latest` 效果相同。加上 `@latest` 可以保证 `bunx`/`npx` 每次先拉取最新发布版本。

守护进程把 pid 写入 `~/.harness-switch/daemon.pid`，把日志写入 `~/.harness-switch/daemon.log`（每次启动重新生成）。首次运行会创建 Web 登录密码 `~/.harness-switch/web_password` 并打印到日志。如果已有守护进程在运行，再次调用会先停掉旧进程再启动新进程，因此端口不会冲突，最新代码总是生效。

Dashboard 会轮询 npm registry：当有新版本发布时，版本徽标旁会出现一键**更新按钮**，点击后内部执行与 `bunx <package>@latest` 相同的重启流程，新版本就绪后页面自动刷新。更新日志在 `~/.harness-switch/update.log`。

如果要在 systemd（或其他进程守护工具）下运行，请改用前台模式：

```ini
[Service]
Type=simple
ExecStart=/usr/local/bin/harness-switch server
Restart=on-failure
RestartSec=3
```

## 开发

这是一个 Bun workspace：

```text
apps/web      React + Zustand + shadcn/ui，使用 Rspack 构建
apps/server   Hono + VS Code 风格的依赖注入，以 @seaveyon/harness-switch 发布
packages/shared   共享的 TypeScript 类型
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

代码检查与格式化是分开的：**Oxlint** 负责诊断，**Biome** 负责格式化与 import 整理。

```bash
bun run lint
bun run lint:fix
bun run format
bun run format:check
bun run check
```

`bun install` 会安装一个 git `pre-commit` 钩子，用于运行 `bun run check` 和 `bun run test`。任一步骤失败都会阻止提交。手动执行同样的检查：

```bash
bun run precommit
```

生产构建（前端产物会被复制到 `apps/server/public`，随后打包 CLI）。`bun run start` 会启动守护进程；如需前台运行请用 `bun run start:foreground`：

```bash
bun run build
bun run start
bun run pack:check
```

前端开发服务器监听 `http://127.0.0.1:5173`，并把 `/api` 代理到 `8787` 上的后端。

## 发布

推送到 `main` 会触发 [semantic-release](https://semantic-release.gitbook.io/)。它会读取 conventional commits，提升 `@seaveyon/harness-switch` 的版本号，打上 `v*` 标签，并通过 Trusted Publishing 发布到 npm。

| 提交类型 | 版本变化 |
|---|---|
| `fix:` | patch（`0.1.0` → `0.1.1`） |
| `feat:` | minor（`0.1.0` → `0.2.0`） |
| `feat!:` / `BREAKING CHANGE:` | major（`0.2.0` → `1.0.0`） |
| `chore:` / `ci:` / `docs:` | 不发布 |

你也可以在 Actions 页手动运行 **Publish npm**（`workflow_dispatch`）。无需发布的提交会自动跳过。

## 许可证

[MIT](./LICENSE)
