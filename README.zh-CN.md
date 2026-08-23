# harness-switch

[![npm version](https://img.shields.io/npm/v/%40seaveyon%2Fharness-switch.svg)](https://www.npmjs.com/package/@seaveyon/harness-switch)

[English](./README.md) | 简体中文

**harness-switch** 是一个基于 Bun 的 Web 控制面，用于在 SSH 服务器或无图形界面的机器上管理 API 配置。它可以为 **Claude Code**、**Codex**、**Kimi Code**、**Pi** 和 **DeepSeek Harness (DSH)** 切换 API Base URL、API Key 和模型配置。

它直接写入各工具的原生配置，不是 API 代理，也不转发模型流量。配置档案落盘加密，写入具备事务保护，每次激活都有备份和可撤销的操作记录。

## 安装与运行

运行时需要 [Bun](https://bun.sh) >= 1.2，可以使用任意常见包执行器启动：

```bash
bunx @seaveyon/harness-switch@latest
npx -y @seaveyon/harness-switch@latest
pnpm dlx @seaveyon/harness-switch@latest
```

安装了 `pnpx` 的环境也可以使用 `pnpx @seaveyon/harness-switch@latest`。也可以全局安装：

```bash
bun add -g @seaveyon/harness-switch
# npm install -g @seaveyon/harness-switch
# pnpm add -g @seaveyon/harness-switch
harness-switch
```

命令默认启动后台守护进程并监听 `127.0.0.1:8787`。可读取自动生成的 Web 密码：

```bash
cat ~/.harness-switch/web_password
```

对于远程 SSH 服务器，请让服务保持绑定在回环地址，并通过 SSH 隧道访问：

```bash
ssh -N -L 8787:127.0.0.1:8787 user@your-server
```

然后在本地浏览器打开 <http://127.0.0.1:8787>。使用 `harness-switch status`、`stop`、`server` 可查看状态、停止服务或改以前台模式运行。

### 界面语言

Web 界面支持简体中文和英语。可以通过登录页或 Dashboard 顶栏的语言按钮进行切换；默认保持简体中文，选择结果会保存在浏览器中，后续访问会自动沿用。该设置只影响 Web 界面，不会改变配置档案数据或生成的原生配置文件。

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

一次写入要么完整生效，要么完全不生效：内容会先经过校验，中途失败则恢复到先前状态 —— 原本不存在的文件会被删除，而不是留下一个空文件。恢复走同一套保证，并且在覆盖 live 文件之前先给它们单独存一份快照，方便撤销这次恢复。

备份目录位于被管理用户自己的 Home 下，所以在以 root 运行时，该账号本身能改写自己的 manifest。因此 manifest 里的任何内容都不会被当作写入目标：它只记录 Harness 与目标键，实际路径在恢复时由该 Harness 的适配器重新解析，快照文件名必须是备份目录内的普通文件。任何解析后落在该用户可管理目录之外的路径 —— 例如把 `~/.claude` 指向别处的软链 —— 一律拒绝读写。

从某个配置切走时，会先把实际文件的内容读回该配置的记录，因此你直接在 CLI 工具里做过的修改不会在下次切换时丢失。

### 操作记录与撤销

进程内的 `try/catch` 只能处理抛出的异常；断电、SIGKILL、OOM 或升级重启时它根本没机会运行，原生配置、配置档案和「当前激活」记录就可能停在互相矛盾的状态。

因此每次写入原生配置前，都会先在 `~/.harness-switch/journal/` 落一条记录，并随操作推进状态：

```
PREPARED → APPLYING → METADATA_COMMITTED → COMMITTED
                              ↘ ROLLED_BACK / DEGRADED
```

服务启动时会扫描每个可管理用户的记录并收尾。分界点是 `METADATA_COMMITTED`：到这一步为止该操作想改的东西已经全部落盘，所以它会被向前推进为 `COMMITTED`，而不是回滚一次用户看到已经成功的切换；停在 `APPLYING` 的则可能只写了一半，会整体回滚。回滚本身失败时记为 `DEGRADED` 并在界面上标出，等人工处理。

激活时写 `active.json` 已被纳入同一个事务，所以配置文件和「当前激活」的记录不会再各说各话。每条记录就是一张收据，包含变更的文件、备份编号、目标用户和当时的状态；顶栏的 **操作记录** 可以查看并一键撤销 —— 撤销会把原生文件和 `active.json` 一起退回操作前，而不只是恢复几个文件。撤销本身也会先做一次快照。备份被轮换掉之后，对应收据会自动标为不可撤销。

`HSW_JOURNAL_RETAIN` 控制保留的记录条数，默认 50。

### 导入已有配置

如果你在装 harness-switch 之前就手工配好了这些工具，顶栏的 **导入已有配置** 可以把它们接管过来，不必重新录一遍。

扫描会读取五个工具当前的配置文件，列出其中每一个 provider：additive 模式的工具（Codex、Kimi Code、Pi、DeepSeek Harness）配了几个就列几个，并标出当前正在使用的那个；Claude Code 只有一份路由，因此至多一条。凭据不会随扫描结果返回，界面上只显示掩码；导入时由服务端重新从磁盘读取，明文始终不经过浏览器。

每条候选可以单独决定存成独立配置，还是把凭据抽进凭据库再引用；如果库里已经有一模一样的凭据，界面会直接提示复用而不是新建。同名配置默认跳过，需要显式勾选才覆盖。有些 provider 从环境变量读凭据（例如 Codex 的 `env_key` 模式），磁盘上没有可读的 key，这类候选需要你手动补一个。

**扫描和导入都不会改动工具本身的配置文件。** 导入只写 harness-switch 自己的配置档案和凭据库；要真正生效，还需要你手动激活一次。配置文件存在但无法解析时，该工具会被整体跳过并说明原因，而不是猜测其内容。

### 把所有配置迁移到另一台机器

使用顶栏的 **导入 / 导出** 可以生成一个 `.hsw-backup` 文件，其中包含全部 Harness 配置、API Key、原始文件覆盖内容以及当前的激活选择。该包用你自己设定的迁移密码加密，因此不依赖源机器的 `aes-256-gcm.key`。

在目标机器上选择该文件并输入迁移密码。界面会在写入任何内容之前展示配置数量和同名冲突。导入默认保留目标机器上的配置；覆盖需要显式选择。是否恢复导出时的激活状态是可选的。

Codex 官方登录缓存（`$CODEX_HOME/auth.json`）默认不包含在导出包内。即使导出包包含该缓存，也只有在包内与目标机器的 JSON 内容确实不同时，导入界面才会提示迁移并要求二次确认；内容一致时不会重复提示或写入。

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

来源用户的 Codex 官方登录缓存（`auth.json`）是唯一可选的例外。只有源、目标 JSON 内容确实不同时才会显示迁移选项；迁移默认不勾选，并需要再次确认。覆盖前会备份目标缓存，新文件归目标用户所有且权限为 `0600`。

跨用户写入必须具备目标 Home 的权限。要同时管理 `root` 和普通用户，通常需要以 root 运行 harness-switch；新建文件和目录会设置为目标用户的 UID/GID。此时 Web 密码等同于管理所有已开放用户配置的权限，因此务必保持回环监听并使用 SSH 隧道。可用 `HSW_USERS=root,alice` 限制界面中允许管理的账号。

### CLI 自动化

CLI 通过已运行的本地守护进程调用与 Web 界面相同的认证 HTTP API。使用数据命令前需先启动一次守护进程；`help` 和 `version` 无需连接服务。数据命令支持 `--json`（或 `-j`），便于脚本化：

```bash
harness-switch list                          # Harness、激活配置与配置数量
harness-switch profiles [claude]             # 无密钥的配置列表，可按 Harness 过滤
harness-switch create claude main \
  --base-url https://api.example.com/v1 \
  --model claude-sonnet-4-5 \
  --api-key-env ANTHROPIC_TOKEN              # 避免密钥进入 shell 历史
harness-switch providers                     # 凭据库条目
harness-switch doctor                        # 只读诊断
harness-switch doctor --strict --harness claude  # 有 error 检查时退出码为 1
harness-switch plan claude main              # 激活将写入的原生文件精确内容
harness-switch activate claude main --yes    # 激活一个配置
harness-switch official claude --yes         # 恢复工具自身的官方登录
harness-switch delete claude old --yes        # 只能删除未激活配置
harness-switch users                         # 可管理的本地 Unix 用户
harness-switch list --user alice             # 查看 alice 的独立配置
harness-switch activate codex main --user alice --yes
harness-switch sync --from root --to alice   # 一次性复制；同名项默认跳过
harness-switch sync --from root --to alice --overwrite
harness-switch scan                          # 列出五个工具磁盘上已有的 provider
harness-switch import codex:alpha --name 主力  # 存成配置；不改动工具本身
harness-switch import claude:claude --vault  # 把凭据抽进凭据库再引用
harness-switch operations                    # 操作收据，最新在前
harness-switch undo <operation-id>           # 撤销一次完整操作
```

`plan <harness> <profile>` 会输出完整渲染内容，其中可能包含 API Key。修改类命令在 TTY 中会询问确认，在非交互式终端（CI）中必须加 `--yes`。建议使用 `--api-key-env VAR`，不要把密钥直接放入 shell 历史或进程参数。完整命令说明见 `harness-switch help`。`HSW_URL` 可选择非默认本地服务地址；`HSW_DATA_DIR` 告诉 CLI 去哪里读取 `web_password`。

JSON 错误会尽可能保留 HTTP 状态码和稳定的服务端错误码。每次 CLI 调用退出前都会注销自己的临时 API Session，因此长期自动化不会让持久化的 Web Session 表不断增长。

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
| `HSW_URL` | `http://127.0.0.1:$PORT` | 需要调用 API 的 CLI 命令所连接的服务地址。 |
| `HSW_DATA_DIR` | `~/.harness-switch` | 管理端以及启动服务用户的数据目录；其他用户使用各自 Home 下的 `.harness-switch`。 |
| `HSW_HOME_DIR` | `$HOME` | 启动服务用户的 Home 覆盖值，主要用于测试和容器部署。 |
| `HSW_USERS` | 自动发现 | 逗号分隔的本地用户名允许名单，例如 `root,alice`。启动服务的用户始终可管理。 |
| `HSW_UPDATE_CHECK` | `1` | 设为 `0` 可跳过 npm registry 更新检测；本地开发命令会自动设置。 |
| `HSW_SESSION_TTL_HOURS` | `24` | Web 登录的有效时长（小时）。会话可以跨服务重启保留。 |
| `HSW_BACKUP_RETAIN` | `10` | 保留的快照数量。 |
| `HSW_JOURNAL_RETAIN` | `50` | 保留的操作收据数量。 |
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
| `POST` | `/api/harnesses/:id/official/activate` | 让支持的 Harness 恢复工具自身的官方登录 |
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
| `GET` | `/api/scan` | 五个工具磁盘上已有的 provider；只读，凭据以掩码返回 |
| `POST` | `/api/scan/import` | 把选中的候选存成配置或凭据库条目；不改动工具本身的配置 |
| `GET` | `/api/operations` | 操作收据，最新在前 |
| `GET` | `/api/operations/:id` | 单条收据 |
| `POST` | `/api/operations/:id/undo` | 把原生文件与「当前激活」一起退回该操作之前 |

所有 POST/PATCH 的请求体都会先经过一份共享的 Zod Schema（`packages/shared/src/schemas.ts`），前后端共用同一份定义。形状不合法的请求在写入存储之前就返回 `400`，并指明具体字段，而不是先落盘、直到下次激活时才报 `500`。请求体中未知的字段会被丢弃而非拒绝，因此旧版客户端仍可工作，同时不会有无法识别的内容进入存储。

## 后台守护进程（bunx / npx / pnpm）

发布的 CLI 默认以后台守护进程方式运行：命令立即返回，关闭终端后服务依然在跑；发布新版本后重新运行，会重启守护进程并切换到最新版本。

```bash
bunx @seaveyon/harness-switch@latest             # 启动，或更新并重启守护进程
bunx @seaveyon/harness-switch@latest status      # 查看 pid、地址、日志路径
bunx @seaveyon/harness-switch@latest stop        # 停止守护进程
bunx @seaveyon/harness-switch@latest server      # 改为前台运行
bunx @seaveyon/harness-switch@latest list        # CLI 自动化（见上文）
```

也可以把 `bunx` 替换为 `npx -y`、`pnpm dlx` 或 `pnpx`。加上 `@latest` 可以让包执行器先获取最新发布版本；安装后的可执行文件仍以 Bun 作为运行时。

守护进程把 PID、实例身份和实际监听地址写入 `~/.harness-switch/daemon.pid`，把日志写入 `~/.harness-switch/daemon.log`（每次启动重新生成）。首次运行会创建 Web 登录密码 `~/.harness-switch/web_password` 并打印到日志。如果已有守护进程在运行，再次调用会先停掉旧进程再启动新进程，因此端口不会冲突，最新代码总是生效。

新进程只有通过 `/healthz` 检查后才会报告启动成功。记录的守护进程不健康时，`status` 返回非零退出码；`stop` 或更新在发送信号前会验证实例身份，避免陈旧 PID 被系统复用后误杀无关进程。

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
