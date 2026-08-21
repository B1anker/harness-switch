import {
  createContext,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export type Language = 'zh-CN' | 'en';

const STORAGE_KEY = 'hs-language';
const LOCALIZED_ATTRIBUTES = ['aria-label', 'placeholder', 'title'] as const;

// The application predates its localization layer. Keeping the source copy in
// Chinese lets existing components and tests stay stable while this catalog
// provides one central place for all user-facing English copy.
const english: Record<string, string> = {
  服务器端配置中枢: 'Server configuration control plane',
  '激活档案时直接写入各 CLI 自己的配置文件，不依赖你在某个 shell 里 source 过什么。':
    "Activating a profile writes directly to each CLI's own configuration files, with no shell setup required.",
  '输入首次启动时终端打印的 Web 密码。':
    'Enter the web password printed in the terminal on first launch.',
  '正在检查会话…': 'Checking session…',
  'Web 密码': 'Web password',
  '登录中…': 'Signing in…',
  登录: 'Sign in',
  写入原生配置: 'Native configuration management',
  当前本地用户: 'Current local user',
  本地用户: 'Local user',
  同步用户配置: 'Sync user config',
  '导入 / 导出': 'Import / Export',
  凭据库: 'Provider vault',
  诊断: 'Diagnostics',
  退出: 'Sign out',
  '管理配置档案并安全写入该工具的原生配置文件。':
    "Manage profiles and safely write this tool's native configuration files.",
  新增配置: 'New profile',
  环境变量文件兼容性: 'Environment file compatibility',
  '切换本身不需要它。只有 Codex 选择「环境变量」认证方式时才需要在对应 shell 执行：':
    'Switching does not require it. Run this in the relevant shell only when Codex uses environment-variable authentication:',
  '文件里只会写入对应工具确实认识的变量。Kimi Code 与 Pi 不从 shell':
    'The file contains only variables recognized by each tool. Kimi Code and Pi do not read credentials from the shell,',
  '读取凭据，所以它们只有一行注释。': 'so their sections contain only a comment.',
  '切换 Harness': 'Switch harness',
  '当前：': 'Current: ',
  '当前：未激活': 'Current: inactive',
  当前生效配置: 'Active configuration',
  '当前激活 · ': 'Active · ',
  未激活: 'Inactive',
  已激活: 'Active',
  激活: 'Activate',
  确认激活: 'Confirm activation',
  '激活配置？': 'Activate profile?',
  写入目标: 'Write targets',
  应用: 'Application',
  写入模式: 'Write mode',
  替换当前配置: 'Replace current configuration',
  保留并切换指针: 'Keep entries and switch pointer',
  最近备份: 'Latest backup',
  配置档案: 'Profiles',
  还没有历史快照: 'No snapshots yet',
  还没有配置档案: 'No profiles yet',
  未配置目标文件: 'No target file configured',
  '配置将直接覆盖目标文件。写入前会自动备份，切换后请验证服务连通性与模型可用性。':
    'Configuration will overwrite the target files. Files are backed up first; verify connectivity and model availability after switching.',
  官方登录: 'Official login',
  '使用 Claude Code 自身的 Anthropic 账号登录': 'Use Claude Code with its own Anthropic account',
  '使用 Codex 自身的 ChatGPT / OpenAI 账号登录': 'Use Codex with its own ChatGPT / OpenAI account',
  已使用: 'In use',
  切回官方: 'Use official login',
  手动接管: 'Manual override',
  '先激活另一个配置，才能删除当前配置': 'Activate another profile before deleting the current one',
  '删除配置？': 'Delete profile?',
  '此操作不可撤销。': 'This action cannot be undone.',
  删除: 'Delete',
  编辑: 'Edit',
  取消: 'Cancel',
  关闭: 'Close',
  请输入配置名称: 'Enter a profile name',
  '配置名称不能包含 / 或 \\': 'Profile name cannot contain / or \\',
  '配置名称最多 120 个字符': 'Profile name can contain at most 120 characters',
  '请输入 API Base URL': 'Enter an API Base URL',
  '请输入 API Key': 'Enter an API key',
  请输入模型名称: 'Enter a model name',
  '引用的 Provider 已不存在，请重新选择':
    'The referenced provider no longer exists. Select another one.',
  '引用的 Endpoint 已不存在，请重新选择':
    'The referenced endpoint no longer exists. Select another one.',
  '请检查标红的必填项或输入内容。': 'Check the highlighted required fields and values.',
  '保存后会写入 ': 'Saving will write to ',
  '该工具的配置文件按 provider 共存，切换只会移动当前指针，不会删除你手写的其他 provider。':
    "Provider entries coexist in this tool's config. Switching moves only the current pointer and preserves other manually added providers.",
  '使用共享 Provider（凭据库）': 'Use shared provider (vault)',
  '使用共享 Provider': 'Use shared provider',
  密钥由凭据库提供: 'Key supplied by provider vault',
  '不使用（本配置自带密钥）': 'None (this profile stores its own key)',
  '凭据库为空，可先在顶部「凭据库」中新增 Provider 条目。':
    'The provider vault is empty. Add a provider from the toolbar first.',
  '命名 Endpoint（可选）': 'Named endpoint (optional)',
  '命名 Endpoint': 'Named endpoint',
  '不指定（使用下方 Base URL）': 'None (use the Base URL below)',
  '该 Provider 没有命名 endpoint，将使用下方 Base URL。':
    'This provider has no named endpoint. The Base URL below will be used.',
  配置名称: 'Profile name',
  '例如：openrouter-main': 'For example: openrouter-main',
  '修改后会同步更新当前激活状态和原生配置中的 Provider 标识。':
    'Changing it also updates the active state and provider ID in the native configuration.',
  留空表示保持不变: 'Leave blank to keep unchanged',
  必填: 'Required',
  '已引用共享 Provider，密钥在「凭据库」中统一轮换。':
    'This profile uses a shared provider; rotate its key in the provider vault.',
  '回退模型（ANTHROPIC_MODEL）': 'Fallback model (ANTHROPIC_MODEL)',
  模型: 'Model',
  '可选；各档未匹配时使用，例如 glm-5':
    'Optional; used when no model tier matches, for example glm-5',
  '例如：claude-sonnet-4-5': 'For example: claude-sonnet-4-5',
  '留空则沿用 Claude Code 默认模型；可在下面分别映射各模型档位。':
    'Leave blank to use the Claude Code default; model tiers can be mapped below.',
  '备注（可选）': 'Notes (optional)',
  '高级：原始配置': 'Advanced: raw configuration',
  已手动接管: 'Manually overridden',
  '先保存这份配置，之后回到编辑界面即可接管原始文件内容。':
    'Save this profile first, then edit it again to override the raw file contents.',
  '保存中…': 'Saving…',
  保存配置: 'Save profile',
  '正在读取将写入的内容…': 'Loading the content to be written…',
  '下面是当前会写入磁盘的内容，基于最近一次保存的字段生成。改动任意一份即视为手动接管，之后':
    'Below is the content currently generated from the latest saved fields. Editing a file enables manual override; after that,',
  '表单字段不再影响这份文件。': 'form fields no longer affect that file.',
  恢复为自动生成: 'Restore automatic generation',
  '快速填充：': 'Quick fill:',
  请选择: 'Select…',
  模型映射: 'Model mapping',
  '显示名称仅影响 Claude Code 的 /model 菜单；留空时显示对应的实际模型 ID。开启「1M':
    "Display names affect only Claude Code's /model menu; when empty, the actual model ID is shown. Enabling “1M",
  '上下文」会在模型 ID 末尾追加 [1m]，仅在该模型确实支持 1M 时开启。':
    'context” appends [1m] to the model ID. Enable it only for models that support 1M context.',
  模型角色: 'Model role',
  显示名称: 'Display name',
  实际请求模型: 'Requested model',
  '1M 上下文': '1M context',
  '默认：': 'Default: ',
  '不显示在 /model 菜单': 'Hide from /model menu',
  '不支持 1M': 'does not support 1M',
  启用: 'Enable',
  未知错误: 'Unknown error',
  '无法读取将要写入的内容：': 'Could not load the content to be written: ',
  '将把 ': 'Switch ',
  ' 切换到「': ' to “',
  '」并写入原生配置文件': '” and write its native configuration files',
  ' 个文件将变更': ' files will change',
  '目标本地用户：': 'Target local user: ',
  当前用户: 'current user',
  '写入前会自动备份。': 'A backup is created before writing.',
  配置历史: 'Configuration history',
  '每次写入前都会把原文件快照到数据目录，保留最近 10':
    'Before each write, the original files are snapshotted to the data directory. The latest 10',
  '份。这里只显示当前工具的历史；与磁盘一致的条目会标成「当前」。':
    'snapshots are kept. Only this tool is shown here; snapshots matching disk are marked “Current”.',
  当前: 'Current',
  ' 个文件': ' files',
  ' · 含删除': ' · includes deletions',
  恢复: 'Restore',
  '恢复这份历史？': 'Restore this snapshot?',
  '红是当前将丢失的内容，绿是恢复后的内容。确认后会按历史快照覆盖磁盘文件，harness-switch':
    'Red is content that will be lost; green is the restored content. Confirming overwrites files from the snapshot. harness-switch',
  '记录的「当前激活」不会随之回退。': 'will not roll back its recorded active profile.',
  '正在对比差异…': 'Comparing changes…',
  确认恢复: 'Confirm restore',
  加载差异失败: 'Failed to load changes',
  将删除: 'Will delete',
  将新建: 'Will create',
  将覆盖: 'Will overwrite',
  无变更: 'No changes',
  '正在渲染差异…': 'Rendering changes…',
  '（当前不存在）': '(currently missing)',
  '↓ 恢复后': '↓ After restore',
  '（恢复后删除）': '(deleted after restore)',
  两侧都不存在: 'Missing on both sides',
  配置漂移: 'Configuration drift',
  重新检查漂移: 'Check drift again',
  '正在检查漂移…': 'Checking drift…',
  查看差异: 'View changes',
  无漂移: 'No drift',
  ' 个文件不一致': ' files differ',
  全局配置迁移: 'Global configuration transfer',
  '将全部 Harness 配置、API Key、原始文件覆盖内容和激活状态打包，供其他机器复用。':
    'Package all harness profiles, API keys, raw overrides, and active states for another machine.',
  导出所有配置: 'Export all configuration',
  '文件使用迁移密码进行 AES-256-GCM 加密，不依赖当前机器的本地密钥。':
    "The file is encrypted with AES-256-GCM using a transfer password, independent of this machine's local key.",
  迁移密码: 'Transfer password',
  '至少 8 个字符': 'At least 8 characters',
  确认迁移密码: 'Confirm transfer password',
  再次输入: 'Enter it again',
  '两次输入的迁移密码不一致。': 'The transfer passwords do not match.',
  '在导出包中包含 Codex 官方登录缓存（auth.json）':
    'Include the Codex official login cache (auth.json) in the export',
  '当前用户没有可导出的 Codex 登录缓存。': 'The current user has no Codex login cache to export.',
  '正在加密…': 'Encrypting…',
  下载加密导出包: 'Download encrypted export',
  导入到当前机器: 'Import to this machine',
  '先解密并检查冲突，确认后才会写入。默认保留当前机器上的同名配置。':
    'The package is decrypted and checked for conflicts before writing. Existing profiles are kept by default.',
  '选择 .hsw-backup 文件': 'Choose an .hsw-backup file',
  '文件内容在本机服务端解密，不会发送到外部服务。':
    'The file is decrypted by the local server and is not sent to an external service.',
  导出时设置的密码: 'Password used for export',
  '正在检查…': 'Checking…',
  检查导入内容: 'Check import contents',
  同名配置处理: 'Duplicate profile handling',
  '保留本机配置，跳过导入': 'Keep local profiles and skip duplicates',
  使用导出包覆盖本机配置: 'Overwrite local profiles with the export',
  恢复导出时的激活状态: 'Restore exported active states',
  请重新检查导入内容: 'Check import contents again',
  确认导入: 'Confirm import',
  '确认导入全部配置？': 'Import all configuration?',
  覆盖并导入: 'Overwrite and import',
  安全导入: 'Import safely',
  '凭据库为空，先新增一个 Provider。': 'The vault is empty. Add a provider first.',
  '新增 Provider': 'New provider',
  'Provider 条目集中保存 API Key（AES-256-GCM 加密，默认不显示明文），并附带可复用的 endpoint。配置档案可以引用这里的条目，而不是各自保存一份密钥。':
    'Provider entries store API keys centrally (AES-256-GCM encrypted and hidden by default) with reusable endpoints. Profiles can reference them instead of storing separate keys.',
  '配置凭据和可复用的命名 Endpoint；保存后返回凭据库列表。':
    'Configure credentials and reusable named endpoints; saving returns to the vault list.',
  '正在读取凭据库…': 'Loading provider vault…',
  ' 个 Provider 条目': ' provider entries',
  新增凭据: 'Add credential',
  密钥已配置: 'Key configured',
  未配置密钥: 'No key configured',
  '没有命名 endpoint': 'No named endpoints',
  隐藏: 'Hide',
  显示: 'Show',
  '删除这个 Provider？': 'Delete this provider?',
  '被配置档案引用的条目无法删除，请先移除引用。':
    'A provider referenced by a profile cannot be deleted. Remove the references first.',
  '被引用无法删除：': 'Cannot delete while referenced: ',
  '请输入 Provider 名称': 'Enter a provider name',
  '请输入 Endpoint 标识': 'Enter an endpoint ID',
  'Endpoint 标识不能重复': 'Endpoint IDs must be unique',
  '请检查标红的必填项。': 'Check the highlighted required fields.',
  保存失败: 'Save failed',
  名称: 'Name',
  '例如：openrouter': 'For example: openrouter',
  '配置档案引用此 Provider 时可以选择某个 endpoint，其 Base URL 优先于配置自身的地址。':
    'Profiles referencing this provider can select an endpoint, whose Base URL takes precedence over the profile URL.',
  '还没有 endpoint': 'No endpoints yet',
  '标识，如 default': 'ID, such as default',
  '显示标签（可选）': 'Display label (optional)',
  '添加 endpoint': 'Add endpoint',
  保存修改: 'Save changes',
  切换到浅色模式: 'Switch to light mode',
  切换到深色模式: 'Switch to dark mode',
  '本地开发模式：当前页面由本地 dev server 提供':
    'Local development mode: this page is served by the local dev server',
  '更新中…': 'Updating…',
  更新失败: 'Update failed',
  '更新到 v': 'Update to v',
  更新: 'Update',
  诊断报告: 'Diagnostic report',
  '正在诊断…': 'Running diagnostics…',
  重新诊断: 'Run again',
  通过: 'Passed',
  警告: 'Warning',
  失败: 'Failed',
  语言: 'Language',
  中文: '中文',
  英语: 'English',
  切换到中文: 'Switch to Chinese',
  'Base URL 来自凭据库 endpoint「': 'Base URL comes from vault endpoint “',
  'Claude Code 会立即生效；Codex、Kimi Code、Pi 需要重新启动进程。':
    'Claude Code takes effect immediately; restart Codex, Kimi Code, and Pi.',
  'Codex 登录缓存已迁移。': 'The Codex login cache was migrated.',
  'Codex 登录缓存未迁移。': 'The Codex login cache was not migrated.',
  'DeepSeek（Anthropic 兼容）': 'DeepSeek (Anthropic compatible)',
  'Moonshot（Anthropic 兼容）': 'Moonshot (Anthropic compatible)',
  'Z.AI（Anthropic 兼容）': 'Z.AI (Anthropic compatible)',
  '不是有效的 harness-switch 导出文件': 'Not a valid harness-switch export file',
  '不能包含 / 或 \\，且最多 60 个字符': 'Cannot contain / or \\ and can have at most 60 characters',
  了解并继续导入: 'I understand, continue importing',
  '仅当目标用户可以使用这个登录会话时才继续。':
    'Continue only if the target user is allowed to use this login session.',
  从其他用户同步: 'Sync from another user',
  '以及另外 ': 'and ',
  保存后会写入: 'Saving will write to',
  凭据: 'Credentials',
  '加密导出包已生成，已包含 Codex 登录缓存。迁移密码不会写入文件，请单独保管。':
    'The encrypted export was created with the Codex login cache. Keep the transfer password separately; it is not stored in the file.',
  '加密导出包已生成，未包含 Codex 登录缓存。迁移密码不会写入文件，请单独保管。':
    'The encrypted export was created without the Codex login cache. Keep the transfer password separately; it is not stored in the file.',
  '只覆盖勾选的 Harness；未勾选的同名配置会保留当前用户版本。':
    "Only selected harnesses are overwritten; unselected duplicates keep the current user's version.",
  同名冲突: 'Duplicate conflicts',
  '同名配置会保留，不会被覆盖。': 'Duplicate profiles are kept and will not be overwritten.',
  '同步仅写入配置库。需要生效时，请在同步后手动激活对应配置。':
    'Sync writes only to the profile store. Activate a profile after syncing to apply it.',
  '同步完成：新增 ': 'Sync complete: added ',
  '如尚未登录，请在终端启动对应工具并完成一次官方登录。':
    'If needed, start the tool in a terminal and complete its official login.',
  '它在配置文件里的 provider 条目也会被一并摘掉。':
    'Its provider entry will also be removed from the configuration file.',
  '导入完成：': 'Import complete: ',
  '导出包仍会使用迁移密码加密，但其中将含有可复用的 Codex':
    'The export remains encrypted with the transfer password, but it will contain a reusable Codex',
  '导出包包含一个可复用的 Codex': 'The export contains a reusable Codex',
  '将导入 ': 'Import ',
  '将把磁盘上的当前内容回填进配置档案，之后的写入会以现场为准。此操作不可撤销。':
    'Adopt the current disk content into the profile. Future writes will use it. This action cannot be undone.',
  '将按激活配置重新写入 ': 'Rewrite ',
  '将来源用户的配置和所引用的凭据复制到 ':
    "Copy the source user's profiles and referenced credentials to ",
  尚未运行诊断: 'Diagnostics have not been run',
  已修改: 'Modified',
  '已修改导入选项，请重新检查内容后再确认导入。':
    'Import options changed. Check the contents again before confirming.',
  已写入磁盘: 'Written to disk',
  '已删除。': 'Deleted.',
  '已把该历史快照的文件写回磁盘。': 'The snapshot files were restored to disk.',
  '已更新。': 'Updated.',
  '已新增 Provider 条目。': 'Provider added.',
  '已迁移导出包内的 Codex 登录缓存': 'Migrated the Codex login cache from the export',
  '未迁移导出包内的 Codex 登录缓存': 'Did not migrate the Codex login cache from the export',
  '恢复 Codex 官方登录状态可能清理本机 auth.json 中遗留的 OPENAI_API_KEY。':
    'Restoring the official Codex login may remove a leftover OPENAI_API_KEY from local auth.json.',
  '恢复选定的 Codex 激活配置会按该配置的原始 auth 覆盖内容写入本机 auth.json。':
    'Restoring the selected active Codex profile writes its raw auth override to local auth.json.',
  '恢复选定的 Codex 激活配置会更新本机 auth.json 中的 OPENAI_API_KEY；这不是迁移导出包内的完整官方登录会话。':
    'Restoring the selected active Codex profile updates OPENAI_API_KEY in local auth.json; it does not migrate the full official login session.',
  '所有文件与激活配置一致。': 'All files match the active profile.',
  '手动运行 bunx @seaveyon/harness-switch@latest':
    'Run bunx @seaveyon/harness-switch@latest manually',
  '按 Harness 覆盖同名配置': 'Overwrite duplicates by harness',
  无法解析: 'Invalid',
  无法读取密钥: 'Could not read key',
  '暂无漂移数据。': 'No drift data yet.',
  有新版本可用: 'A new version is available',
  '未激活任何配置，没有可对比的内容。': 'No profile is active, so there is nothing to compare.',
  未知: 'Unknown',
  '本机已有登录缓存；继续后将覆盖它，并自动创建备份。':
    'A local login cache exists. Continuing will overwrite it after creating a backup.',
  来源用户: 'Source user',
  标签: 'Label',
  检查可同步内容: 'Check sync contents',
  '检查工具安装、配置文件可读可写可解析、存储权限与漂移状态。':
    'Check tool installation, configuration readability, writability and validity, storage permissions, and drift.',
  '正在同步…': 'Syncing…',
  正常: 'OK',
  '此外，导出包内的完整 Codex 官方登录缓存会写入本机。':
    'The full official Codex login cache from the export will also be written locally.',
  '此外，导出包内的完整 Codex 官方登录缓存会覆盖本机缓存，并自动创建备份。':
    'The full official Codex login cache from the export will overwrite the local cache after creating a backup.',
  '不会迁移导出包内的完整 Codex 官方登录缓存。':
    'The full official Codex login cache from the export will not be migrated.',
  '没有其他可管理的本地登录用户。': 'There are no other manageable local users.',
  没有可检查的项目: 'No checks available',
  '注意：': 'Note: ',
  '登录会话。默认不写入本机；仅在当前用户可以使用该登录时选择。':
    'login session. It is not written locally by default; select it only if the current user may use that login.',
  '登录会话，不是普通配置。仅在目标用户可以使用该登录时选择。':
    'login session, not an ordinary profile. Select it only if the target user may use that login.',
  '登录会话；请仅交给可信的接收方。': 'login session; share it only with a trusted recipient.',
  '的 Codex 官方登录缓存（auth.json）复制到 ': ' Codex official login cache (auth.json) to ',
  '的原生配置文件，覆盖磁盘上的现场修改。写入前会自动备份。':
    ' native configuration files, overwriting live disk changes. A backup is created first.',
  '的原生配置文件。': ' native configuration files.',
  的密钥: ' key',
  '目标用户将获得新的本地登录缓存。': 'The target user will receive a new local login cache.',
  '目标用户已有登录缓存；继续后将覆盖它，并自动创建备份。':
    'The target user already has a login cache. Continuing overwrites it after creating a backup.',
  '目标用户已有缓存，会被覆盖并创建备份。':
    'The target user has a cache; it will be backed up and overwritten.',
  '确认可能改动 Codex auth.json？': 'Confirm changes to Codex auth.json?',
  '确认迁移 Codex 登录缓存？': 'Migrate the Codex login cache?',
  确认采纳: 'Confirm adoption',
  确认重新应用: 'Confirm re-apply',
  '移除 Endpoint ': 'Remove endpoint ',
  '红色是磁盘现状，绿色是按激活配置应写入的内容。':
    'Red is the current disk content; green is what the active profile should write.',
  缺失: 'Missing',
  覆盖: 'Overwrite',
  '该工具未激活任何配置。': 'This tool has no active profile.',
  请填写: 'Enter ',
  请求失败: 'Request failed',
  '请输入 Base URL': 'Enter a Base URL',
  '跳过 ': 'skipped ',
  '迁移 Codex 官方登录缓存（auth.json）': 'Migrate Codex official login cache (auth.json)',
  迁移登录缓存并同步: 'Migrate login cache and sync',
  '还有 ': 'and ',
  '这会复制可复用的 Codex': 'This copies a reusable Codex',
  选择本地用户: 'Select a local user',
  采纳失败: 'Adoption failed',
  采纳现场配置: 'Adopt live configuration',
  '采纳现场配置？': 'Adopt live configuration?',
  重新应用失败: 'Re-apply failed',
  '重新应用激活配置？': 'Re-apply active profile?',
  重新应用: 'Re-apply',
  错误: 'Error',
  项未知: ' unknown',
  项正常: ' OK',
  项警告: ' warnings',
  项错误: ' errors',
  '），原生配置文件已写入。': '); native configuration files were written.',
  '），第三方 API 路由已从原生配置中移除。':
    '); third-party API routing was removed from the native configuration.',
  '，复制凭据 ': ', copied credentials ',
  '，覆盖 ': ', overwritten ',
  '，跳过 ': ', skipped ',
  '个 Provider 条目': ' provider entries',
  个同名冲突: ' duplicate conflicts',
  '个同名配置会被覆盖。': ' duplicate profiles will be overwritten.',
  个同名配置: ' duplicate profiles',
  个自定义配置: ' custom profiles',
  '个配置。': ' profiles.',
  个配置: ' profiles',
  个文件将变更: ' files will change',
  个文件不一致: ' files differ',
  '个文件…': ' files…',
  个文件: ' files',
  个激活状态: ' active states',
  一致: 'In sync',
  项: ' items',
  '· 含删除': '· includes deletions',
  '。激活状态、备份和原生配置文件默认不会复制；可单独选择迁移 Codex 登录缓存。':
    '. Active states, backups, and native configuration files are not copied by default; the Codex login cache can be migrated separately.',
  '」（用户：': '” (user: ',
  以及另外: 'and another',
  '其中 ': 'Of these, ',
  '切换到「': 'switched to “',
  '同名项：': 'Duplicates:',
  '同步到 ': 'Sync to ',
  将导入: 'Import',
  将把: 'Write',
  将按激活配置重新写入: 'Rewrite from the active profile',
  将来源用户的配置和所引用的凭据复制到:
    "Copy the source user's profiles and referenced credentials to",
  '已切回官方登录（用户：': 'Switched to official login (user: ',
  '已切换到「': 'Switched to “',
  '已把 ': 'Restored ',
  '已按激活配置重新写入 ': 'Rewrote ',
  '新增 ': 'added ',
  '正在读取将要写入的内容…': 'Loading the content to be written…',
  '现场配置回填进配置档案。': ' live configuration into the profile.',
  '的 Codex 官方登录缓存（auth.json）复制到': ' Codex official login cache (auth.json) to',
  还有: 'and',
  '，其中 ': ', of which ',
  配置: 'Profiles',
};

const entries: [string, string][] = [];
for (const entry of Object.entries(english)) {
  const index = entries.findIndex(([source]) => source.length < entry[0].length);
  if (index === -1) entries.push(entry);
  else entries.splice(index, 0, entry);
}

export function translateToEnglish(value: string): string {
  let translated = value;
  for (const [source, target] of entries) translated = translated.replaceAll(source, target);
  return translated;
}

function preferredLanguage(): Language {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'en' || stored === 'zh-CN' ? stored : 'zh-CN';
}

type I18nValue = {
  language: Language;
  locale: string;
  setLanguage: (language: Language) => void;
};

const I18nContext = createContext<I18nValue>({
  language: 'zh-CN',
  locale: 'zh-CN',
  setLanguage() {},
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(preferredLanguage);
  const rootRef = useRef<HTMLDivElement>(null);
  const originalTextRef = useRef(new WeakMap<Text, string>());
  const originalAttributesRef = useRef(new WeakMap<Element, Map<string, string>>());
  const value = useMemo<I18nValue>(
    () => ({
      language,
      locale: language === 'en' ? 'en-US' : 'zh-CN',
      setLanguage(next) {
        localStorage.setItem(STORAGE_KEY, next);
        setLanguageState(next);
      },
    }),
    [language],
  );

  useLayoutEffect(() => {
    document.documentElement.lang = language;
    const originalText = originalTextRef.current;
    const originalAttributes = originalAttributesRef.current;
    let applying = false;

    function localizeNode(node: Text) {
      if (language === 'en') {
        const source = originalText.get(node) ?? node.data;
        originalText.set(node, source);
        const translated = translateToEnglish(source);
        if (translated !== node.data) node.data = translated;
      } else {
        const source = originalText.get(node);
        if (source !== undefined && source !== node.data) node.data = source;
      }
    }

    function localizeElement(element: Element) {
      if (
        element.hasAttribute('data-i18n-ignore') ||
        ['CODE', 'PRE', 'SCRIPT', 'STYLE', 'TEXTAREA'].includes(element.tagName)
      ) {
        return;
      }
      let originals = originalAttributes.get(element);
      for (const attribute of LOCALIZED_ATTRIBUTES) {
        const current = element.getAttribute(attribute);
        if (current === null) continue;
        if (language === 'en') {
          originals ??= new Map();
          const source = originals.get(attribute) ?? current;
          originals.set(attribute, source);
          const translated = translateToEnglish(source);
          if (translated !== current) element.setAttribute(attribute, translated);
        } else {
          const source = originals?.get(attribute);
          if (source !== undefined && source !== current) element.setAttribute(attribute, source);
        }
      }
      if (originals) originalAttributes.set(element, originals);
      for (const child of element.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) localizeNode(child as Text);
        else if (child.nodeType === Node.ELEMENT_NODE) localizeElement(child as Element);
      }
    }

    const root = rootRef.current;
    if (!root) return;
    applying = true;
    localizeElement(root);
    applying = false;

    const observer = new MutationObserver((mutations) => {
      if (applying) return;
      applying = true;
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') {
          const node = mutation.target as Text;
          // A React update replaces the source text for this node.
          if (language === 'en' && /[\p{Script=Han}]/u.test(node.data))
            originalText.set(node, node.data);
          localizeNode(node);
        } else if (mutation.type === 'attributes') {
          const element = mutation.target as Element;
          if (language === 'en' && mutation.attributeName) {
            const current = element.getAttribute(mutation.attributeName);
            if (current && /[\p{Script=Han}]/u.test(current)) {
              const originals = originalAttributes.get(element) ?? new Map<string, string>();
              originals.set(mutation.attributeName, current);
              originalAttributes.set(element, originals);
            }
          }
          localizeElement(element);
        } else {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.TEXT_NODE) localizeNode(node as Text);
            else if (node.nodeType === Node.ELEMENT_NODE) localizeElement(node as Element);
          }
        }
      }
      applying = false;
    });
    observer.observe(root, {
      attributes: true,
      attributeFilter: [...LOCALIZED_ATTRIBUTES],
      characterData: true,
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, [language]);

  return (
    <I18nContext.Provider value={value}>
      <div ref={rootRef} className="contents">
        {children}
      </div>
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}
