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
  'trigger.tooltip': '快捷方式：把一条发言发送到它对应的会话',

  'menu.empty': '还没有快捷方式。可以在消息气泡上点「加入快捷方式」，或在设置里添加。',
  'menu.about': '关于此菜单',
  'menu.loadFailed': '读取快捷方式失败',

  'about.title': '关于「快捷方式」菜单',
  'about.plugin': '这个菜单由 DeepSeek Harness 插件「快捷方式」（dsh-shortcut）提供：把一段发言和它要发往的会话存成一条快捷方式，之后点一下就能把内容发送到那个会话，不用切换会话。',
  'about.add': '添加：在你自己的消息气泡上点「加入快捷方式」（复制按钮左边），输入名称并确定；也可以在「设置 → 快捷方式」里点「添加快捷方式」手动创建。',
  'about.edit': '编辑：在「设置 → 快捷方式」里点某一条的「编辑」，可以修改名称、目标会话和内容。',
  'about.delete': '删除：在「设置 → 快捷方式」里点某一条的「删除」，确认后即删除，无法撤销。',
  'about.use': '使用：点这个菜单里的任意一条，内容会发送到它对应的会话，你正在看的会话保持不变。',
  'about.storage': '条目保存在 $DSH_HOME/shortcut/entries.json，重启 DSH 后仍然保留。',
  'about.close': '知道了',

  'bubble.add': '加入快捷方式',

  'dialog.createTitle': '添加快捷方式',
  'dialog.editTitle': '编辑快捷方式',
  'dialog.nameLabel': '名称',
  'dialog.namePlaceholder': '给这个快捷方式起个名字',
  'dialog.sessionLabel': '目标会话',
  'dialog.sessionPlaceholder': '选择一个会话',
  'dialog.sessionFixed': '当前会话',
  'dialog.sessionUnknown': '未知会话',
  'dialog.sessionPick': '选择会话',
  'dialog.textLabel': '内容',
  'dialog.textPlaceholder': '点击快捷方式时发送的内容',
  'dialog.cancel': '取消',
  'dialog.confirm': '确定',
  'dialog.save': '保存',
  'dialog.nameTaken': '这个名称已被占用',
  'dialog.noSessions': '没有可选择的会话',
  'dialog.saving': '保存中…',

  'settings.tabLabel': '快捷方式',
  'settings.title': '快捷方式',
  'settings.intro': '把「目标会话 + 一段发言」存成快捷方式。之后在左下角的快捷方式菜单里点一下，内容就会发送到对应会话，不用切换会话。',
  'settings.add': '添加快捷方式',
  'settings.empty': '还没有快捷方式',
  'settings.emptyHint': '在任意消息气泡上点「加入快捷方式」，或点上面的按钮手动创建。',
  'settings.session': '目标会话',
  'settings.edit': '编辑',
  'settings.delete': '删除',
  'settings.retry': '重试',
  'settings.loadFailed': '读取快捷方式失败：{message}',
  'settings.deleteTitle': '删除快捷方式',
  'settings.deleteBody': '确定删除「{name}」吗？此操作无法撤销。',
  'settings.deleteConfirm': '删除',

  'toast.sent': '已发送到「{session}」',
  'toast.created': '已添加快捷方式「{name}」',
  'toast.updated': '已保存「{name}」',
  'toast.deleted': '已删除「{name}」',
  'toast.interrupted': '被中断：请求已取消',

  'error.invalid-input': '名称、目标会话和内容都不能为空',
  'error.name-taken': '名称已被占用',
  'error.not-found': '快捷方式不存在（可能已被删除）',
  'error.store-unavailable': '无法读写快捷方式存储文件',
  'error.session-not-found': '目标会话不存在或已被删除',
  'error.session-archived': '目标会话已归档，无法发送',
  'error.session-busy': '目标会话正忙，请稍后再试',
  'error.send-failed': '发送失败',
  'error.bridge-unknown': '无法确定这条消息属于哪个会话',
  'error.bubble-text-unknown': '无法读取这条消息的内容',
} as const

/** The key set every dictionary must cover. */
export type ShortcutKey = keyof typeof zh

/** English dictionary, key-checked against the Chinese one. */
export const en: Record<ShortcutKey, string> = {
  'trigger.label': 'Shortcuts',
  'trigger.tooltip': 'Shortcuts: send a saved message into its session',

  'menu.empty': 'No shortcuts yet. Add one from a message bubble, or from Settings.',
  'menu.about': 'About this menu',
  'menu.loadFailed': 'Could not load shortcuts',

  'about.title': 'About the Shortcuts menu',
  'about.plugin': 'This menu is provided by the DeepSeek Harness plugin "Shortcuts" (dsh-shortcut): it saves a message together with the session it targets, so one click sends that message there without switching sessions.',
  'about.add': 'Add: press "Add to shortcuts" on one of your own message bubbles (left of the copy control), name it and confirm; or press "Add shortcut" under Settings → Shortcuts to create one by hand.',
  'about.edit': 'Edit: under Settings → Shortcuts press "Edit" on a row to change its name, target session or content.',
  'about.delete': 'Delete: under Settings → Shortcuts press "Delete" on a row and confirm; this cannot be undone.',
  'about.use': 'Use: press any row in this menu and its text is sent to its target session, while the conversation you are reading stays put.',
  'about.storage': 'Records live in $DSH_HOME/shortcut/entries.json and survive a DSH restart.',
  'about.close': 'Got it',

  'bubble.add': 'Add to shortcuts',

  'dialog.createTitle': 'Add shortcut',
  'dialog.editTitle': 'Edit shortcut',
  'dialog.nameLabel': 'Name',
  'dialog.namePlaceholder': 'Name this shortcut',
  'dialog.sessionLabel': 'Target session',
  'dialog.sessionPlaceholder': 'Pick a session',
  'dialog.sessionFixed': 'This session',
  'dialog.sessionUnknown': 'Unknown session',
  'dialog.sessionPick': 'Pick a session',
  'dialog.textLabel': 'Content',
  'dialog.textPlaceholder': 'What gets sent when you click the shortcut',
  'dialog.cancel': 'Cancel',
  'dialog.confirm': 'OK',
  'dialog.save': 'Save',
  'dialog.nameTaken': 'That name is already taken',
  'dialog.noSessions': 'No sessions to pick',
  'dialog.saving': 'Saving…',

  'settings.tabLabel': 'Shortcuts',
  'settings.title': 'Shortcuts',
  'settings.intro': 'Save a target session plus one message as a shortcut. The sidebar menu then sends that message into its session with one click, without switching sessions.',
  'settings.add': 'Add shortcut',
  'settings.empty': 'No shortcuts yet',
  'settings.emptyHint': 'Use "Add to shortcuts" on any message bubble, or the button above to create one by hand.',
  'settings.session': 'Target session',
  'settings.edit': 'Edit',
  'settings.delete': 'Delete',
  'settings.retry': 'Retry',
  'settings.loadFailed': 'Could not load shortcuts: {message}',
  'settings.deleteTitle': 'Delete shortcut',
  'settings.deleteBody': 'Delete "{name}"? This cannot be undone.',
  'settings.deleteConfirm': 'Delete',

  'toast.sent': 'Sent to "{session}"',
  'toast.created': 'Shortcut "{name}" added',
  'toast.updated': '"{name}" saved',
  'toast.deleted': '"{name}" deleted',
  'toast.interrupted': 'Interrupted: the request was cancelled',

  'error.invalid-input': 'Name, target session and content are all required',
  'error.name-taken': 'That name is already taken',
  'error.not-found': 'That shortcut no longer exists',
  'error.store-unavailable': 'The shortcut store file cannot be read or written',
  'error.session-not-found': 'The target session no longer exists',
  'error.session-archived': 'The target session is archived and cannot accept messages',
  'error.session-busy': 'The target session is busy; try again in a moment',
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
