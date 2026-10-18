# Publishing dsh-shortcut

## Before the first publish

1. **Confirm the name is still free** (it was on 2026-10-18):
   ```powershell
   npm view dsh-shortcut version --registry=https://registry.npmjs.org
   ```
   A `404` means free. Never use the plural `dsh-shortcuts` (taken).
2. **Registry**: `registry.npmjs.org` is reachable from this machine (verified 2026-10-19);
   this repo's `.npmrc` points installs at the npmmirror read mirror, so publishing must pass
   `--registry=https://registry.npmjs.org` explicitly (or rely on `publishConfig.registry`).
   `registry.npmmirror.com` does not accept publishes.
3. **npm login** as the package owner (`npm login --registry=https://registry.npmjs.org`,
   then `npm whoami --registry=https://registry.npmjs.org`). A stale token in the user-level
   `.npmrc` fails `whoami` with `401` — log in again or replace
   `//registry.npmjs.org/:_authToken` with a fresh automation token.

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

With 2FA on the account, add `--otp=<6-digit code>` to the publish command.

## Publish from GitHub Actions (Trusted Publishing)

The repository ships [`.github/workflows/publish.yml`](.github/workflows/publish.yml).
It publishes with npm **Trusted Publishing** (GitHub OIDC + provenance), so no
`NPM_TOKEN` secret and no one-time password is involved. One-time setup:

1. The package must already exist on npm — one version is enough, and the current
   `0.0.0-stage` placeholder satisfies that. (Configure Trusted Publishing *before*
   the first real version so that first real publish can go through CI.)
2. On npmjs.com open the package → **Settings** → **Trusted publishing** →
   **Add a publisher** and fill in:
   - Publisher: **GitHub Actions**
   - Organization or user: `9087`
   - Repository: `dsh-shortcut`
   - Workflow filename: `publish.yml`
   - Environment: leave empty (or name one and uncomment `environment:` in the workflow)
3. Push the workflow, then create a GitHub **Release** for the matching tag:

   ```powershell
   git tag v0.1.0
   git push origin v0.1.0
   gh release create v0.1.0 --title v0.1.0 --notes "First release."
   ```

   Publishing the release triggers the workflow. It can also be started manually
   (Actions → **Publish to npm** → Run workflow, with an optional `dry_run`), which
   publishes whatever version `package.json` currently holds.

The workflow runs typecheck, unit tests, build and `npm pack --dry-run` before
uploading, and **fails when the release tag (`vX.Y.Z`) and `package.json` version
disagree** — bump the version before tagging. E2E is intentionally not part of CI:
it needs a local DSH installation and a real model API key.

If Trusted Publishing cannot be used (for example a private repository), fall back
to a granular automation token: add the repository secret `NPM_TOKEN` and insert
these steps before the publish step (the workflow already targets npmjs and upgrades
npm):

```yaml
      - name: Authenticate with npm
        run: npm config set //registry.npmjs.org/:_authToken "$NODE_AUTH_TOKEN"
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

      - name: Publish
        run: npm publish --access public --registry=https://registry.npmjs.org
```

`--provenance` only works for public source repositories.

Once the real version is out, the placeholder can be removed:

```powershell
npm unpublish dsh-shortcut@0.0.0-stage --registry=https://registry.npmjs.org --force
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

- `0.1.x` for fixes to the existing surface set.
- `0.2.0` for a new observable feature (for example the jump switch in `0.2.0`) or when the DSH
  client API this plugin builds against changes shape (bubble anchors, slot options, session API) —
  report the tested DSH version in the release notes.
- Pushing a `v<package.json version>` tag now also publishes (Trusted Publishing), so tag only a
  commit whose version is final.
- Bump `peerDependencies` only if a real `@deepseek-ai/dsh-*` peer is added; the install guard
  accepts only ranges satisfying the running DSH version.
