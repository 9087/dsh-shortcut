/**
 * dsh-shortcut dictionaries (zh + en), registered under the `shortcut`
 * namespace. Every user-visible sentence this plugin draws lives here.
 *
 * @module dsh-shortcut/client/locale
 */

/** Locale namespace this plugin owns. */
export const NS = 'shortcut'

/** Chinese dictionary; the key set is the contract the English one must meet. */
export const zh = {
  'trigger.label': '快捷方式',
  'trigger.tooltip': '快捷方式：把一条发言发送到它对应的会话或智能体',

  'menu.empty': '还没有快捷方式。可以在消息气泡上点「加入快捷方式」，或在设置里添加。',
  'menu.currentSession': '当前会话',
  'menu.anySession': '任意会话',
  'menu.otherSessions': '其他会话',
  'menu.about': '关于此菜单',
  'menu.loadFailed': '读取快捷方式失败',

  'about.title': '关于「快捷方式」菜单',
  'about.plugin': '这个菜单由 DeepSeek Harness 插件「快捷方式」（dsh-shortcut）提供：把一段发言和一个目标存成一条快捷方式，之后点一下就能把内容发送过去，不用切换会话。目标就是「工作区 → 会话」上的一个会话（即它的主智能体），或者展开会话后选中的某个子智能体 / 团队成员。',
  'about.add': '添加：在你自己的消息气泡上点「加入快捷方式」（复制按钮左边），输入名称并确定；也可以在「设置 → 快捷方式」里点「添加快捷方式」，用树形列表选择工作区、会话，需要时展开会话再选子智能体 / 团队成员。',
  'about.edit': '编辑：在「设置 → 快捷方式」里点某一条的「编辑」，可以修改名称、目标和内容。',
  'about.delete': '删除：在「设置 → 快捷方式」里点某一条的「删除」，确认后即删除，无法撤销。',
  'about.use': '使用：点这个菜单里的任意一条，内容会发送到它对应的目标（主智能体、子智能体或团队成员）。默认发送后跳转到该会话；在添加/编辑时关掉「跳转到该会话」，就只会在后台发送、不切换当前会话。',
  'about.storage': '条目保存在 $DSH_HOME/shortcut/entries.json，重启 DSH 后仍然保留。',
  'about.close': '知道了',

  'bubble.add': '加入快捷方式',

  'dialog.createTitle': '添加快捷方式',
  'dialog.editTitle': '编辑快捷方式',
  'dialog.nameLabel': '名称',
  'dialog.namePlaceholder': '给这个快捷方式起个名字',
  'dialog.targetLabel': '目标',
  'dialog.navigateLabel': '跳转到该会话',
  'dialog.navigateHint': '开启时，点快捷方式发送后会切换到目标会话；关闭则留在当前会话，只在后台发送。',
  'dialog.anySessionLabel': '可发送给任意会话',
  'dialog.anySessionHint': '开启时这条快捷方式不绑定会话：点它时内容会发到当前正在查看的会话（它的主智能体）。关闭则始终发到上面选定的目标。',
  'dialog.textLabel': '内容',
  'dialog.textPlaceholder': '点击快捷方式时发送的内容',
  'dialog.cancel': '取消',
  'dialog.confirm': '确定',
  'dialog.save': '保存',
  'dialog.nameTaken': '这个名称已被占用',
  'dialog.saving': '保存中…',

  'settings.tabLabel': '快捷方式',
  'settings.title': '快捷方式',
  'settings.intro': '把「目标 + 一段发言」存成快捷方式：目标可以是会话本身（即它的主智能体），也可以是展开会话后选中的子智能体 / 团队成员。之后在左下角的快捷方式菜单里点一下，内容就会发送到对应目标；默认同时跳转到该会话，可在添加/编辑时关闭。',
  'settings.add': '添加快捷方式',
  'settings.empty': '还没有快捷方式',
  'settings.emptyHint': '在任意消息气泡上点「加入快捷方式」，或点上面的按钮手动创建。',
  'settings.target': '目标',
  'settings.edit': '编辑',
  'settings.delete': '删除',
  'settings.retry': '重试',
  'settings.loadFailed': '读取快捷方式失败：{message}',
  'settings.deleteTitle': '删除快捷方式',
  'settings.deleteBody': '确定删除「{name}」吗？此操作无法撤销。',
  'settings.deleteConfirm': '删除',

  'toast.sent': '已发送到「{target}」',
  'toast.created': '已添加快捷方式「{name}」',
  'toast.updated': '已保存「{name}」',
  'toast.deleted': '已删除「{name}」',
  'toast.interrupted': '被中断：请求已取消',

  'picker.placeholder': '选择目标',
  'picker.selectedAria': '当前选择的目标',
  'picker.search': '搜索工作区 / 会话 / 智能体',
  'picker.treeLabel': '工作区、会话与智能体',
  'picker.mainAgent': '主智能体',
  'picker.ungrouped': '未分组会话',
  'picker.loading': '正在读取会话…',
  'picker.loadingChildren': '正在读取子智能体…',
  'picker.loadFailed': '读取子智能体失败',
  'picker.noMatch': '没有匹配的目标',
  'picker.expand': '展开子智能体',
  'picker.collapse': '收起子智能体',
  'picker.tagMember': '团队成员',
  'picker.tagOneShot': '一次性',
  'picker.tagUnknownMode': '未知类型',
  'picker.tagProvisioning': '创建中',
  'picker.tagFailed': '失败',
  'picker.disabledOneShot': '一次性子智能体不能接收消息',
  'picker.disabledUnknownMode': '未知类型的子智能体不能接收消息',
  'picker.disabledProvisioning': '团队成员正在创建',
  'picker.disabledFailed': '团队成员创建失败',

  'error.invalid-input': '名称、目标（会话或其中的子智能体）和内容都不能为空',
  'error.name-taken': '名称已被占用',
  'error.not-found': '快捷方式不存在（可能已被删除）',
  'error.store-unavailable': '无法读写快捷方式存储文件',
  'error.session-not-found': '目标会话不存在或已被删除',
  'error.session-archived': '目标会话已归档，无法发送',
  'error.session-busy': '目标会话正忙，请稍后再试',
  'error.target-not-resumable': '这是一次性（不可继续）的子智能体，不能接收消息',
  'error.parent-unavailable': '目标智能体所属的父会话当前未运行，请先打开一次父会话再发送',
  'error.target-unavailable': '目标智能体已不存在或无法从该父会话投递',
  'error.no-current-session': '这条快捷方式发送给任意会话，请先打开一个会话再点它',
  'error.send-failed': '发送失败',
  'error.bridge-unknown': '无法确定这条消息属于哪个会话',
  'error.bubble-text-unknown': '无法读取这条消息的内容',
} as const

/** The key set every dictionary must cover. */
export type ShortcutKey = keyof typeof zh

/** English dictionary, key-checked against the Chinese one. */
export const en: Record<ShortcutKey, string> = {
  'trigger.label': 'Shortcuts',
  'trigger.tooltip': 'Shortcuts: send a saved message into its session or agent',

  'menu.empty': 'No shortcuts yet. Add one from a message bubble, or from Settings.',
  'menu.currentSession': 'Current session',
  'menu.anySession': 'Any session',
  'menu.otherSessions': 'Other sessions',
  'menu.about': 'About this menu',
  'menu.loadFailed': 'Could not load shortcuts',

  'about.title': 'About the Shortcuts menu',
  'about.plugin': 'This menu is provided by the DeepSeek Harness plugin "Shortcuts" (dsh-shortcut): it saves a message together with a target so one click sends that message there without switching sessions. A target is a session in a workspace (its main agent), or — after expanding that session — one of its subagents or team members.',
  'about.add': 'Add: press "Add to shortcuts" on one of your own message bubbles (left of the copy control), name it and confirm; or press "Add shortcut" under Settings → Shortcuts and pick workspace / session from the tree, expanding the session when you want a subagent or team member.',
  'about.edit': 'Edit: under Settings → Shortcuts press "Edit" on a row to change its name, target or content.',
  'about.delete': 'Delete: under Settings → Shortcuts press "Delete" on a row and confirm; this cannot be undone.',
  'about.use': 'Use: press any row in this menu and its text is sent to its target (main agent, subagent or team member). By default the shell then jumps to that target session; turn off "Jump to the session" while adding/editing to keep the current conversation and send in the background only.',
  'about.storage': 'Records live in $DSH_HOME/shortcut/entries.json and survive a DSH restart.',
  'about.close': 'Got it',

  'bubble.add': 'Add to shortcuts',

  'dialog.createTitle': 'Add shortcut',
  'dialog.editTitle': 'Edit shortcut',
  'dialog.nameLabel': 'Name',
  'dialog.namePlaceholder': 'Name this shortcut',
  'dialog.targetLabel': 'Target',
  'dialog.navigateLabel': 'Jump to the session',
  'dialog.navigateHint': 'On, a click switches to the target session after sending; off keeps you in the current conversation and only sends in the background.',
  'dialog.anySessionLabel': 'Sendable to any session',
  'dialog.anySessionHint': 'On, this shortcut is not bound to a session: clicking it sends the text to whichever session you are viewing (its main agent). Off, it always goes to the target picked above.',
  'dialog.textLabel': 'Content',
  'dialog.textPlaceholder': 'What gets sent when you click the shortcut',
  'dialog.cancel': 'Cancel',
  'dialog.confirm': 'OK',
  'dialog.save': 'Save',
  'dialog.nameTaken': 'That name is already taken',
  'dialog.saving': 'Saving…',

  'settings.tabLabel': 'Shortcuts',
  'settings.title': 'Shortcuts',
  'settings.intro': 'Save a target plus one message as a shortcut: the target can be a session itself (its main agent), or a subagent / team member picked after expanding that session. The sidebar menu then sends that message to its target with one click; by default it also jumps to that session, which can be turned off while adding or editing.',
  'settings.add': 'Add shortcut',
  'settings.empty': 'No shortcuts yet',
  'settings.emptyHint': 'Use "Add to shortcuts" on any message bubble, or the button above to create one by hand.',
  'settings.target': 'Target',
  'settings.edit': 'Edit',
  'settings.delete': 'Delete',
  'settings.retry': 'Retry',
  'settings.loadFailed': 'Could not load shortcuts: {message}',
  'settings.deleteTitle': 'Delete shortcut',
  'settings.deleteBody': 'Delete "{name}"? This cannot be undone.',
  'settings.deleteConfirm': 'Delete',

  'toast.sent': 'Sent to "{target}"',
  'toast.created': 'Shortcut "{name}" added',
  'toast.updated': '"{name}" saved',
  'toast.deleted': '"{name}" deleted',
  'toast.interrupted': 'Interrupted: the request was cancelled',

  'picker.placeholder': 'Pick a target',
  'picker.selectedAria': 'Currently selected target',
  'picker.search': 'Search workspaces / sessions / agents',
  'picker.treeLabel': 'Workspaces, sessions and agents',
  'picker.mainAgent': 'Main agent',
  'picker.ungrouped': 'Ungrouped sessions',
  'picker.loading': 'Loading sessions…',
  'picker.loadingChildren': 'Loading subagents…',
  'picker.loadFailed': 'Could not load subagents',
  'picker.noMatch': 'No matching target',
  'picker.expand': 'Show subagents',
  'picker.collapse': 'Hide subagents',
  'picker.tagMember': 'Team member',
  'picker.tagOneShot': 'One-shot',
  'picker.tagUnknownMode': 'Unknown kind',
  'picker.tagProvisioning': 'Provisioning',
  'picker.tagFailed': 'Failed',
  'picker.disabledOneShot': 'One-shot subagents cannot receive messages',
  'picker.disabledUnknownMode': 'Subagents of unknown kind cannot receive messages',
  'picker.disabledProvisioning': 'This team member is still provisioning',
  'picker.disabledFailed': 'This team member failed to provision',

  'error.invalid-input': 'Name, target (a session or one of its subagents) and content are all required',
  'error.name-taken': 'That name is already taken',
  'error.not-found': 'That shortcut no longer exists',
  'error.store-unavailable': 'The shortcut store file cannot be read or written',
  'error.session-not-found': 'The target session no longer exists',
  'error.session-archived': 'The target session is archived and cannot accept messages',
  'error.session-busy': 'The target session is busy; try again in a moment',
  'error.target-not-resumable': 'This is a one-shot subagent; it cannot receive messages',
  'error.parent-unavailable': 'The target agent parent session is not running; open the parent session once, then send again',
  'error.target-unavailable': 'The target agent no longer exists or cannot be reached from its parent session',
  'error.no-current-session': 'This shortcut goes to whichever session you are viewing; open a session first',
  'error.send-failed': 'Could not send the message',
  'error.bridge-unknown': 'Could not tell which session this message belongs to',
  'error.bubble-text-unknown': 'Could not read this message content',
}

/** Both dictionaries, in the shape `ctx.locale.register` takes. */
export const dictionaries = { zh, en }

/** Translate one key; the framework's bound translator is structurally this. */
export type Translate = (key: ShortcutKey, params?: Record<string, unknown>) => string

/** Render one closed error code, falling back to the generic send failure. */
export function errorText(t: Translate, code: string): string {
  const key = `error.${code}` as ShortcutKey
  return t(key)
}
