# Changelog

## Unreleased

- **A target is a session, or one agent inside it.** The add/edit dialog and the Settings "Add shortcut" flow use a tree picker: workspace → session, expanded on demand. Pressing a session row targets its **main agent** — there is no redundant "main agent" child row. A session that really has child agents gets an expand chevron (never drawn for a leaf, and only after its catalog is known): expanding it lists its continuable subagents (labelled by the delegation's work description) and agent-team members (by member name), and a subagent that delegates further becomes a branch. One-shot/unknown-mode subagents and non-active team members are shown but greyed out with the reason, and a search box filters the tree.
- **Two delivery paths.** Main agents still go through the host Session Controller; subagents and team members go through the host subagent runtime (`ctx.subagents.prompt`, `mode: 'continuable'`, `delivery: 'queue'`), which is the only supported way to address a child session. New classified failures: `target-not-resumable` (one-shot child), `parent-unavailable` (child's parent session is not running), `target-unavailable` (unreachable/invalid child); `session/agent-busy` with the subagent-routing reason is no longer misreported as "busy".
- **Store schema version 2.** Records now carry `{ kind: 'main' | 'subagent' | 'member', childSessionId?, leafLabel?, path? }`. Version 1 files are read as main-agent targets and rewritten as version 2 on the next save; no user action needed.
- **The editor dialog is wide and two-column**: name + inline target tree on the left, the message body on the right, so the dialog no longer grows tall for the tree (the tree list scrolls at ~200px).
- **The target tree is inline in the dialog, not a dropdown.** A read-only full-path line sits above the tree; the tree (search + expandable workspace/session rows) is always visible. Workspace rows only group — they wear the native folder icon and are never selectable; a session row is its main-agent target, and an expand chevron appears only for sessions/branches that really have child agents. The hint text says so.
- **Reopening a stored shortcut reveals its target**: the editor selects the saved session/agent, expands its workspace plus every ancestor session in the stored chain, and centers the selected row once. Pressing a session/agent row yourself never scrolls the list — only the reopen path does. The chain is persisted as the optional `target.ancestors` field (records written before it still open at their session; new ones get the full path).
- **Settings rows show the target path** (`<workspace> / <session>`, plus the leaf for a subagent/team member), resolved live with the saved path as fallback when the session is gone; the delivery toast names the same leaf.
- The target picker's data comes from the client `workspaces`/`sessions` stores; a session's `subagentCatalog`/`agentTeam` projections are requested with `sessions.refreshProjections` on first expansion (they are not persisted by DSH). Child rows whose own catalog is not loaded yet are prefetched in the background (bounded concurrency), and an expand chevron is drawn only for a **known non-empty branch** — a leaf never looks expandable just because its read has not landed.
- **The Settings header action is placed between the description and the list**: on every width it sits directly under the intro (so it never squeezes the title or overlaps the text) and just above the records list. On wide screens it keeps its natural single-line width with a plus icon; only on narrow screens (≤640px) does it stretch to the full row.
- New docs screenshot `shortcut-picker{,.en}.png`; both READMEs and the "About this menu" dialog describe agent targets.

## 0.1.0

First release.

- Sidebar-foot "快捷方式" entry (directly above Settings) listing every shortcut; pressing one delivers its text into the target session in the background, with a success/failure banner.
- "加入快捷方式" button injected immediately left of the copy control on every durable user message; its dialog is seeded with that bubble's text and locks the target session to the bubble's own session.
- Settings tab "快捷方式": list, edit name/content, delete with confirmation, and create by hand (target session picked from the client session list).
- Durable store at `$DSH_HOME/shortcut/entries.json` (atomic write, corrupt-file reporting), served/delivered by a host RPC channel through the host Session Controller.
- zh/en dictionaries; plugin loads on `@deepseek-ai/dsh` 0.2.0-rc.2.
