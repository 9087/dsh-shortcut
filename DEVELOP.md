# Developing dsh-shortcut

Two halves, two bundles, one package:

| Half | Source | Output | Runs in |
|---|---|---|---|
| Host | `src/index.ts`, `src/store.ts`, `src/share.ts`, `src/types.ts`, `src/atomic-write.ts` | `lib/index.js` | the `dsh` host process (Node) |
| Client | `src/client/**` (React + CSS module) | `lib/client.js` | the DSH Web page (browser) |

They talk over this plugin's own connection channel `'/shortcut'` (`list / create / update / remove / send`). The host owns the durable store and delivery; the browser owns every surface.

## Targets and delivery

A record addresses one **agent**, stored as `{ kind: 'main' | 'subagent' | 'member', childSessionId?, leafLabel?, path? }` next to the owning `sessionId`. `kind: 'main'` means the session's own agent; the other two are continuable direct-child sessions (a subagent, or an agent-team teammate, which is also a continuable child of the Lead).

Delivery therefore has two paths (`src/index.ts`):

- `main` → `ctx.sessionController.prompt({ requestId, sessionId, mode: 'queue', content })`, which resumes a cold session and persists the message;
- `subagent` / `member` → `ctx.subagents.prompt({ requestId, parentSessionId: sessionId, childSessionId, mode: 'continuable', delivery: 'queue', content })` — the same call the app makes for browser-authored child messages. It requires the child's DIRECT parent session to be live; one-shot children reject with `subagent/not-resumable`. Both are surfaced as `target-not-resumable` / `parent-unavailable`.

The host `sendFailure()` also recognizes the session API's subagent-routing refusal (`session/agent-busy` with the `use subagent delivery` reason) so it is never misreported as "session busy".

## What each half does

**Host**

- `src/store.ts` — `<DSH_HOME>/shortcut/entries.json` (v2 envelope `{ version: 2, entries }`), loaded once, mutations serialized, written via temp-file + rename with Windows `EPERM` retries (`src/atomic-write.ts`). v1 records are read as main-agent targets and rewritten as v2 on the next write. A corrupt/unreadable file answers `store-unavailable` instead of an empty list.
- `src/index.ts` — mounts the RPC channel on `ctx.connection`, and delivers a record by the path above. Services (`sessionController`, `subagents`) are resolved lazily with `ctx.get`, so the plugin still boots where the subagent runtime is absent. Failures are classified (`session-not-found`, `session-archived`, `session-busy`, `target-not-resumable`, `parent-unavailable`, `target-unavailable`, `send-failed`).
- `src/share.ts` — the draft rules both halves run (blank/length/duplicate-name, and target shape: `main` must have no child, subagent/member must have one, distinct from the session).

**Client** (`src/client/`)

- `index.ts` — `apply()`: registers the locale dictionaries, binds the RPC port, starts the catalog subscriptions, fills three seats and starts the bubble DOM bridge.
- `catalog.ts` — the shared data layer: subscribes once to `ctx.get('sessions').list` and `ctx.get('workspaces').list`, builds the picker input, resolves the target path (`<workspace> / <session>` for a main agent, plus the leaf for a child) for settings rows and toasts, and calls `sessions.refreshProjections(sessionId)` on demand (the `subagentCatalog` / `agentTeam` projections are NOT persisted, so an unloaded projection means "children unknown", never "no children").
- `picker-tree.ts` — the pure workspace → session tree: sessions come from `WorkspaceView.sessionIds`, and a session's child agents from its `subagentCatalog` plus `agentTeam` roster. **A session row IS its main-agent target** (selecting it yields `{ kind: 'main' }`); only expanding it reveals subagent/team-member leaves. An expand chevron is drawn only for a known non-empty branch, so a leaf never looks expandable while its catalog is still loading; one-shot/unknown-mode subagents and non-active team members are disabled with a reason. Each agent row also carries its `ancestors` session-id chain, which the editor stores so a saved target can be re-expanded and scrolled to on reopen. Unit-tested in `tests/picker-tree.spec.ts`.
- `components/SessionTreePicker.tsx` — the inline picker rendered inside the dialog (a read-only full-path line, search, session rows selecting the main agent, separate expand buttons, on-demand projection loading/prefetch, the native folder icon on grouping-only workspace rows, and the reopen-reveal effect: expand the stored `ancestors` chain and `scrollIntoView` the selected row). No popover/portal.
- `components/FooterEntry.tsx` — the sidebar-foot trigger + menu (`sidebar.footer.action`, order 90 — it only has to be in that list, which the shell draws above its Settings row; adjacency is explicitly not a requirement, since other footer plugins insert rows too), and the single host for the shared dialog/banner.
- `components/SettingsSection.tsx` — the Settings page (`settings.section`, id `shortcut`), showing each record's full target path.
- `components/EditorDialog.tsx` — the one add/edit dialog (name, target tree, content) in a wide two-column layout (tree left, message body right; the tree list scrolls at ~200px so the dialog stays short). Confirm is enabled only for a valid, non-duplicate draft; the host re-checks.
- `components/SessionSeat.tsx` — an invisible session-scoped seat (`conversation.session.header.utilities`) that publishes the shown session id and the chat snapshot into `session-bridge.ts`, and renders a hidden `[data-dsh-shortcut-session]` marker.
- `bubble-capture.ts` — the DOM bridge. The stock chat view gives a user bubble's action row **no plugin slot**, so the "add to shortcut" button is injected as a sibling immediately before the copy button. Stable anchors only: `[data-chat-flow-kind="user"]`, `[data-clock="start"]`, `[data-chat-node-key]`. It is idempotent, self-heals after React re-renders (MutationObserver + rAF), skips optimistic bubbles, uses the copy button's own class for styling, and tears everything down on dispose.
- `entries.ts` / `editor.ts` — module-level observable stores shared by every surface (menu, settings, dialog).

## Commands

```powershell
corepack pnpm install          # repo .npmrc pins registry.npmmirror.com (this machine)
pnpm run typecheck             # tsc -b (host + client)
pnpm run build                 # tsc -b && tsdown --env.DSH_BUILD_FACE client
pnpm test                      # vitest (unit: store, port, validation, bridge, DOM bridge, picker tree)
pnpm run e2e                   # Playwright, real dsh web + throwaway DSH_HOME
pnpm run release               # release-it (bump/tag/push) then verify:release — see PUBLISH.md
node scripts/screenshots.mjs   # both READMEs' screenshots (own throwaway hosts; needs DSH_BIN)
```

`pnpm run build` must run before `pnpm run e2e`: the suite drives the built `lib/`, never the TS source.

Commit subjects are load-bearing: `pnpm run release` derives the next version from the conventional-commit prefixes since the last tag and generates `CHANGELOG.md` from them. A `feat:` / `fix:` / `perf:` subject changes the version; `docs:` / `chore:` / `build:` / `test:` does not (rules in [PUBLISH.md](PUBLISH.md#version-rules)).

## E2E

`e2e/shortcut.spec.ts` boots a private `dsh web` against a temporary `DSH_HOME`, links this checkout into that home's web profile (`e2e/helpers/host.ts`), and drives Chromium. It never touches the user's own DSH home or the GUI on 3080; `stopHost` kills only the child it spawned.

The suite needs a `dsh` executable: it resolves `DSH_BIN`, then a `PATH` shim, then the newest `npx` cache install. On this machine:

```powershell
$env:DSH_BIN = 'C:\Users\吴志伟\AppData\Local\npm-cache\_npx\b86ed90107c62dab\node_modules\@deepseek-ai\dsh\lib\bin.js'
pnpm run e2e
```

`E2E_TIMING=1` prints phase timings. `E2E_LOCALE=en` runs the same story against an English GUI
(the assertions accept either language). The suite deliberately does NOT write the README images:
a browser that dies mid-run must cost a test, never a doc artefact. They come from the separate
screenshot script below.

What it asserts: plugin activation (its own DOM, plus no `startup failed:` in the host log); the sidebar trigger sits above Settings; the bubble button is immediately left of copy; the capture dialog is seeded from the bubble, defaults its jump switch on and stores the record (target `kind: 'main'`); the menu delivers into the original session and (with the switch on) navigates there, while a record with the switch off delivers without navigating; Settings edit (including turning the switch off), then add-by-hand through the **tree picker** (expand workspace → session, pick the main-agent leaf, row shows the full path), then delete; records survive a host restart.

The fixture has no model credentials, so a session's first turn fails fast. `settleTurn()` in `beforeAll` waits for that turn to settle before any test sends a shortcut: a message admitted while the only turn is still running goes into the agent queue and does not reach the durable log at the same moment, which made the delivery assertion depend on timing (the flake was only visible on slower runs). Sidebar-title probes are deliberately short (the shell truncates long generated titles), so an English run cannot miss a row whose title is cut before the probe's last word.

## Screenshots

`node scripts/screenshots.mjs` boots one throwaway `dsh web` per UI language with a realistic
fixture (one named workspace, three plausible sessions, a few seeded shortcuts), then writes two
**cropped** images per language — the add-shortcut dialog and the opened sidebar menu. The READMEs
never show the whole shell.

| Files | UI | Used by |
|---|---|---|
| `docs/images/shortcut-{dialog,menu}.png` | Chinese | [README.zh.md](README.zh.md) |
| `docs/images/shortcut-{dialog,menu}.en.png` | English | [README.md](README.md) |

It needs the same `DSH_BIN` the E2E uses and a built `lib/` (the images show the real plugin).
Re-run it after any UI or icon change; the script adds a settle delay after each "New session"
press so the shell's generated sidebar titles keep the first characters of the seeded message.

## Pitfalls this project already paid for

- **A plugin that fails to activate is a WARNING, not an exit** (`dsh: warning: N entries did not activate`); `dsh web` still prints its URL. Assert the plugin's own DOM — that is the real mount proof.
- **`dsh.client.inject` typos are silent**; a malformed `dsh.client` or a missing `exports["./client"].default` is a fatal boot (the `modules` entry is required).
- **No `@deepseek-ai/dsh-*` peer dependency is declared.** The 0.2.0-rc.2 install guard only accepts `^0.2.0-rc.2` ranges; declaring none (like `dsh-diff-approval`) sidesteps it and the host's services are resolved structurally.
- **The footer slot's roots are `display: contents`**; several footer plugins would be crammed into one flex row, so a stacking rule is injected (`index.ts`, deferring to `dsh-footer-order` when present).
- **Session logs are concatenated zstd frames**; `zstdDecompressSync` only decodes the first. The E2E therefore proves delivery through the GUI (open the target session and count its bubbles) rather than by decompressing the log.
- **`subagentCatalog` / `agentTeam` are not persisted projections.** A session's children are unknown until `sessions.refreshProjections(sessionId)` runs, so the tree treats "no projection yet" as *unknown* (an expandable session), never as *no children*. The picker asks on first expansion of a session or a subagent branch.
- **A child session is never deliverable through `sessionController.prompt`.** It answers `session/agent-busy` with a `use subagent delivery` reason; the host maps that (and `subagent/*`) to the target-specific error codes instead of "busy".
- **Never kill a `dsh` process you did not start.**
