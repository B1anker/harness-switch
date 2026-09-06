# 模型收藏夹 Spec

状态：实现待评审；自动化与隔离环境验证见[实现记录](model-favorites-implementation.md)，A24 实机发布验收尚未完成

日期：2026-09-05

代码基线：`86f2b90`（`main`，应用版本 `0.30.1`）

范围：产品行为、数据契约、适配边界、迁移及验收

## 1. 产品目标

用户把一个模型收藏一次，为它连接自己已有的供应商，然后把它配置到需要的编程工具。更换渠道时不用重建模型设置，更换工具时不用从头查字段、填写参数。

首版的可演示流程：

1. 从 Pi 的一个已有配置收藏“我的主力模型”，复用其凭据库条目。
2. 为收藏增加第二个渠道，保留该渠道自己的请求模型名、协议与能力声明。
3. 选择 Pi、DSH、Claude；界面给出各工具可用渠道、参数映射和不能表达的设置。
4. 确认后生成三个普通配置，尚不改变当前激活项。
5. 激活其中一个；以后从收藏更换渠道、预览差异并更新该工具配置。

衡量价值的单位是减少多少次重复录入和手工维护，而不是收藏数量。首版验收要求同一模型配置到第二个工具时，无需再次输入密钥、已保存的请求模型名或已有且可表达的公共参数。

## 2. 当前事实与设计约束

以下是上述提交的代码事实，不是对任意版本 CLI 的兼容承诺。

| 当前实现 | 对设计的影响 |
| --- | --- |
| `ProfilePublic` 绑定一个 harness、model、extras 和可选 provider 引用 | 收藏需要独立身份；现有 profile 继续充当可激活的最终配置 |
| Vault 已支持一个密钥、多个具名 endpoint | 收藏中的渠道引用 Vault，不再建设第二个密钥库 |
| `HarnessService.createProfile/updateProfile` 会调用原生同步；更新激活配置会重新应用 | “仅生成配置”不能直接循环调用现有业务 API，否则可能产生未预览的 live 写入 |
| `renderAvailable` 是可选能力，目前 DSH 有实现 | 不可把 `mode=additive` 当成五个工具都能安全发布到原生模型菜单的证明 |
| ProfileService 在解密时解析 Vault，原生配置仍由 adapter 渲染 | 收藏转换为 profile 后复用渲染器，不另写一套 JSON/TOML/YAML 生成器 |
| 切换前 backfill 会回读原生文件 | 回读只能更新 profile，不能反向覆盖整个收藏和其他工具 |
| Journal 的操作以单个 harness 为上下文，metadata 当前为 profiles/active/vault | 首版按工具逐项事务，不宣称跨工具原子提交 |
| Transfer 明文 payload 和加密 envelope 当前均为版本 1 | 收藏迁移需要明确 payload 版本，不能让旧客户端静默丢失收藏关系 |

源码入口：

- [共享类型](../../packages/shared/src/types.ts)、[Schemas](../../packages/shared/src/schemas.ts)
- [ProfileService](../../apps/server/src/services/profiles.ts)、[HarnessService](../../apps/server/src/services/harness.ts)
- [适配器契约](../../apps/server/src/services/adapters/types.ts)、[适配器目录](../../apps/server/src/services/adapters/)
- [ActivationService](../../apps/server/src/services/activation.ts)、[LiveWriteService](../../apps/server/src/services/live-write.ts)、[JournalService](../../apps/server/src/services/journal.ts)
- [ProviderService](../../apps/server/src/services/provider.ts)、[TransferService](../../apps/server/src/services/transfer.ts)

## 3. 首版范围

### 必须交付

- 用户级收藏列表：新增、编辑、搜索、删除，名称和备注均可由用户填写。
- 从已有普通 profile 收藏；从某 endpoint 的模型目录选择模型；手工输入模型。
- 一个收藏绑定多个明确的渠道；每个渠道有精确请求模型 ID 和协议。
- 将收藏生成到五个已支持工具的普通 profile；每项先验证，再提供结构化预览。
- 选择“仅生成/更新配置”或“生成/更新并激活”；对 active profile 修改有单独限制。
- 保存来源关系，支持发现收藏更新、主动更新、识别本地分歧、解除关联。
- Vault 变更、复制、重命名、删除、回读、撤销、迁移、跨用户同步的一致语义。
- Web 主流程与最小 CLI 自动化入口；中英文消息齐全。

### 首版不做

- 自动路由、自动故障切换、额度管理、代理、模型协议转换。
- 配置订阅、公共模型市场、排行榜、自动升级到名称类似的新模型。
- 官方 OAuth 账号或 DSH official provider 的模型收藏及凭据迁移。
- 项目/会话隔离、启动 CLI、热切换运行中会话。
- 把收藏批量发布到各工具原生模型菜单；特别是不新增 Codex model catalog 协议。
- 多模型角色编排，例如在一个 Claude profile 中分别绑定多个收藏到各模型档位。
- 自动推断“这是同一个底层模型”、自动猜测最大上下文和思考档位。

原生菜单发布留待第二阶段逐工具验证。首版已经可以让五个工具使用收藏模型，但交付方式是普通配置；不能在宣传中写成“五个原生菜单自动同步”。

## 4. 领域模型与身份

```text
模型收藏 Favorite（用户命名的模型身份 + 公共参数）
  ├─ 渠道 Connection A → Vault 条目 + endpoint + 协议 + 请求模型名
  └─ 渠道 Connection B → Vault 条目 + endpoint + 协议 + 请求模型名
          ↓ 选择渠道、解析参数、按工具投影
      普通 Profile（物化值 + 来源关联）
          ↓ 用户显式激活
      Harness 原生配置
```

### 4.1 收藏与渠道

收藏 ID 是服务端生成的 UUID，名称不是身份。用户可以把不同渠道的模型别名归入同一个收藏，但系统只记录这种选择，不证明上游模型真实性。

每个渠道固定一组 `(providerId, endpointKey, protocol, requestModelId)`。一个 endpoint 支持多个协议时，分别建立渠道记录；协议不能用 `auto`。endpoint 必须具名存在，不能悄悄退回 Provider 的另一个地址。

同一收藏禁止重复的上述四元组。不同收藏允许引用相同四元组，例如“主力·高思考”和“主力·快速”；重复时给出提示而不强行合并。

收藏可以没有渠道，表现为“待连接”。API 模型目录的字符串按原样保存，仅去除首尾空白；不改大小写，不删除供应商前缀，不凭后缀合并。

### 4.2 数据草案

以下为语义草案；实现必须提供对应 zod schema，不直接信任 TypeScript 类型。

```ts
type Protocol = 'openai-chat' | 'openai-responses' | 'anthropic-messages';
type Effort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';

type ModelFacts = {
  contextWindow?: number;
  maxOutputTokens?: number;
  reasoningSupported?: boolean;
  supportedReasoningEfforts?: Effort[];
};

type ModelFavorite = {
  id: string;
  revision: number;
  name: string;
  notes: string;
  defaults: ModelFacts;
  preferences: { reasoningEffort?: Effort };
  connections: Array<{
    id: string;
    label: string;
    providerId: string;
    endpointKey: string;
    protocol: Protocol;
    requestModelId: string;
    factOverrides: Partial<Record<keyof ModelFacts, unknown>>;
    preferenceOverrides: { reasoningEffort?: Effort | null };
  }>;
  createdAt: string;
  updatedAt: string;
};
```

`factOverrides` 中的 `unknown` 只是缩短草案：实际 schema 对每个字段分别限定为对应类型或 `null`。未提供表示继承；`null` 表示清除继承、变成未知。请求、存储和导入都不得保留任意字段。

- 公共事实是用户提供的配置声明，不是系统实测结果；UI 标注“填写值”，不展示“认证能力”。
- 渠道事实覆写公共事实，不取最大值或自动放宽能力。
- 思考能力、可选档位与默认思考偏好分别保存；`reasoningSupported=true` 不等于默认使用 `high`。
- `reasoningSupported=false` 与非空档位列表或需要推理的偏好同时出现时拒绝保存。
- 已声明档位列表时，偏好必须在列表内；未声明时不猜测，计划中提示“渠道档位未验证”。
- `contextWindow`、`maxOutputTokens` 为正整数，首版各不超过 100,000,000；这是输入资源边界，不代表模型能力。
- 不对所有工具强加 `maxOutputTokens <= contextWindow`；具体语义由 adapter 校验。
- 名称最多 120 字符，备注最多 4096 字符，请求模型 ID 使用当前模型字段限制；每用户最多 1000 收藏、每收藏最多 50 渠道。
- 不提供原始文件 override、任意环境变量、认证 header 或脚本作为收藏公共字段。

### 4.3 Profile 关联

`StoredProfile` 增加可选 `model_favorite`，在 public 类型中命名为 `modelFavorite`：

```ts
type ModelFavoriteLink = {
  favoriteId: string;
  connectionId: string;
  appliedRevision: number;
  projectionVersion: number;
  baseline: FavoriteProjection;
};
```

`FavoriteProjection` 是按 harness 区分的、无密钥的受控字段快照：请求模型、Vault/endpoint 引用及该 adapter 负责的模型/协议 extras。它记录上次应用收藏产生的值和字段存在性，用于检查分歧；不含完整 profile、原始文件或用户自定义认证值。

Profile 保留完整物化值。激活时使用这些已确认的值，不能临时跟随收藏最新版本；Vault 的凭据与 endpoint 解析仍保持现有规则。收藏被编辑后，旧 profile 必须仍然可以独立使用。

其中顶层 `providerId` 是 Vault 引用，`extras.providerId` 是工具原生条目标识，两者不得混用。切换渠道更新前者和物化凭据缓存，后者保持稳定。关联及 baseline 由服务端生成，普通 profile PATCH 不接受客户端伪造来源、已应用 revision 或字段所有权。

不在收藏文件中反向存 profile 名称列表；引用关系从 profile store 派生。重命名 profile 无需跨文件修改索引。

## 5. 用户流程

### 5.1 入口与列表

Dashboard 顶层增加“模型收藏夹”，和当前工具配置视图并存。收藏列表每行显示名称、渠道数、已生成的工具配置及“有更新/有分歧”计数。搜索匹配收藏名、请求模型 ID 和渠道标签。

列表不因当前模型探测失败就隐藏收藏。空状态提供“从已有配置收藏”和“手动添加”；无渠道时提供“连接供应商”。不引入星级、性能评分、推荐榜单。

收藏详情分为“模型设置、渠道、已生成配置”。公共字段与渠道覆写要显示来源，例如“继承收藏：200000”与“此渠道：128000”，并提供恢复继承按钮。

### 5.2 从已有配置收藏

1. 用户选择一个普通 profile，服务端使用 adapter 提取可确认的模型参数。
2. 已有 Vault 引用直接复用；内联密钥需明确选择“存入凭据库并复用”，服务端完成提取和加密。
3. 默认只创建收藏，不把来源 profile 改成关联配置；用户可勾选关联来源。
4. 关联来源时物化值保持原样，以当前提取结果作为 baseline；不能为了贴合默认值就重写原生文件。

已有官方 profile 拒绝此入口。存在 raw override 的来源首版拒绝提取，提示先恢复表单管理或手工建立收藏。多模型 profile 仅提取主模型，不把其他模型档位、DSH models 列表等混入收藏。

内联凭据晋升、收藏创建及可选来源关联必须在一个以来源 harness 为上下文的 metadata 事务中提交，失败则整体恢复。原生文件与 active 不改动；密钥不得通过浏览器回传、剪贴板或日志中转。

### 5.3 从模型目录收藏

用户先选 Vault endpoint，再显式获取模型目录。复用现有 ProbeService；默认只获取目录，不自动发送付费 completion。404、目录为空或网络错误不阻止手动输入模型 ID。

目录只作为模型 ID 候选。不能从一个模型名补齐视觉、上下文、输出上限等未知能力；也不能因目录里有它就标记“兼容五个工具”。

### 5.4 配置到工具

1. 选择收藏和一个或多个目标工具；首版每次每个工具只选一个渠道和一个目标 profile。
2. 每个工具显式选择兼容渠道。只有一个可选渠道时可预选；多个时不得依据价格或名字暗选。
3. 选择新建 profile，或更新已经关联本收藏的 profile；无关联同名项只允许改名新建。
4. 检查模型、协议、认证模式、投影参数和未表达字段。
5. 选择“仅生成/更新配置”或“生成/更新并激活”，查看对应写入预览后提交。

新建默认名为收藏名称；冲突使用 `名称-2`、`名称-3`，最终在提交时再检查。原生 provider ID 由独立稳定标识生成，例如 `hsw-mf-<随机ID>`，不能依赖可变显示名或未经约束的上游模型名。已有 profile 的原生 provider ID 不变。

| 操作 | profiles.json | 原生文件与 active |
| --- | --- | --- |
| 保存收藏、增加渠道 | 不改 | 不改 |
| 仅生成新 profile | 新建物化配置及关联 | 不改，即使工具支持 renderAvailable |
| 仅更新未激活 profile | 更新收藏负责字段及关联版本 | 不改；以前发布到原生的旧条目要显示待应用 |
| 仅更新已激活 profile | 有实质差异时阻止，要求选择同时应用或另存 | 不允许制造新的 active/live 不一致 |
| 生成/更新并激活 | 与激活作为同一工具事务提交 | 预览后写入，保留原有生效时机提示 |

列表中的“已生成”不能显示为“已安装到原生菜单”。更新未激活项后，从收藏 UI 后续激活也走计划流程；原有激活入口可继续使用现有 preview/activate 流程。

### 5.5 编辑、更新与分歧

编辑收藏只增加 revision 并保存。若重新投影后与 profile baseline 相同，只刷新来源版本即可，不要求重新激活；仅改收藏显示名/备注不自动重命名 profile，也不改 profile 备注。

若新投影有变化，显示“有更新”；用户选择目标后生成更新计划。默认保留 profile 的名称、备注、权限、超时、原生 provider ID、认证方式和其他不属于收藏的设置。

关联 profile 的直接编辑规则：

- 编辑非受控字段保持关联。
- 修改受控字段或增加 raw override 时，要求选择“编辑收藏”或“解除关联后编辑”。旧客户端未经选择修改受控字段时返回 409，不能静默保留一个虚假的关联。
- 本机工具修改后 backfill 发现受控字段不同，保存现场值并派生 `diverged`，不自动解除关联或更新收藏。
- 对 `diverged` 更新时必须明确选择“以收藏覆盖这些字段”或“解除关联保留当前配置”；首版不提供逐字段三方合并。
- live 文件有漂移、缺失或无效时，激活计划必须展示或阻止相应问题；“来源一致”不代表“原生文件一致”。

`sourceMissing`、`connectionMissing`、`needsUpdate`、`diverged` 是独立事实，不压成一个互斥枚举；UI 优先提示阻塞问题。删除收藏、撤销和导入都可能让这些事实组合出现。

## 6. 工具映射与所有权

公共参数经渠道覆写后得到 resolved model，由每个 adapter 的投影方法转成现有 profile 字段。前端不能直接按 `harness.id` 拼 extras。

| 工具 | 首版允许的渠道协议 | 可映射字段 | 不自动处理 |
| --- | --- | --- | --- |
| Claude | anthropic-messages | 主 model | Sonnet/Opus/Fable/Haiku/subagent 档位、1M 标志、通用思考偏好 |
| Codex | openai-responses | model、reasoningEffort | 原生模型目录、上下文/输出上限能力模板 |
| Kimi Code | anthropic-messages / openai-responses / openai-chat | model、providerType、maxContextSize | 托管 OAuth provider、Kimi 专有协议 |
| Pi | 上述三种协议 | model、api、contextWindow、maxTokens、reasoning 能力声明 | 默认思考强度选择、视觉能力模板 |
| DSH custom | 上述三种协议 | 主 model、api、contextWindow、maxTokens、reasoningEfforts 可选档位声明 | official provider、多模型列表、默认思考强度选择 |

协议枚举映射：`openai-chat` 在 Pi/DSH 中映射为 `openai-completions`，在 Kimi 中映射为 `openai_legacy`；另外两种按各 adapter 当前字段枚举映射。Codex 首版拒绝 chat-only 渠道，不通过其他协议探测成功来放行。

细则：

- DSH `supportedReasoningEfforts` 转换成其档位声明；`reasoningSupported=false` 可表达为关闭声明。不能把偏好的一个档位误写成全部可选档位。
- Pi `reasoning=true` 是模型声明，不能用它承诺启动后选中了高思考。
- Claude 更新已有 profile 时保留其他模型档位；若仍有固定映射，计划列出“这些位置继续使用原模型”。首版不创建跨供应商档位混用承诺。
- 未填写的事实保持未知。若现有 renderer 使用内置默认值，计划必须列出实际将使用的默认值及来源，不能显示成“模型已知上限”。
- 不可表达的已填写事实显示 `notRepresented`；不可表达的偏好需要用户确认忽略，且记入计划批准内容。
- 原生模型名 `[1m]` 等修饰不能未经 adapter 确认就当请求 ID；capture 发现主模型无法无损表达时阻止自动提取，允许用户手动建立。
- 原始文件覆盖优先于表单，关联 profile 不允许自动跨越该边界。

生成新 profile 时允许使用该工具现有认证表单。默认复用 Vault，Codex 使用当前默认 bearer_token 模式；不会默认写 `auth.json`。更新已有 profile 保留认证方式。选择可能覆盖登录缓存的模式继续使用现有显式确认流程，收藏操作不能绕过它。

每个投影结果包含 `ownedFields`、`set`、`remove`、`warnings`、`blockers`。清除收藏字段时要显式移除以前由收藏写入的对应值，不得留下旧值；同时不能删除从未归收藏管理的字段。`projectionVersion` 随映射规则变化递增，规则升级也需要重新预览。

## 7. 计划、事务与恢复

### 7.1 计划

计划是服务器生成的、与登录会话和目标 Unix 用户绑定的短期对象，有效期 10 分钟；ID 不携带密钥。响应只给脱敏差异与摘要，完整候选配置留在服务端，客户端不能上传 rendered files 作为执行指令。

计划固定：收藏 revision、渠道内容、adapter 投影版本、目标 profile 原始内容指纹、Vault 凭据与 endpoint 内部指纹、active、相关原生文件存在性与内容、覆盖/忽略决定、目标用户、操作模式。敏感指纹不返回客户端。

保存计划的文件目标为空；激活计划包括所有实际写入文件。提交时在写锁内重新核对；任一相关输入变化返回 `409 favoritePlanStale`，要求重新预览。模型探测不纳入事务，也不能在提交中隐式计费。

并发前提按目标 profile、该 harness 的 active 和目标文件核对，不把整个共享 profiles/active 文件的哈希当作每项前提。否则批次第一项的合法写入会让第二项错误地过期。批次共用用户写锁，各项从最新共享 store 合并自己的变更，禁止用计划时的全文件副本覆盖上一项结果。

### 7.2 提交粒度

- 每用户对配置写操作串行，覆盖收藏应用、profile 改动、Vault 修改、导入、原生激活、撤销；持锁阶段不得 await 网络请求。
- 服务管理下的写锁避免本服务内的竞争。外部 CLI 不遵守该锁，因此提交前最后检查文件；无法承诺对任意外部写入绝对原子隔离。
- 一个批次最多五项，每个 harness 一项，按稳定顺序串行提交；每项原子，批次允许部分成功。
- 某项提交失败并成功回滚后继续其他项；出现 `DEGRADED` 停止余下批次，防止扩大不确定状态。
- 结果逐项返回 `applied / unchanged / failed / skipped`、稳定错误码及 operationId。成功项不会因另一工具失败自动回滚。

仅保存项以 `writes=[]`、metadata profiles 做持久 journal 事务。激活项把 profile 物化、当前项 active 和原生写入放在一个事务里。切换前 backfill 所写的 profiles 也必须纳入该事务边界；不能先改 profile 再调用旧激活 API，留下崩溃窗口。

实现应从现有激活服务拆出可复用的“准备激活”和“提交激活”内部契约，继续使用同一 adapter、备份和 journal；不能嵌套互相独立的事务。`env.sh` 保留现有提交后派生更新语义，失败为 warning，记录“已激活，兼容环境文件未更新”。

### 7.3 幂等与撤销

提交带用户作用域 requestId；operation receipt 保存对应批次项标识及结果。重复提交相同请求返回已提交结果，不重复创建 profile、激活或备份；同 ID 不同批准内容返回 409。

Journal 增加版本化的批次标识、项序号、批准内容内部指纹和可公开结果字段，并在写入前持久化身份；无修改项也需要有可查询结果。幂等查询先于计划有效期判断，已完成请求不能因计划过期再次执行。保证期限与收据保留期一致；收据被清理且计划失效后只返回过期错误，不能复用同一旧计划重新执行。

服务重启后未提交计划失效；已提交项从 journal 查询结果。部分完成的批次先显示已成功项，剩余项重新规划，不猜测执行到哪里。

撤销以单个 operation 为单位，恢复该项 profile、来源关联、active 和原生快照，不修改收藏的新版本。由于现有 journal 会快照整个 metadata 文件，新增操作的撤销必须比较提交后 metadata 与当前内容；若后续有相关文件修改则拒绝旧快照覆盖，提示重新生成修复计划。不得为了撤销一个收藏应用而丢掉后来新建的其他 profile。

元数据新增 `favorites` 白名单键，用于 capture 和含收藏的迁移恢复。恢复路径必须由 EnvironmentService 派生，不接受 journal/导入包提供的任意路径。失效备份、回滚失败及旧版本 journal 的处理继续遵循现有规则。

## 8. 生命周期与兼容

| 事件 | 必须行为 |
| --- | --- |
| 收藏改名 | UUID 不变，profile 名不变 |
| 渠道修改 model/protocol | 收藏 revision 增加，关联 profile 等待用户应用 |
| Vault 轮换密钥 | 沿用当前 profile cache sweep 与 active 重应用；收藏不复制密钥，旧计划失效 |
| Vault endpoint 改 URL | 列出受影响收藏/配置，沿用现有明确的 Provider 更新语义；旧计划失效 |
| 删除被收藏引用的 Vault/endpoint | 409 并列出引用，即使还没生成任何 profile；不能只检查 profile 引用 |
| 删除被 profile 引用的渠道或收藏 | 默认 409；先显式解除关联保留 profile，再删除 |
| 复制关联 profile | 默认生成独立副本，不复制关联；继续用原有安全凭据复制路径 |
| profile 重命名 | 保持关联，列表按实际新名称派生 |
| 删除关联 profile | 沿用现有 profile 删除/原生清理语义，收藏仍保留 |
| 从收藏生成的 profile 被手工改存储 | schema 验证，能读取时检查分歧；关联损坏不应导致整个配置列表崩溃 |
| 来源不存在 | profile 的物化配置仍可使用，显示来源缺失，可解除关联；缺失 Vault 不能当来源缺失绕过认证校验 |

`IProfileService` 不依赖收藏服务。Vault 的引用检查在上层协调服务聚合 profiles 与 favorites；不能让 Vault 与收藏服务互相注入造成 DI 环。

### 8.1 存储与升级

新增当前管理用户数据目录下的 `model-favorites.json`，内容为 `{ schemaVersion: 1, favorites: [...] }`，使用现有用户路径和安全原子写入能力，权限 `0600`。虽然不含密钥，仍含用户偏好及供应商关联。

文件缺失视为收藏为空；损坏文件不能静默覆盖为空。收藏区域显示可恢复错误，普通 profile 操作继续可用。通过 zod 校验未知版本，拒绝写入不认识的 schema。并发编辑使用 expectedRevision/If-Match，缺失前提为 428，过期为 409。

升级时旧 profile 无关联即可继续工作，不扫描 live 文件、不批量创建收藏、不迁移密钥。关联字段及 baseline 的所有保存路径必须贯穿，不得被 upsert/backfill/rename/sweep 丢弃。

### 8.2 导出、导入、GitHub 同步与跨用户复制

- 新版 portable payload 使用版本 2，增加 favorites 和 profile 来源关联；加密 envelope 仍可为版本 1，因为密码学格式未改变。
- 新版 reader 接受 payload v1/v2；v1 没有收藏。旧 reader 会拒绝 v2；UI 清楚标记目标版本要求。
- 提供显式“兼容旧版导出”：输出 v1 的物化 profiles/providers，去除收藏关系并提示收藏不会迁移。不能默认降级丢数据。
- v2 导入按独立副本恢复收藏，ID 冲突重新分配；先生成 provider ID、favorite ID、connection ID 映射，再重写引用。相同名称不等同相同收藏。
- 关联 profile 被冲突策略跳过时，保留目标原有关联；导入收藏可保留为未使用项并在预览列出。不让源关联接管被跳过的目标 profile。
- 每个导入关联都必须解析到本包对应的收藏/渠道/provider；外部或断裂引用明确拒绝或由用户选择“仅导入独立 profile”，不隐式绑定本机同 ID 实体。
- 导入事务将 favorites 纳入 metadata 恢复。恢复激活及 Codex 登录缓存仍是既有独立确认语义。
- GitHub 同步复用版本化 Transfer payload；跨用户复制选中 profile 时携带其关联收藏、所选渠道及必要 provider 的依赖闭包，目标端重新加密和重映射 ID，不复制其他无关渠道凭据。
- 新 API 的列表/计划/应用结果都不返回密钥；既有加密迁移包继续可能包含凭据，不把“收藏文件不含密钥”误写成整个导出包不含密钥。

## 9. 服务、API 与 Web 集成

### 9.1 服务边界

| 建议组件 | 职责 |
| --- | --- |
| `IModelFavoriteStore` / `services/model-favorite-store.ts` | schema 校验、revision CAS、收藏存储；不依赖 profiles、Vault 或 activation |
| `IModelFavoriteService` / `services/model-favorite.ts` | CRUD 业务校验、渠道解析、引用检查、capture；消费底层 store 和现有服务标识符 |
| `IModelFavoriteApplyService` / `services/model-favorite-apply.ts` | 计划、分歧判定、投影、幂等、事务协调 |
| adapter 扩展 | `favoriteSupport`、`extractFavorite`、`projectFavorite`；纯映射和校验，无网络与存储写入 |
| 现有 Profile/Activation/Journal | 物化配置、关联透传、单工具事务与恢复；共享准备/提交能力 |

新服务在 bootstrap 中通过 identifier 注册，低频服务用 delayed descriptor；业务逻辑不进入 HTTP handler。实现前画出最终 DI 依赖图，禁止 Profile → FavoriteApply → Profile 环。

### 9.2 API 草案

所有新增响应遵循 `{ code, data, msg }`，下面只列 data 的语义。请求用共享 zod schema，错误显式使用 ERROR_CODES；新增消息组接入 catalogKey，zh-CN/en 同步。

| 方法与路径 | 语义 |
| --- | --- |
| `GET /api/model-favorites` | 收藏及派生渠道/引用状态；不请求上游 |
| `POST /api/model-favorites` | 创建收藏；可先无渠道 |
| `PATCH /api/model-favorites/:id` | expectedRevision + 字段更新；连接数组按明确 ID 更新，不凭下标识别 |
| `DELETE /api/model-favorites/:id` | 无引用才删除，要求 revision |
| `POST /api/model-favorites/from-profile` | harness/name、来源指纹、目标名称、extractCredential、linkSource；服务端提取，原子保存 |
| `GET /api/model-favorites/:id/targets` | 五工具支持能力、关联配置、兼容渠道与阻塞原因 |
| `POST /api/model-favorite-plans` | favoriteId、expectedRevision、每工具 connectionId/目标 profile/mode/明确覆盖和忽略决定 |
| `POST /api/model-favorite-plans/:id/apply` | requestId；只执行服务器批准的计划 |
| `GET /api/model-favorite-operations/:requestId` | 查询批次逐项结果，支持超时后恢复 |
| `POST /api/harnesses/:harnessId/profiles/:name/detach-favorite` | 来源指纹；仅移除关联，保留物化配置、Vault 引用及原生文件 |

计划 data 至少包含 `id, expiresAt, favoriteRevision, items[]`。每项包含目标标识、动作、resolved model、各字段来源、owned-field diff、脱敏 native diff、warnings/blockers 和已批准决定。原生 provider ID 冲突必须是 blocker，不能以“覆盖”选项接管手工条目。

关键错误码：`favoriteNotFound`、`favoriteRevisionConflict`、`favoriteInUse`、`favoriteConnectionInUse`、`favoriteEndpointMissing`、`favoriteProtocolUnsupported`、`favoriteProjectionUnsupported`、`favoriteProfileDiverged`、`favoriteRawOverrideConflict`、`favoriteActiveUpdateRequiresApply`、`favoritePlanStale`、`favoritePlanExpired`、`favoriteIdempotencyConflict`、`favoriteUndoConflict`。

新增查询和写入继续遵循当前登录认证、目标用户授权、请求体上限和错误脱敏；不能把知道 favorite UUID 当成访问授权。

### 9.3 Web 与 CLI

Web 使用 store slice + loadResource；`lib/api.ts` 集中管理路径。组件只使用 store action；分出 `model-favorites/` 和 `model-favorite-apply-dialog/`，表单复用现有 shadcn primitives 与 FormField。

批量应用不使用乐观成功状态。发生部分失败，保留成功行收据，失败行可重新预览后重试。切换 Unix 用户立即丢弃旧用户未提交计划和草稿中的目标引用。

CLI 首版增加以下命令，命名是提案，不代表当前已可执行：

```text
harness-switch favorites --json
harness-switch favorite capture pi main --name daily
harness-switch favorite plan <id> --harness pi --connection <id> --profile daily
harness-switch favorite apply <plan-id> --request-id <id> --yes
```

plan 默认只保存配置；`--activate` 显式要求原生激活。capture 内联密钥晋升、忽略偏好、覆盖分歧分别需要明确 flag，不能由笼统 `--yes` 代替。CLI 和 Web 共用全部服务端校验。

## 10. 验收矩阵

所有新增测试使用 server/web 现有 support，凭据仅用测试数据。以下为功能实现时必须验证的行为，本文档提交不会实现这些测试。

| ID | 场景 | 通过标准 |
| --- | --- | --- |
| A01 | 首次打开收藏 | 不修改原生文件，不进行上游请求 |
| A02 | 从 Vault profile 收藏并生成到第二工具 | 无密钥回传，无重复录入，生成值与预览一致 |
| A03 | 内联密钥 capture 中途失败或进程被终止 | favorites/vault/profiles 一起恢复，原生文件不变 |
| A04 | 同模型不同渠道别名/上下文/协议 | 保留各渠道值，不自动合并，不扩大能力 |
| A05 | 五个 adapter 的允许及禁止协议 | 输出对应现有字段；Codex 拒绝 chat-only |
| A06 | 仅保存新建/未激活配置，包含 DSH | 原生文件和 active 逐字节不变；不会暗调 syncProfile |
| A07 | 更新已激活配置但选择仅保存 | 有实际修改时阻止，原有运行配置不变 |
| A08 | 更新并激活时 profile/文件/active 任意写入失败 | 单项整体回滚；重启恢复符合 journal 阶段 |
| A09 | 公共上下文、输出上限或偏好无法表达 | 列出具体字段；偏好忽略需要明确决定 |
| A10 | supported efforts 与 preferred effort | 声明与选择分开，DSH/Pi 不误报默认强度已设置 |
| A11 | 保存收藏更新 | 原生不变，关联项显示更新；纯名称/备注变动不要求激活 |
| A12 | 手改 profile、raw override、backfill | 按第 5.5 节阻止/解除关联/标记分歧；不污染收藏 |
| A13 | 计划后 Vault/profile/live/revision 变化 | 提交 409，无写入；另一个 Unix 用户无法使用该计划 |
| A14 | 重复提交、超时重试、服务重启 | 无重复配置/备份；已成功项可查询，未执行项重新规划 |
| A15 | 三工具批次中第二项失败 | 第一项保留，普通失败继续第三项；DEGRADED 则停止 |
| A16 | 撤销后存在后续 metadata 改动 | 拒绝旧快照覆盖，不删除后来创建的配置 |
| A17 | 清除曾由收藏管理的字段 | 清除旧投影值，并展示 renderer 默认；无关字段保留 |
| A18 | 删除收藏/渠道/Vault/endpoint、复制及重命名 profile | 引用约束和独立副本行为符合第 8 节 |
| A19 | v1/v2 迁移、ID 冲突、跳过同名 profile、跨用户复制 | 全部引用正确重映射；原有目标不被接管；凭据不泄露 |
| A20 | 老客户端修改关联 profile | 非受控字段可用；受控修改返回稳定错误，不悄悄丢关联 |
| A21 | Claude 已有档位、DSH 多模型条目、官方登录缓存 | 受控字段外保持原样，必要影响在预览中明确呈现 |
| A22 | 空/损坏/未知版本收藏文件 | 缺失为空，损坏不覆盖，普通 profile 功能可用 |
| A23 | 错误、日志、计划、收据和两种语言 | 无测试密钥泄露，消息 code 稳定，两份 catalog key 相同 |
| A24 | 各工具全新 profile 激活及原生 provider ID 碰撞 | 全新标识稳定；碰撞阻止；对应版本 CLI 实机验证通过 |

首版人工端到端必须记录五工具版本和一个可用渠道的验证结果。原生版本变化导致字段无法表达时缩小支持范围并在 UI 标明，不能用 renderer 单测代替工具实际读取验证。

## 11. 实施拆分

| 阶段 | 交付 | 完成门槛 |
| --- | --- | --- |
| P0 契约与投影 | schemas、adapter 提取/投影、ownedFields、五工具 fixtures | A04/A05/A09/A10/A17/A21；未知能力及默认值来源可解释 |
| P1 收藏与生成 | 用户级存储、CRUD、Vault 引用、capture、仅保存计划、列表/详情、CLI 列表 | A01–A03/A06/A18/A20/A22；新收藏生成到第二工具无需重复输入 |
| P2 应用与恢复 | 激活准备/提交重构、关联冲突、幂等、批次结果、撤销、Web 应用流程、CLI plan/apply | A07/A08/A11–A16；实际文件与物化记录一致 |
| P3 迁移与发布 | payload v2、GitHub/跨用户闭包、兼容导出、文档及实机 QA | A19/A23/A24；四项基线及仓库规定检查全部通过 |

P1/P2 可以拆分 PR，但完整对外发布要求 P3 完成，避免用户启用收藏后发现同步或备份丢失关系。各阶段 feature 分支提交，按仓库要求通过 server tests、web tests、typecheck、lint，再经 PR 合并。

首版后仅考虑两个扩展：逐工具原生菜单发布，以及版本化模型配置源。它们各自另写 spec，不在本次交付中顺带实现。

## 12. 已作决策与仍需验证的事项

已作决策：收藏独立身份、多渠道显式选择、profile 物化并保留来源、编辑不自动传播、单工具事务、跨工具部分成功、旧配置不自动迁移、首版不做原生菜单发布。这些是本提案的默认行为，不留给实现者临时决定。

实施前仍需验证的事项：

- 每个目标 CLI 版本对表中映射字段的实际读取行为；以版本化 fixtures 和人工运行记录收敛。
- 现有 Profile/Activation 准备阶段的 backfill、Vault cache sweep 及 journal 恢复能否纳入同一写锁；不能只包住新 API。
- 全文件 metadata 快照下的撤销前提检查与旧操作收据共存方式；旧收据按原逻辑读取，新操作不允许跳过前提检查。

上述是实现验证门槛，不是允许省略一致性行为的理由。若某项无法满足，应收窄该工具入口并更新本 spec，而不是静默降级。
