# Changelog

## 0.1.0

First release.

- Sidebar-foot "快捷方式" entry (directly above Settings) listing every shortcut; pressing one delivers its text into the target session in the background, with a success/failure banner.
- "加入快捷方式" button injected immediately left of the copy control on every durable user message; its dialog is seeded with that bubble's text and locks the target session to the bubble's own session.
- Settings tab "快捷方式": list, edit name/content, delete with confirmation, and create by hand (target session picked from the client session list).
- Durable store at `$DSH_HOME/shortcut/entries.json` (atomic write, corrupt-file reporting), served/delivered by a host RPC channel through the host Session Controller.
- zh/en dictionaries; plugin loads on `@deepseek-ai/dsh` 0.2.0-rc.2.
