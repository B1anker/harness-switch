# cc switch 与 SSH 服务端方案调研

## 结论摘要

目前已经存在一个比较成熟的 headless 方案：**[cc-switch-web](https://github.com/Laliet/cc-switch-web)**。它提供 Web Server 模式、Basic Auth、预编译 Linux 二进制与 Docker 部署，适合在 SSH 服务器上管理 Claude Code、Codex、Gemini CLI、OpenCode、OpenClaw 和 OMO 的配置。[1] 但它的公开支持范围没有覆盖用户指定的 **pi、zcode、Kimi Code**，因此不能直接作为五类 harness 的完整统一入口。

另一个值得关注的是 **[cc-switch-cli](https://github.com/SaladDay/cc-switch-cli)**，它提供 TUI/CLI 和脚本化命令，适合在无桌面服务器上运行，但公开文档中同样主要围绕 Claude Code、Codex、Gemini、OpenCode、Hermes 与 OpenClaw，并不是 Web 管理面板，也没有覆盖 pi、zcode、Kimi Code。[2]

因此本项目没有重新实现一个完整的 provider/router，而是实现了一个**服务器端配置控制平面**：Web 页面管理五类 harness 的 profile，API key 加密存储；激活后生成环境文件，并针对 Claude Code 与 Kimi Code 写入已知的原生配置格式。这样可以最大限度避免侵入各个 CLI，也不需要代理模型流量。

## 方案比较

| 方案 | SSH/headless | Web 页面 | Claude Code | Codex | pi | zcode | Kimi Code | 结论 |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| cc-switch 桌面版 | 否 | 桌面 GUI | 是 | 是 | 未见公开支持 | 未见公开支持 | 有 Kimi 相关能力，但不是用户指定的完整五项 | 不适合直接放 SSH 服务器 |
| cc-switch-cli | 是 | 否，TUI/CLI | 是 | 是 | 未见公开支持 | 未见公开支持 | 未见完整独立适配 | 适合命令行用户，不满足 Web 需求 |
| cc-switch-web | 是 | 是 | 是 | 是 | 未见公开支持 | 未见公开支持 | 未见公开支持 | 最成熟的现成 Web 方案，但覆盖面不够 |
| 本项目 harness-switch | 是 | 是 | 是 | 通过环境文件 | 通过环境文件 | 通过环境文件 | 原生 TOML + 环境文件 | 面向五类 harness 的轻量配置层 |

## 关键技术事实

Claude Code 官方文档说明，环境变量可以控制认证、模型与请求路由，因此 `ANTHROPIC_BASE_URL`、`ANTHROPIC_API_KEY` 和模型变量适合被切换器管理。[3]

Kimi Code 官方文档明确使用 `~/.kimi/config.toml`，并在 `providers` 中配置 `type`、`base_url` 和 `api_key`，模型再通过 `models` 绑定 provider。[4] 本项目在激活 Kimi profile 时生成最小可用 TOML 配置。

Pi 官方文档提供了自定义 provider 的配置能力，包括 `baseUrl`、`apiKey`、API 协议类型等字段。[5] 由于不同 pi 发行版或扩展可能选择不同的 `models.json` 路径，本项目第一版采用环境文件桥接，不覆盖用户已有的 pi 配置。

ZCode 官方文档允许在配置界面选择或手动填写供应商 Base URL 和 API key。[6] 由于其客户端配置路径和变量名可能随版本变化，本项目默认使用 `ZCODE_BASE_URL`、`ZCODE_API_KEY` 和 `ZCODE_MODEL` 作为通用桥接变量，并在 README 中明确标注这一边界；后续可根据用户实际 zcode 版本补充原生适配器。

Codex 的配置通常由 `CODEX_HOME/config.toml` 与环境变量共同影响，具体 provider 格式会随版本变化。[7] 为避免覆盖用户现有的 Codex 复杂配置，本项目第一版将 Codex profile 写入统一环境文件，使用 `OPENAI_BASE_URL`、`OPENAI_API_KEY` 和 `CODEX_MODEL`。

## 安全模型

服务默认监听 `127.0.0.1:8787`，推荐通过 SSH 隧道访问；如果需要远程访问，应放在 HTTPS 反向代理之后，而不是直接暴露带密钥管理能力的 HTTP 端口。Web 页面采用一次性生成的随机密码进行登录，服务端 Session cookie 设置为 HttpOnly 和 SameSite=Lax。

API key 不会在 profile 列表中回显。服务器将 API key 以 Fernet 加密形式保存到 `~/.harness-switch/profiles.json`，密钥保存到权限为 `0600` 的 `~/.harness-switch/fernet.key`。这不是硬件安全模块，也不能替代服务器磁盘加密；它的目标是避免配置文件被直接阅读时泄露明文 key。

激活后生成的 `~/.harness-switch/env.sh` 包含明文 API key，因此该文件也设置为 `0600`。使用者应避免把它提交到 Git、粘贴到工单或通过不安全渠道共享。

## 项目交付范围

项目目录为 `/home/ubuntu/harness-switch`，包括 Flask 服务、响应式 Web 控制台、加密 profile 存储、激活 API、环境文件生成、Claude/Kimi 原生配置写入逻辑、README 部署说明与 systemd 示例。已完成 Python 语法检查，并通过本地端到端冒烟测试：登录、保存 Claude profile、激活 profile、生成环境文件均正常。

## 后续建议

如果你的主要目标只是管理 Claude Code、Codex、Gemini CLI、OpenCode 等已覆盖客户端，应优先直接部署 cc-switch-web，因为它的功能面更广，并且已有 headless 二进制和 Docker 镜像。[1] 如果你确实需要 pi、zcode、Kimi Code 五者统一管理，则使用本项目作为基础更合适；下一步只需要根据你服务器上实际安装的 pi 与 zcode 版本，确认它们的原生配置文件路径，再把通用环境桥接升级为原生适配器。

## References

[1]: https://github.com/Laliet/cc-switch-web "Laliet/cc-switch-web"

[2]: https://github.com/SaladDay/cc-switch-cli "SaladDay/cc-switch-cli"

[3]: https://code.claude.com/docs/en/env-vars "Claude Code environment variables"

[4]: https://moonshotai.github.io/kimi-cli/en/configuration/config-files.html "Kimi Code CLI configuration files"

[5]: https://pi.dev/docs/latest/custom-provider "Pi custom providers"

[6]: https://zcode.z.ai/en/docs/configuration "ZCode configuration"

[7]: https://learn.chatgpt.com/docs/config-file/config-basic "Codex configuration basics"
