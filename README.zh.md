# dsh-shortcut

[English](README.md) | 中文

[![license](https://img.shields.io/github/license/9087/dsh-shortcut)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20.11-339933)](package.json)
[![DSH](https://img.shields.io/badge/DSH-0.2.0--rc.2-blue)](https://github.com/deepseek-ai/deepseek-harness)

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的「快捷方式」插件：把
**一段发言**和它的**目标**（某个会话，或会话里的某智能体）存成一条快捷方式，点一下就能把内容
发过去。

![左下角的快捷方式菜单](docs/images/shortcut-menu.png)

## 功能

- 侧边栏底部、设置按钮上方新增一行「**快捷方式**」。点开列出全部快捷方式，点一条即把内容发送
  到它的目标。
- 发送后默认打开目标会话；添加/编辑弹窗里的「跳转到该会话」开关可以关掉它，保留原来的纯后台
  发送。
- 目标在弹窗内嵌的树里选择：工作区 → 会话 → 会话的**主智能体**、可继续的**子智能体**或
  **团队成员**。
- 任意一条自己的消息都能「加入快捷方式」（复制按钮左边）；也可在 **设置 → 快捷方式** 里统一
  管理（添加、编辑、改目标、删除）。
- 条目保存在 `$DSH_HOME/shortcut/entries.json`；发送失败会带上具体原因。

![添加或编辑快捷方式](docs/images/shortcut-dialog.png)

## 安装

```sh
dsh plugin --profile web add dsh-shortcut
```

从本地目录安装则把包名换成路径：`dsh plugin --profile web add /path/to/dsh-shortcut`。
然后重启 `dsh web`，刷新页面。

## 用法

1. 把鼠标移到自己的消息上，点「加入快捷方式」；或打开 **设置 → 快捷方式**，点「添加快捷方式」。
2. 在树里选目标——点会话即选它的主智能体，展开会话可选子智能体 / 团队成员——再填内容并确定。
3. 点左下角菜单里对应的那条：内容就会发送到它的目标。

## 注意

- 按 `@deepseek-ai/dsh` **0.2.0-rc.2** 构建与实测。
- 主智能体走宿主的 Session Controller；子智能体 / 团队成员走宿主的 subagent 运行时，因为那是
  寻址子会话的唯一方式。
- 「加入快捷方式」按钮是注入在复制按钮旁的（聊天外壳没有对应插槽），DSH 以后若改动聊天结构，
  可能需要同步更新 `src/client/bubble-capture.ts`。

## 开发

开发环境、测试、E2E 与踩过的坑见 [DEVELOP.md](DEVELOP.md)。发布见 [PUBLISH.md](PUBLISH.md)，
变更记录见 [CHANGELOG.md](CHANGELOG.md)。

## 许可

MIT，见 [LICENSE](LICENSE)。
