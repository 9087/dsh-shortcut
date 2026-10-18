# dsh-shortcut

English | [中文](README.zh.md)

[![license](https://img.shields.io/github/license/9087/dsh-shortcut)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20.11-339933)](package.json)
[![DSH](https://img.shields.io/badge/DSH-0.2.0--rc.2-blue)](https://github.com/deepseek-ai/deepseek-harness)

A DeepSeek Harness (DSH) plugin that saves **a message** together with **the session it
targets**, then delivers that message into its session with one click — without switching
conversations. It exists for the message you keep retyping in another session ("restart the
service"): capture it once, and it is one click away from anywhere.

| The sidebar-foot entry, directly above Settings | "Add to shortcuts" on a user bubble |
| --- | --- |
| ![Shortcuts row above Settings](docs/images/shortcut-sidebar.en.png) | ![Add-to-shortcuts button left of copy](docs/images/shortcut-bubble.en.png) |

Opening the entry lists every saved shortcut; pressing one sends its text:

![The shortcut menu open at the sidebar foot](docs/images/shortcut-menu.en.png)

The menu's last item, **About this menu**, says which plugin provides it and how records are added,
edited and deleted:

![The About this menu dialog](docs/images/shortcut-about.en.png)

## Features

- **Sidebar-foot menu, one click, no navigation**: a "Shortcuts" row sits between other plugins'
  footer actions and the shell's Settings row. It opens upward into a menu of every saved
  shortcut; pressing one delivers its text into the target session **while the page stays where
  it is**. A toast says which session received it.
- **Capture from a message bubble**: every durable user message carries an "Add to shortcuts"
  button immediately **left of the copy control**. The dialog opens with the shortcut name empty
  and the content already filled with that bubble's text; the target session is locked to the
  session that message belongs to (it is what makes the shortcut point somewhere).
- **Manage in Settings**: `Settings → Shortcuts` lists every record (name / target session /
  content), edits name and content in the same dialog, deletes with a confirmation, and creates
  records by hand — that path adds a target-session picker, because there is no bubble to take
  the session from.
- **Strict validation, readable failures**: the confirm button stays disabled until the name is
  non-blank and unused, the target session is chosen and the content is non-blank; the host
  re-checks the same rules. Delivery failures are classified: session missing, archived, busy,
  or a generic send failure — never a silent no-op.
- **Durable and honest about it**: records live in `$DSH_HOME/shortcut/entries.json` (atomic
  write, survived restarts). A corrupt store file is reported as an error rather than served as
  an empty list, so re-adding everything cannot overwrite a merely malformed file.

The capture dialog, seeded from the bubble:

![The capture dialog with the target session locked](docs/images/shortcut-dialog.en.png)

The Settings page:

![The Shortcuts settings tab](docs/images/shortcut-settings.en.png)

## Install

Once published to npm:

```sh
dsh plugin --profile web add dsh-shortcut
```

Or, if you run the harness through npx:

```sh
npx @deepseek-ai/dsh plugin --profile web add dsh-shortcut
```

From a checkout (what this repository supports today):

```sh
dsh plugin --profile web add /path/to/dsh-shortcut
```

Or mount it by hand in the profile's `cordis.patch.yml` and add the dependency yourself:

```yaml
- insert:
    - id: shortcut
      name: dsh-shortcut
```

Then restart `dsh web` (the host loads plugins once, at start-up) and refresh the page.

## Usage

1. In any session, hover your own message and press **Add to shortcuts**, give it a name, confirm.
2. Click **Shortcuts** at the sidebar foot and press that entry — the text is sent to its
   session, and the conversation you are reading does not change.
3. Rename, edit, delete or add records under `Settings → Shortcuts`.

## Notes

- **Compatibility**: built and tested against `@deepseek-ai/dsh` **0.2.0-rc.2**. The sidebar seat
  is `sidebar.footer.action`, the Settings page is `settings.section`, and delivery goes through
  the host's own Session Controller (`ctx.sessionController.prompt`, `mode: 'queue'`).
- **The bubble button is a DOM bridge**: in 0.2.0-rc.2 a user message's action row has no plugin
  slot, so the button is injected next to the copy control using the chat view's semantic
  anchors (`data-chat-flow-kind`, `data-clock`, `data-chat-node-key`). It is idempotent,
  re-inserts itself after React re-renders, skips optimistic echoes, and is removed on unload.
  A future DSH that changes those anchors needs `src/client/bubble-capture.ts` updated.
- **Footer coexistence**: footer-action roots are `display: contents`; this plugin stacks them
  vertically (the same rule `dsh-diff-approval` uses) and defers to `dsh-footer-order` when that
  plugin is installed.
- **Scope of v1**: existing sessions only; no hotkey, no variables/placeholders, no scheduling,
  no cross-device sync. Records are shared across profiles under `$DSH_HOME`.

## Development

Development setup, the two halves, test/E2E commands and the pitfalls paid for: [DEVELOP.md](DEVELOP.md).
Publishing steps: [PUBLISH.md](PUBLISH.md). Changes: [CHANGELOG.md](CHANGELOG.md).

## License

MIT — see [LICENSE](LICENSE).
