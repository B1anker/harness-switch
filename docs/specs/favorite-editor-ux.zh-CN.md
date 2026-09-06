# 模板编辑器交互重构 Spec

状态：已实现

日期：2026-09-06

代码基线：`cbbc6ee`（`feat/channel-settings-ux`）

范围：模板（model favorite）创建与编辑的用户交互；不改 `resolveFavorite` 继承语义、apply 向导流程、乐观锁与数据模型本身

关联文档：[模型收藏夹 Spec](model-favorites.zh-CN.md)（领域模型与数据契约以它为准，本文只覆盖交互层）

## 1. 产品目标

把模板的配置成本从「查资料、懂协议、理解三态继承后手填一张深表单」降到「选一个入口、确认默认值、按需改差异」。

衡量单位是**创建一个可用模板所需的必填决策数**。现状下新建一个单渠道模板至少要求用户做出 6 项决策（供应商、endpoint、协议枚举、模型 ID、能力数字、推理声明）且其中 4 项需要外部知识；目标是把常规路径收敛到 2 项（选供应商/预设、选模型），其余全部有默认值兜底。

## 2. 现状事实与痛点

以下痛点均对应 [FavoriteEditor](../../apps/web/src/components/model-favorites/editor.tsx) 及其子组件的代码事实：

| # | 现状事实 | 用户成本 |
| --- | --- | --- |
| P1 | 能力字段（contextWindow / maxOutputTokens / 推理档位）全部手填，UI 自述"由你声明，不代表实测能力"（`fields.tsx`） | 用户必须去外部查模型资料再手敲数字 |
| P2 | 协议以裸枚举值（`openai-chat` / `openai-responses` / `anthropic-messages`）直接当选项 label（`connection-card.tsx:92-103`），编辑期无提示，选错延迟到 apply 时才以「No compatible channel」暴露 | 要求用户理解三种 API 协议的差异 |
| P3 | 模型目录需逐渠道手动点「Fetch model catalog」按钮（`connection-card.tsx:106-141`），不点则模型 ID 纯手输 | 每个渠道多一步操作，且容易漏点 |
| P4 | 渠道级覆盖的 undefined / null / 值 三态语义，数字字段用 placeholder + 「Follow template」按钮、推理字段用模式下拉，同一语义两套控件（`channel-overrides.tsx`、`reasoning-overrides.tsx`） | 用户要先学一套概念才能填表 |
| P5 | zod 校验失败被压成一条通用文案 `favorites.invalid`（`editor.tsx:79`），不定位到渠道和字段；跨字段规则（如 reasoningSupported=false 与档位冲突）仅保存时暴露 | 报错后不知道改哪里 |
| P6 | 渠道供应商下拉完全来自 Vault，空态无任何引导（`connection-card.tsx:74-91`） | 新用户卡死，须关弹窗去 Vault 配完再回来 |
| P7 | 保存后流程断点：「配置到工具」在另一入口；编辑模板后需自行理解 needsUpdate / diverged 徽标并逐工具重新 apply | 配完不知道下一步，改完不知道要同步 |
| P8 | 弹窗内嵌套层级：高级折叠区 → N 张渠道卡 → 每卡两个折叠区（渠道名、渠道高级）→ 推理覆盖再嵌一层 | 视觉负担重，新建弹窗默认就带一张空卡 |

## 3. 竞品调研摘要

调研对象：CC Switch、claude-code-router、ccman、claude-code-env、Cherry Studio、LobeChat、Chatbox、NextChat。定位与本产品最接近的是 CC Switch（桌面端统一管理多款编程 CLI 的 API 配置）。

可借鉴模式，按对本痛点的针对性排序：

| 模式 | 代表产品 | 要点 |
| --- | --- | --- |
| 内置供应商预设 | CC Switch（50+ 预设）、ccman、Cherry Studio、LobeChat | 选预设后端点、协议、默认模型自动带入，只剩填 Key 和命名 |
| 从当前生效配置一键保存 | ccenv `save`、CC Switch「从现有配置导入」 | 用户在原生 CLI 调到满意后固化，不在工具内学表单 |
| 填好凭据自动拉模型列表 | Cherry Studio、LobeChat、CCR Settings 插件 | 模型名变下拉选择而非手输 |
| 保存前连通性探测 | CC Switch、Cherry Studio「检查」 | 非阻塞警告，允许保存 |
| 克隆已有配置 | ccman `clone` | 名称加"副本"后缀，凭据掩码带入，只改差异字段 |
| 必填极少 + 高级折叠 | Chatbox、Cherry Studio | 先选「预置 or 自定义」「协议类型」，再展示对应字段 |
| 保存后立即启用闭环 | ccman、CC Switch | 保存后追问「是否立即切换」，消除"配完忘启用"断点 |

来源主要为各项目 README、官方文档与第三方教程（2025–2026）；个别功能随版本变化，实现前如需引用具体交互细节，建议实机体验一次 CC Switch 的「添加供应商」弹窗。

## 4. 设计原则

1. **空白表单是最后选项**。创建入口按「预设 → 捕获现有配置 → 空白」排序，用户先从已知的知识（用了哪家供应商、已经调好的配置）出发，而不是从空字段出发。
2. **声明变确认**。凡是可由预设元数据或模型目录带出的值（协议、能力数字、推理档位），一律预填为默认值并标注来源，用户从"填写"变为"看一眼对不对"。默认值依然是声明而非实测，不违反[模型收藏夹 Spec](model-favorites.zh-CN.md) 不自动推断能力的约束——预设是人工维护的策展数据，不是运行时推断。
3. **覆盖是显式动作**。渠道级三态继承保留数据语义不变，但交互上收敛为「跟随模板」为默认、「自定义」为一次显式开启。
4. **错误在出错处说**。校验定位到具体渠道卡的具体字段，不用通用文案兜底。
5. **保存不是终点**。每次保存后给出下一步主行动（应用到工具 / 查看受影响配置）。

## 5. 详细设计

### 5.1 创建入口：三选一引导页

点击「New template」后先进入选择页（弹窗内第一步或独立小弹窗），而非直接开空白表单：

```text
┌─ 新建模板 ────────────────────────────┐
│  ⚡ 从预设创建                         │
│     选择供应商，端点/协议/能力自动带入  │
│                                       │
│  📥 从当前工具配置捕获                  │
│     把已调好的配置固化成模板            │
│                                       │
│  ✏️ 空白创建                           │
│     手动填写所有字段                   │
└───────────────────────────────────────┘
```

- **从预设创建**：`packages/shared` 新增策展的供应商预设目录（见 §6.1）。选定预设后进入编辑器，协议、能力默认值、模型候选全部预填；预设引用的 Vault 条目不存在时，引导用户在弹窗内就地创建该供应商（只填名称 + Key + 预设带入的 base URL），写回 Vault 后继续。
- **从当前工具配置捕获**：复用现有 `CaptureFavorite`（`capture.tsx`），提升为一级入口，交互不变。
- **空白创建**：进入现有编辑器（经 §5.2 改造后的版本）。

模板列表页每张卡片新增「克隆」操作：复制全部字段与渠道，名称自动追加"副本"后缀（locale key，不硬编码），打开编辑器让用户改差异后保存为新模板。克隆不产生来源关联——新模板与母版的 profile 链接互不继承。

### 5.2 编辑器主线收敛

渠道卡片从「全部字段平铺 + 两层折叠」改为三行主信息：

1. **供应商 + endpoint**（Vault 下拉，不变）；
2. **模型**：选定供应商/endpoint 后**自动**拉取模型目录（替代手动按钮），加载期间输入框可用、候选到达后变为下拉；拉取失败降级为手输并显示非阻塞提示；
3. **协议**：按预设或 endpoint 元数据带默认值；选项 label 改为人话（如"OpenAI 兼容（Chat Completions）"），枚举值降级为副标题；保留手动切换。

模板级保留折叠区，卡顶与控件布局同步收紧：

- 模板级高级区标题为「能力与备注（已有默认值，通常无需修改）」，整体挪到渠道列表之后（「+ 添加渠道」按钮下方、保存栏之前）；能力字段有默认值时仍显示摘要。
- 渠道名从折叠区上移到卡顶：卡片标题本身即无边框内联输入框（宽度自适应内容、上限 max-w-56，placeholder 为供应商名或「渠道 N」兜底）；卡头单行 [图标][标题][删除按钮]，「选择供应商，再设置要使用的模型」hint 只在「渠道」小节标题旁出现一次。供应商下拉独占一行（max-w-md）；「模型」与「协议」同行（sm 起各半栏，窄屏堆叠），目录状态小字在整行下方。数字输入保持 w-36 量级。
- 模板级思考字段按声明联动：reasoningSupported 为 false 时隐藏档位与默认偏好两个控件；「默认思考偏好」选项按 supportedReasoningEfforts 过滤，已保存的列表外值保留为可选项而非被清掉。
- **渠道级覆盖 UI 已按产品决策移除**（评审结论：无人使用，概念与模板级重复）。数据模型不动：factOverrides / preferenceOverrides schema、resolveFavorite 三态解析与交叉校验全部保留，存量带覆盖的模板照常解析、校验错误仍能按字段路径定位；后续若需要可按需恢复界面。

新建空白模板默认不再预置空渠道卡，显示「+ 添加渠道」空态（含 Vault 无供应商时的内联引导，见 §5.4）。

### 5.3 校验内联与保存时探测

- 前端 zod 校验失败时，按 issue path 定位到具体渠道卡（卡片标红、自动展开）与具体字段（字段级错误文案，走 `form-field` 的 aria  wiring）；删除通用的 `favorites.invalid` 兜底（保留为无法定位时的最后回退）。
- 跨字段规则（reasoningSupported=false 时不得声明档位、偏好档位须在已声明列表内等）在相关字段变更时即时校验，不等保存。
- 保存成功后对每条渠道做非阻塞连通性探测（请求模型目录端点）：失败在结果 toast 中以警告呈现，允许保存生效，不阻断流程。探测复用现有目录拉取链路，不新增协议。

### 5.4 空态与闭环

- **Vault 空态**：渠道卡供应商下拉为空时，卡片内直接给出「添加供应商」入口（跳转 Vault 弹窗，返回后自动选中新建条目），不再让用户自行关弹窗。
- **保存后闭环**：保存成功的 toast 携带主行动按钮——新建模板为「配置到工具」（直接进入 apply 向导并预选该模板）；编辑已有模板且存在 `needsUpdate` / `diverged` 关联 profile 时为「查看受影响配置」（跳转关系视图）。toast 不自动跳转，主行动永远是用户显式点击。

### 5.5 编辑传播语义不变

本 spec 不改变「编辑模板只 bump revision、不自动传播」的既定语义（[模型收藏夹 Spec §5.5](model-favorites.zh-CN.md)）。§5.4 的「查看受影响配置」只是导航捷径，重新 apply 仍由用户逐工具确认。

## 6. 数据契约变化

### 6.1 供应商预设目录（新增）

`packages/shared` 新增 `provider-presets.ts`，纯数据 + zod schema，随版本策展更新：

```ts
type ProviderPreset = {
  id: string;                    // 稳定标识，如 'deepseek'、'zhipu'、'openrouter'
  nameKey: string;               // locale key，不硬编码文案
  protocols: Protocol[];         // 支持的协议，首项为默认
  endpoints: Array<{ key: string; baseUrl: string }>;
  defaultFacts?: ModelFacts;     // 策展的能力默认值，可在编辑器中覆盖
  modelCatalog?: {               // 预设维护的模型候选，与运行时拉取并存
    requestModelId: string;
    facts?: ModelFacts;
  }[];
};
```

约束：

- 预设**不含凭据**，Key 永远来自用户填入 Vault。
- `defaultFacts` / `modelCatalog[].facts` 是策展声明，进入模板后与手填值不可区分，UI 不做"来自预设"的持久标记（避免第二套来源追踪）。
- 首版预设规模控制在 8–12 家（DeepSeek、智谱、Kimi、MiniMax、通义、SiliconFlow、OpenRouter、各家官方端点），只覆盖 `Protocol` 三枚举可表达的供应商；需要额外协议字段的不收。

空白创建（或预设缺 `defaultFacts`）时能力字段预填建议默认值 `contextWindow: 262144`、`maxOutputTokens: 32768`：256K 在 2026 年旗舰模型中居中偏保守，32K 是在售模型的最大公约数（64K–128K 旗舰由预设 facts 覆盖）。reasoningSupported / 档位 / 偏好不预填（存在反例）。这些是普通表单初值，可改可清空，不进入 schema；预设显式声明的 facts 永远优先。

### 6.2 不变项

- `ModelFavorite` / `Connection` schema、`resolveFavorite` 三态解析、交叉校验规则、apply plan/指纹/乐观锁：全部不变。
- 服务端仅需支持预设目录的读取（或随 shared 包直出给前端，首选后者，无新路由）。
- locale：`zh-CN` 与 `en` 新增 `favorites.presets.*`、`favorites.clone.*`、`favorites.validation.*`、`favorites.nextStep.*` 等命名空间，key-for-key 相等，沿用 `catalogKey()` 约定。

### 6.3 思考档位归一化（新增）

`reasoningEffort` 偏好统一为 canonical 八档刻度，投影时经 shared 的 `mapReasoningEffort` 按「harness 静态表 → 模型声明集」两级约束就近降档，落进各工具原生键（Claude `effortLevel`、Codex `model_reasoning_effort`、DSH `agent-default-model.reasoningEffort`；Kimi/Pi 配置层无对应键，保持 notRepresented）。降档在计划/预览中以警告提示，不再硬阻断。映射表与降档语义详见 `docs/specs/model-favorites.zh-CN.md` §6.1。

## 7. 分期交付

按收益/成本排序，每期独立可交付、可评审：

| 期 | 内容 | 对应痛点 |
| --- | --- | --- |
| Phase 1 | 校验内联（§5.3 前两条）+ 保存后闭环（§5.4 第二条）+ 自动拉模型目录（§5.2 第 2 条） | P5、P7、P3 |
| Phase 2 | 覆盖控件统一为「自定义此字段」开关 + 渠道卡三行主线 + 空渠道卡空态 + Vault 空态引导（§5.2、§5.4 第一条） | P4、P8、P6 |
| Phase 3 | 预设目录 + 三选一创建入口 + 克隆 + 保存时连通性探测（§5.1、§6.1、§5.3 第三条） | P1、P2 |
| Phase 4 | 渠道名内联到卡顶 + 渠道覆盖分组（模型能力/思考）+ 思考字段按声明联动（§5.2） | P8 |
| Phase 5 | 渠道覆盖改加法式（状态行 + 添加菜单 + 恢复跟随）+ 卡顶布局收紧 + 控件宽度收敛 + 模板级高级区文案分工（§5.2） | P4、P8 |
| Phase 6 | 渠道级覆盖 UI 按产品决策移除（数据模型保留）+ hint 收编到小节标题 + 模型/协议同行 + 高级区挪到渠道列表下方（§5.2） | P4、P8 |

Phase 1 不引入新数据契约，可先行；Phase 3 依赖前两期的编辑器形态。

## 8. 验收标准

- 常规路径（从预设创建单渠道模板）必填决策 ≤ 2 项：选预设、选模型；其余字段有默认值或可不填。
- 任一校验失败能定位到具体渠道卡与字段，无 path 的错误才允许通用文案。
- 选定供应商后无需手动操作即可出现模型候选下拉；目录拉取失败时可手输保存。
- 编辑模板存在受影响 profile 时，保存后用户一次点击可到达关系视图。
- 全部新增文案走 locale catalog，双语 key-for-key 相等；四个基线（server 测试、web 测试、typecheck、lint）全绿。

## 9. 不做

- 不改 `resolveFavorite` 继承语义与三态数据模型（仅改控件表达）。
- 不做运行时能力推断（从目录响应猜 contextWindow 等）；能力默认值只来自人工策展的预设。
- 不做 Deep Link / 分享码导入（`harness-switch://` 协议）——生态价值依赖第三方接入，列为后续候选。
- 不做编辑模板后自动传播到关联 profile。
- 不做模型槽位化（主模型/轻量模型分槽）——当前数据模型是单模型 + 多渠道，槽位化属于[模型收藏夹 Spec](model-favorites.zh-CN.md) 已明确不做的"多模型角色编排"范畴。
- 不新增 harness 适配器协议；预设只覆盖现有三枚举可表达的供应商。
