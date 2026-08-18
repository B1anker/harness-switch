# 设计决策记录

这份文档记录 harness-switch 为什么按现在的方式写配置。第一版的结论（"用统一 env.sh 桥接所有工具"）已经被推翻，原因写在下面。

## 为什么不用环境变量

最初的实现把所有 harness 都归约成生成 `~/.harness-switch/env.sh`，让用户 `source` 一次。这条路在真实场景下不成立：

- 常驻进程（例如 Multica 之类的 daemon）在启动时环境就固化了，它 spawn 出来的 CLI 拿到的是 daemon 的环境，不是你刚 source 过的那个 shell 的环境。切换后必须重启 daemon 才生效，这就不叫"切换"了。
- 更要紧的是，五个工具里只有 Claude Code 真的把凭据环境变量当作一等公民。其余几个当时用的变量名要么是猜的，要么根本不存在，等于给了用户一个完全不生效的开关：
  - Codex 认的是 `config.toml` 里的 `model_provider` 与 `[model_providers.x].base_url`，`OPENAI_BASE_URL` / `CODEX_MODEL` 不是它的开关。
  - Kimi Code 的官方文档明确说它不从 shell 读取凭据，`KIMI_BASE_URL` / `KIMI_API_KEY` 是空转。
  - pi 认的是 `~/.pi/agent/models.json` 与 `settings.json`，`PI_API_BASE` / `PI_API_KEY` / `PI_MODEL` 不存在。没有写进 provider 的 `apiKey` 时，Pi 会提示 No models available 并要求 `/login`。

所以现在的做法是直接写各工具自己的配置文件，`env.sh` 降级为兼容层，且只输出对应工具确实认识的变量。

## Claude Code：settings.json 的 env 块

Claude Code 会自己读 `~/.claude/settings.json` 的 `env` 块，并且这里的值优先于从 shell 继承来的同名变量。这两点合起来正是 daemon 场景能成立的原因：不管父进程的环境是什么，settings.json 说了算。

第三方中转普遍要求 `ANTHROPIC_AUTH_TOKEN` 而不是 `ANTHROPIC_API_KEY`，用错会 401，所以这是一个可选字段，默认前者。切换时必须删掉另一个变量，否则两个凭据同时存在，Claude Code 会挑错。

## Codex：不能碰 auth.json

Codex 的 `auth.json` **就是登录缓存本身**，里面有 `tokens.refresh_token` 与 `auth_mode`。cc-switch 默认往里写 `OPENAI_API_KEY`，代价是官方 ChatGPT 登录态不可恢复。

所以默认改成 `experimental_bearer_token`：token 直接放在 `[model_providers.<id>]` 里，完全不碰 `auth.json`。官方措辞是 discouraged，但这是唯一既自包含又不破坏登录态的方案。另外两种模式仍然保留：

- `env_key` 最符合官方推荐，但密钥来自进程环境变量，正好踩在本项目要解决的问题上。
- `requires_openai_auth = true` + `auth.json` 兼容性最好，写之前会先把旧 `auth.json` 完整快照进备份。注意此模式下 Codex 会忽略 `env_key`，两者不能同设。

还有两个约束：只能写用户级 `$CODEX_HOME/config.toml`，因为项目级 `.codex/config.toml` 里的 `model_provider` / `model_providers` 会被忽略并告警；provider id 不能撞上 `openai` / `ollama` / `lmstudio` / `amazon-bedrock` 以及历史别名 `oss` / `ollama-chat`。

## Kimi Code 不是 Kimi CLI

两个并行产品，命令都叫 `kimi`：

- **Kimi Code**：`~/.kimi-code/config.toml`，`KIMI_CODE_HOME` 覆盖。这是本项目的目标。
- **Kimi CLI**：Python 实现，`~/.kimi`，`KIMI_SHARE_DIR` 覆盖。第一版写错到了这里。

## 替换模式与追加模式

Claude 和 Codex 的配置文件里只存当前那一个 provider，切换即整段替换。Kimi 和 Pi 的配置文件天然是"多 provider 共存 + 一个当前指针"：Kimi 的指针是 `default_model`，Pi 是 `settings.json` 的 `defaultProvider` / `defaultModel`。

对追加模式的文件做整段替换，就会摧毁用户手写的其他 provider——第一版的 Kimi 适配就是这个 bug。所以适配器要声明自己属于哪种模式，追加模式只增改自己那一条并移动指针。

## 移除 zcode

zcode 是智谱自研 Agent 的桌面 ADE，不是 Claude Code 系。它没有环境变量凭据通道（`ZCODE_*` 全是运行时开关），官方也没有公开的 CLI 配置契约（唯一可用的 `zcode` 命令来自非官方 npm 包 `zcode-app-cli`，且它的 provider key 被限定为 `zai` / `bigmodel`）。继续留着等于提供一个完全不生效的开关，因此从列表移除，等官方给出配置契约再加回。

## 可靠性

从 cc-switch 抄来的三条，加上一条它踩过的坑：

1. **先校验后写**：所有目标文件的内容先全部 parse 一遍，再落盘。写坏的配置会让工具起不来。
2. **原本不存在则回滚为删除**：失败回滚时，之前不存在的文件要删掉而不是写成空文件。
3. **切走前回填**：激活新 profile 前，先把当前 live 文件的内容读回旧 profile 的记录，这样用户在 CLI 里手改的配置不会丢。
4. **回填不能覆盖自己的私有字段**：`notes`、`extras` 这些 live 文件表达不了的字段必须原样保留，否则编辑界面会显示空值并在保存时把数据清掉——cc-switch 在 Codex 的 `modelCatalog` 上踩过这个洞。

备份一律落在自己的数据目录，不在 `~/.claude/` 之类目录里放 `.bak`：Claude Code 会扫自己的配置目录，多出来的文件有被误读的风险，这也是 cc-switch 刻意不给 live 文件做同目录备份的原因。

已知代价：TOML 走 parse → stringify 往返会丢掉注释和排版（cc-switch 用 Rust 的 `toml_edit` 可以保住）。缓解手段是备份里存的是原始文本，可一键恢复。YAML 用 Document API 合并，注释能保住。

## 与 cc-switch 家族的关系

[cc-switch-web](https://github.com/Laliet/cc-switch-web) 和 [cc-switch-cli](https://github.com/SaladDay/cc-switch-cli) 都是成熟的 headless 方案，覆盖 Claude Code、Codex、Gemini CLI、OpenCode 等。如果你要管的就是这些工具，直接用它们更划算，功能面更广。

本项目的存在理由是覆盖 Kimi Code 与 Pi，并且把"写完即生效"这件事做实。写入机制、两种模式的区分、备份与回填的顺序都参考了 cc-switch 的实现。

## 安全模型

服务默认监听 `127.0.0.1:8787`，推荐通过 SSH 隧道访问。Web 登录使用首次启动随机生成的密码，session cookie 为 HttpOnly + SameSite=Lax。

API key 以 AES-256-GCM 加密保存在 `~/.harness-switch/profiles.json`，密钥在同目录的 `aes-256-gcm.key`，两者与 `env.sh` 都是 `0600`。写入工具自己的配置文件时保留该文件原有权限，新建文件用 `0600`。

profile 列表不回显明文 key，但"原始配置预览"和生成的配置文件本身必须包含凭据才有意义——这是一个有意的取舍，前提是该接口需要认证。
