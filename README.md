# dsh-shortcut（快捷方式）

给 DeepSeek Harness 加一个「快捷方式」：把**一段发言**和**它要发往的会话**存下来，之后在左下角菜单里点一下，这段内容就直接发送到那个会话里，**不用切换会话**。

解决了「重启服务」这类固定指令每次都要切到某个会话再手打一遍的麻烦。

## 功能

- **左下角入口**：侧边栏底部、设置按钮正上方新增「快捷方式」按钮，点开列出全部快捷方式，点条目即发送（停留当前会话，不跳转）。
- **消息气泡收藏**：每条用户消息的「复制」按钮左边新增「加入快捷方式」按钮。点开弹窗，内容已预填为这条气泡的原文，名称默认为空，两者都可修改；目标会话固定为这条消息所在会话。
- **设置页签**：`设置 → 快捷方式` 列表展示全部快捷方式（名称 / 目标会话 / 内容摘要），可编辑名称与内容、删除（二次确认）、手动添加（弹窗里额外需要选择目标会话）。
- **校验**：名称不能为空、不能重名；内容不能为空；目标会话必须存在。不满足时「确定」不可点，主机侧也会再校验一次。
- **发送反馈**：成功有「已发送到「会话名」」提示；会话不存在 / 已归档 / 忙等失败原因有明确提示，不会静默失败。
- **持久化**：条目保存在 `$DSH_HOME/shortcut/entries.json`（默认 `C:\Users\<你>\.dsh\shortcut\entries.json`），重启 DSH 后仍在。文件损坏会明确报错，而不是假装没有条目。

## 安装

```powershell
# DSH 0.2.0-rc.2
node <dsh 安装目录>\node_modules\@deepseek-ai\dsh\lib\bin.js plugin --profile web add dsh-shortcut
# 或从本地目录安装
node <dsh>\lib\bin.js plugin --profile web add C:\PROJECTS\dsh-shortcut
```

安装后**重启 DSH Web**（host 半只在启动时加载），刷新页面即可看到左下角入口。

## 使用

1. 在任意会话里，把鼠标移到自己的消息气泡上，点「加入快捷方式」，输入名称，确定。
2. 之后在左下角点「快捷方式」，点刚才那条——内容就发送到它对应的会话里了。
3. 需要改名 / 改内容 / 删除 / 手动新增：`设置 → 快捷方式`。

## 兼容性

- 目标版本：`@deepseek-ai/dsh` **0.2.0-rc.2**（客户端服务与插槽按该版本发布包实现）。
- 侧边栏入口占 `sidebar.footer.action`，设置页占 `settings.section`，与 `dsh-diff-approval` 等插件共存（两者都用同一套 footer 堆叠样式）。
- 消息气泡按钮所在的操作行在 0.2.0-rc.2 没有插件插槽，因此通过语义 DOM 锚点（`data-chat-flow-kind="user"`、`data-clock="start"`、`data-chat-node-key`）注入，并自带自愈逻辑；不修改 React 自己渲染的复制按钮。

## 已知限制

- 只支持已存在的会话；不提供热键；不支持变量/占位符替换、定时发送、跨设备同步。
- 气泡按钮的注入依赖聊天视图的语义 DOM；未来 DSH 若改动这些属性，需要相应更新选择器（`src/client/bubble-capture.ts`）。
- 条目按 `$DSH_HOME` 全局共享，不区分 profile。

## 截图

| 侧边栏入口（设置按钮上方） | 消息气泡上的「加入快捷方式」 |
|---|---|
| ![侧边栏入口](docs/images/shortcut-sidebar.png) | ![气泡按钮](docs/images/shortcut-bubble.png) |

| 快捷方式菜单 | 收藏弹窗 |
|---|---|
| ![菜单](docs/images/shortcut-menu.png) | ![弹窗](docs/images/shortcut-dialog.png) |

设置页的「快捷方式」管理页签：

![设置页](docs/images/shortcut-settings.png)

## English summary

A DeepSeek Harness plugin that saves a message together with the session it targets. Click it in the sidebar-foot menu and the text is delivered into that session — without switching conversations. Capture comes from a button added left of the copy control on every user bubble; management lives in a dedicated Settings tab. Entries persist under `$DSH_HOME/shortcut/entries.json`.

See [DEVELOP.md](DEVELOP.md) for the dev loop, [PUBLISH.md](PUBLISH.md) for publishing, and [docs/images](docs/images) for screenshots.

## License

MIT
