# Publishing dsh-shortcut

## Before the first publish

1. **Confirm the name is still free** (it was on 2026-10-18):
   ```powershell
   npm view dsh-shortcut version --registry=https://registry.npmjs.org
   ```
   A `404` means free. Never use the plural `dsh-shortcuts` (taken).
2. **Registry**: this machine cannot reach `registry.npmjs.org` directly. Either pass
   `--registry=https://registry.npmjs.org` from a network that can, or publish through a
   registry proxy. `registry.npmmirror.com` is a read mirror and does not accept publishes.
3. **npm login** as the package owner (`npm whoami`).

## Local gate (must be green)

```powershell
pnpm run typecheck
pnpm test
pnpm run build
$env:DSH_BIN = 'C:\Users\吴志伟\AppData\Local\npm-cache\_npx\b86ed90107c62dab\node_modules\@deepseek-ai\dsh\lib\bin.js'
pnpm run e2e
npm pack --dry-run
```

`npm pack --dry-run` must list `lib/index.js`, `lib/client.js`, `lib/types/**`, `cordis.patch.yml` and `package.json`. Those are the files the loader opens.

## Publish

```powershell
npm version 0.1.0 --no-git-tag-version   # or bump following semver
pnpm run build
npm publish --registry=https://registry.npmjs.org
```

Then smoke-test the published artefact (never the local directory):

```powershell
$home = Join-Path $env:TEMP ("dsh-shortcut-pub-" + [guid]::NewGuid().ToString('N').Substring(0,6))
New-Item -ItemType Directory $home | Out-Null
$env:DSH_HOME = $home
node $env:DSH_BIN plugin --profile web add dsh-shortcut
node $env:DSH_BIN web --host 127.0.0.1 --port 24631 --no-open   # Ctrl+C after the URL prints
```

Open the URL, confirm the sidebar "快捷方式" entry is drawn and the page shows no
`1 entry did not activate` / `startup failed:` message.

## Version rules

- `0.1.x` for fixes to this first surface set.
- `0.2.0` when the DSH client API this plugin builds against changes shape (bubble anchors,
  slot options, session API) — report the tested DSH version in the release notes.
- Bump `peerDependencies` only if a real `@deepseek-ai/dsh-*` peer is added; the install guard
  accepts only ranges satisfying the running DSH version.
