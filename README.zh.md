# dsh-shortcut

[English](README.md) | 中文

[![license](https://img.shields.io/github/license/9087/dsh-shortcut)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20.11-339933)](package.json)
[![DSH](https://img.shields.io/badge/DSH-0.2.0--rc.2-blue)](https://github.com/deepseek-ai/deepseek-harness)

一个 DeepSeek Harness（DSH）插件：把**一段发言**和**它要发往的会话**存成「快捷方式」，
之后在左下角点一下，这段内容就直接发送到那个会话里，**不用切换会话**。它解决的是那种
「每次都要切到另一个会话再手打一遍」的话——比如「重启服务」：收藏一次，之后随处一键可用。

| 左下角入口（设置按钮正上方） | 消息气泡上的「加入快捷方式」 |
| --- | --- |
| ![设置上方的快捷方式行](docs/images/shortcut-sidebar.png) | ![复制按钮左边的收藏按钮](docs/images/shortcut-bubble.png) |

点开入口就是全部快捷方式的菜单，点其中一条即发送：

![左下角弹出的快捷方式菜单](docs/images/shortcut-menu.png)

## 功能

- **左下角菜单，一键发送、不跳转**：侧边栏底部、其它插件入口与设置按钮之间新增一行
  「快捷方式」。点开向上弹出全部条目，点一条就把内容投递到它的目标会话，**当前页面停在
  原会话不动**；发送后用一条提示告诉你发到了哪个会话。
- **从消息气泡收藏**：每条用户消息的复制按钮**左边**新增「加入快捷方式」按钮。弹窗打开时
  名称默认为空、内容已预填为这条气泡的原文；目标会话锁定为这条消息所在的会话（收藏的意义
  就在于此）。
- **设置页管理**：`设置 → 快捷方式` 列出全部条目（名称 / 目标会话 / 内容摘要），可编辑名称
  与内容（复用同一个弹窗）、删除（二次确认），也可手动添加——这条路径会多一个「目标会话」
  选择器，因为没有气泡可以替它决定会话。
- **严格校验、失败可读**：名称非空且未被占用、已选目标会话、内容非空，四项齐了「确定」才
  可点；主机侧会再校验一遍。投递失败会分类成：会话不存在 / 已归档 / 忙 / 其它发送失败，
  不会静默失败。
- **持久化且不装傻**：条目保存在 `$DSH_HOME/shortcut/entries.json`（原子写入，跨重启保留）。
  存储文件损坏时明确报错，而不是当成空列表——否则重新添加一堆条目会覆盖掉只是格式坏了的文件。

收藏弹窗（目标会话已锁定）：

![目标会话锁定的收藏弹窗](docs/images/shortcut-dialog.png)

设置页签：

![快捷方式设置页签](docs/images/shortcut-settings.png)

## 安装

已发布到 npm 后：

```sh
dsh plugin --profile web add dsh-shortcut
```

或用 npx 运行 harness 的话：

```sh
npx @deepseek-ai/dsh plugin --profile web add dsh-shortcut
```

从本地目录安装（当前仓库支持的方式）：

```sh
dsh plugin --profile web add /path/to/dsh-shortcut
```

也可以手工挂载：把依赖加进 profile 的 `package.json`，并在该 profile 的
`cordis.patch.yml` 里插入这一行：

```yaml
- insert:
    - id: shortcut
      name: dsh-shortcut
```

然后重启 `dsh web`（host 只在启动时加载插件），刷新页面即可。

## 用法

1. 任意会话里把鼠标移到自己的消息上，点「加入快捷方式」，起个名字，确定。
2. 在左下角点「快捷方式」，点刚才那条——内容就发送到它对应的会话里，你正在读的会话不变。
3. 需要改名、改内容、删除或手动新增：`设置 → 快捷方式`。

## 注意事项

- **兼容性**：按 `@deepseek-ai/dsh` **0.2.0-rc.2** 构建与实测。左下角占
  `sidebar.footer.action`，设置页占 `settings.section`，投递走宿主自己的 Session Controller
  （`ctx.sessionController.prompt`，`mode: 'queue'`）。
- **气泡按钮是 DOM 桥**：0.2.0-rc.2 里用户消息的操作行没有插件插槽，所以按钮通过聊天视图的
  语义锚点（`data-chat-flow-kind`、`data-clock`、`data-chat-node-key`）注入到复制按钮旁边。
  它是幂等的、React 重渲染后会自动补回、跳过乐观回显，卸载时全部移除。未来 DSH 若改动这些
  锚点，需要同步更新 `src/client/bubble-capture.ts`。
- **页脚共存**：footer action 的根节点是 `display: contents`；本插件会把它们纵向排列（与
  `dsh-diff-approval` 使用同一条规则），检测到 `dsh-footer-order` 插件时让给它管理。
- **v1 范围**：只发往已存在的会话；不做热键、不做变量/占位符替换、不做定时发送、不跨设备
  同步。条目按 `$DSH_HOME` 全局共享，不区分 profile。

## 开发

开发环境、两半结构、测试/E2E 命令与踩过的坑见 [DEVELOP.md](DEVELOP.md)；
发布步骤见 [PUBLISH.md](PUBLISH.md)；变更记录见 [CHANGELOG.md](CHANGELOG.md)。

## 许可

MIT，见 [LICENSE](LICENSE)。
