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

```sh
pnpm run typecheck
pnpm test
pnpm run build
pnpm run e2e        # only where a local dsh and a real model API key exist
npm pack --dry-run
```

`npm pack --dry-run` must list `lib/index.js`, `lib/client.js`, `lib/types/**`, `cordis.patch.yml` and `package.json`. Those are the files the loader opens.

`pnpm run e2e` is the mount proof. `e2e/helpers/host.ts` creates a throwaway
`DSH_HOME` with `mkdtempSync(join(tmpdir(), 'dsh-shortcut-e2e-…'))`, passes it to
the spawned `dsh web` as `DSH_HOME`, and deletes exactly that directory in its
cleanup. Point `DSH_BIN` at a specific CLI when several are installed; never point
`DSH_HOME` at anything outside a directory the helper created.

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
disagree** — bump the version before tagging. After uploading it runs
`scripts/verify-release.mjs` against the served tarball, so a release whose published
files or client bundle differ from the tagged commit fails the job. E2E is intentionally
not part of CI: it needs a local DSH installation and a real model API key.

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

## Afterwards

`pnpm run verify:release [version]` reads what the registry actually serves — not the local
checkout. Omit the version to audit `latest`; during a release, pass `--expect-git-head` to
prove the record was built from the tagged commit:

```sh
pnpm run verify:release 0.2.0 --expect-git-head "$(git rev-parse HEAD)"
```

It polls until the version is served, checks the provenance attestation, downloads the
tarball and verifies its `dist.integrity`, compares the shipped `package.json` with this
one, checks the promised files, and runs the published `lib/client.js` through the shell's
module-loader contract — it must fill the session seat, the sidebar footer row and the
Settings section. Add `--allow-no-provenance` only when auditing a release published by the
manual fallback above.

A cheap spot check is the same fact from one place:

```sh
npm view dsh-shortcut@X.Y.Z version dist.tarball gitHead
```

The runtime mount check is `pnpm run e2e` from the local gate, above. Do **not**
reproduce it with a hand-written PowerShell `$env:DSH_HOME = …` block:

- In PowerShell, `$HOME` — and therefore `$home`, because variable names are
  case-insensitive — is a **read-only automatic variable** whose value is the real
  profile (`C:\Users\<you>`). Assigning to it fails, so `$env:DSH_HOME = $home`
  silently keeps pointing DSH at the live profile. A later
  `Remove-Item $home -Recurse -Force` then permanently deletes the real profile,
  bypassing the Recycle Bin. That exact mistake wiped a user profile on 2026-10-19.
- The supported pattern is the one used by `e2e/helpers/host.ts` (and by the
  `dsh-diff-approval` / `dsh-shell-progress` suites): build the path in Node with
  `mkdtempSync(join(tmpdir(), …))`, pass it only as the child process's `DSH_HOME`,
  and remove exactly that path in a `finally` — optionally asserting
  `home.startsWith(tmpdir())` first.
- If a PowerShell script is unavoidable, use a distinct name such as `$testHome`,
  assert it matches `Join-Path $env:TEMP 'dsh-shortcut-*'`, and use
  `Remove-Item -LiteralPath`; never rely on `-ErrorAction SilentlyContinue` to make a
  wrong path harmless.

## Version rules

- `0.1.x` for fixes to the existing surface set.
- `0.2.0` for a new observable feature (for example the jump switch in `0.2.0`) or when the DSH
  client API this plugin builds against changes shape (bubble anchors, slot options, session API) —
  report the tested DSH version in the release notes.
- Pushing a `v<package.json version>` tag now also publishes (Trusted Publishing), so tag only a
  commit whose version is final.
- Bump `peerDependencies` only if a real `@deepseek-ai/dsh-*` peer is added; the install guard
  accepts only ranges satisfying the running DSH version.
- Never name a PowerShell variable `$home`/`$HOME`, and never set `DSH_HOME` to a path that
  was not created under `%TEMP%` for a single test.
