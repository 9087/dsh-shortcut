# Developing dsh-shortcut

Two halves, two bundles, one package:

| Half | Source | Output | Runs in |
|---|---|---|---|
| Host | `src/index.ts`, `src/store.ts`, `src/share.ts`, `src/types.ts`, `src/atomic-write.ts` | `lib/index.js` | the `dsh` host process (Node) |
| Client | `src/client/**` (React + CSS module) | `lib/client.js` | the DSH Web page (browser) |

They talk over this plugin's own connection channel `'/shortcut'` (`list / create / update / remove / send`). The host owns the durable store and delivery; the browser owns every surface.

## What each half does

**Host**

- `src/store.ts` — `<DSH_HOME>/shortcut/entries.json` (v1 envelope `{ version, entries }`), loaded once, mutations serialized, written via temp-file + rename with Windows `EPERM` retries (`src/atomic-write.ts`). A corrupt/unreadable file answers `store-unavailable` instead of an empty list.
- `src/index.ts` — mounts the RPC channel on `ctx.connection`, and delivers a record by calling the host's `ctx.sessionController.prompt({ requestId, sessionId, mode: 'queue', content: [{ type: 'text', text }] })`. Failures are classified (`session-not-found`, `session-archived`, `session-busy`, `send-failed`).
- `src/share.ts` — the draft rules both halves run (blank/length/duplicate-name).

**Client** (`src/client/`)

- `index.ts` — `apply()`: registers the locale dictionaries, binds the RPC port, fills three seats and starts the bubble DOM bridge.
- `components/FooterEntry.tsx` — the sidebar-foot trigger + menu (`sidebar.footer.action`, order 90 → directly above Settings), and the single host for the shared dialog/banner.
- `components/SettingsSection.tsx` — the Settings page (`settings.section`, id `shortcut`).
- `components/EditorDialog.tsx` — the one add/edit dialog (name, target session, content). Confirm is enabled only for a valid, non-duplicate draft; the host re-checks.
- `components/SessionSeat.tsx` — an invisible session-scoped seat (`conversation.session.header.utilities`) that publishes the shown session id and the chat snapshot into `session-bridge.ts`, and renders a hidden `[data-dsh-shortcut-session]` marker.
- `bubble-capture.ts` — the DOM bridge. The stock chat view gives a user bubble's action row **no plugin slot**, so the "add to shortcut" button is injected as a sibling immediately before the copy button. Stable anchors only: `[data-chat-flow-kind="user"]`, `[data-clock="start"]`, `[data-chat-node-key]`. It is idempotent, self-heals after React re-renders (MutationObserver + rAF), skips optimistic bubbles, uses the copy button's own class for styling, and tears everything down on dispose.
- `entries.ts` / `editor.ts` — module-level observable stores shared by every surface (menu, settings, dialog).

## Commands

```powershell
corepack pnpm install          # repo .npmrc pins registry.npmmirror.com (this machine)
pnpm run typecheck             # tsc -b (host + client)
pnpm run build                 # tsc -b && tsdown --env.DSH_BUILD_FACE client
pnpm test                      # vitest (unit: store, port, validation, bridge, DOM bridge)
pnpm run e2e                   # Playwright, real dsh web + throwaway DSH_HOME
node scripts/screenshots.mjs   # both READMEs' screenshots (own throwaway hosts; needs DSH_BIN)
```

`pnpm run build` must run before `pnpm run e2e`: the suite drives the built `lib/`, never the TS source.

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

What it asserts: plugin activation (its own DOM, plus no `startup failed:` in the host log); the sidebar trigger sits above Settings; the bubble button is immediately left of copy; the capture dialog is seeded from the bubble and stores the record; the menu delivers into the original session while the page stays on another session (the target's transcript gains a message, the current one does not); Settings edit/add/delete; records survive a host restart.

## Screenshots

`node scripts/screenshots.mjs` boots one throwaway `dsh web` per UI language, drives the whole
story, and writes the five images for both READMEs:

| Files | UI | Used by |
|---|---|---|
| `docs/images/shortcut-*.png` | Chinese | [README.zh.md](README.zh.md) |
| `docs/images/shortcut-*.en.png` | English | [README.md](README.md) |

It needs the same `DSH_BIN` the E2E uses and a built `lib/` (the images show the real plugin).
Re-run it after any UI or icon change; the script adds a settle delay after each "New session"
press so the shell's generated sidebar titles keep the first characters of the seeded message.

## Pitfalls this project already paid for

- **A plugin that fails to activate is a WARNING, not an exit** (`dsh: warning: N entries did not activate`); `dsh web` still prints its URL. Assert the plugin's own DOM — that is the real mount proof.
- **`dsh.client.inject` typos are silent**; a malformed `dsh.client` or a missing `exports["./client"].default` is a fatal boot (the `modules` entry is required).
- **No `@deepseek-ai/dsh-*` peer dependency is declared.** The 0.2.0-rc.2 install guard only accepts `^0.2.0-rc.2` ranges; declaring none (like `dsh-diff-approval`) sidesteps it and the host's services are resolved structurally.
- **The footer slot's roots are `display: contents`**; several footer plugins would be crammed into one flex row, so a stacking rule is injected (`index.ts`, deferring to `dsh-footer-order` when present).
- **Session logs are concatenated zstd frames**; `zstdDecompressSync` only decodes the first. The E2E therefore proves delivery through the GUI (open the target session and count its bubbles) rather than by decompressing the log.
- **Never kill a `dsh` process you did not start.**
