#!/usr/bin/env node
/**
 * Verify the artifact that is actually ON the registry, after it has been published.
 *
 * Everything before this point in a release proves the SOURCE: `pnpm test` runs the
 * suite against `src/`, and the build writes `lib/`. None of that is the thing users
 * download. A tarball can ship a stale `lib/client.js`, omit a declared file, or be
 * published from the wrong commit, and every gate up to `npm publish` stays green.
 * This script is the only step that reads what the registry serves.
 *
 * It checks, in order:
 *
 * 1. the registry SERVES the version at all — after a publish there is a propagation
 *    window in which the version is simply absent, so this polls rather than guessing;
 * 2. the record's `gitHead` is the commit being released (when `--expect-git-head` is given);
 * 3. the record carries a PROVENANCE attestation (Trusted Publishing produces one);
 * 4. the tarball holds the files `package.json` promises, by downloading and extracting
 *    it and comparing the shipped manifest with this checkout's;
 * 5. the published `lib/client.js` RUNS: it is loaded through the shell's module-loader
 *    contract, applied to a stub client context, and must fill the three seats this
 *    plugin exists to fill (`conversation.session.header.utilities`,
 *    `sidebar.footer.action`, `settings.section`).
 *
 * Usage:
 *   node scripts/verify-release.mjs [version] [--expect-git-head <sha>] [--timeout-ms <ms>]
 *                                   [--registry <url>] [--keep] [--allow-no-provenance]
 *
 * `version` accepts `1.2.3` or `v1.2.3`, and defaults to the registry's `latest` tag.
 * Exit code is 0 only when every check passed; the summary says what failed and why.
 * `--allow-no-provenance` turns a missing attestation into a stated SKIP, for auditing a
 * release published by the manual fallback in PUBLISH.md — never a silent pass.
 *
 * @module dsh-shortcut/scripts/verify-release
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// The repository root, which is this file's parent directory. Under vitest
// `import.meta.url` is not a usable file URL — it is whatever the runner substituted —
// so the runner's cwd, the repository root every spec resolves paths from, is the fallback.
function repositoryRoot() {
  try {
    return dirname(fileURLToPath(new URL('.', import.meta.url)))
  } catch {
    return process.cwd()
  }
}

const REPO = repositoryRoot()
const MANIFEST = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))

/** What `files` in `package.json` promises, plus what npm always includes. */
const REQUIRED_FILES = [
  'package.json',
  'README.md',
  'LICENSE',
  'cordis.patch.yml',
  'lib/index.js',
  'lib/client.js',
  'lib/types/index.d.ts',
  'lib/types/client/index.d.ts',
]

/** The seats the published browser bundle must fill. */
const EXPECTED_SEATS = [
  'conversation.session.header.utilities',
  'sidebar.footer.action',
  'settings.section',
]

/** The smallest host/client bundle worth calling a bundle (a stub is far smaller). */
const MIN_HOST_BUNDLE_BYTES = 1_000
const MIN_CLIENT_BUNDLE_BYTES = 10_000

const failures = []
const skipped = []

/**
 * Record one check's outcome and print it.
 * @param {string} what - the check's description.
 * @param {boolean} pass - whether it held.
 * @param {string} detail - what was measured.
 * @returns {boolean} `pass`, so a caller can stop on a broken precondition.
 */
function check(what, pass, detail) {
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${what}${detail === '' ? '' : ` — ${detail}`}`)
  if (!pass) failures.push(what)
  return pass
}

/** Read one URL as JSON, or a status when it is not there. */
async function fetchJson(url) {
  const response = await fetch(url, { headers: { 'cache-control': 'no-cache' } })
  if (!response.ok) return { status: response.status }
  return { status: response.status, body: await response.json() }
}

/** The default pause between two polls of the registry. */
function defaultSleep(ms) {
  return new Promise((resolvePromise) => { setTimeout(resolvePromise, ms) })
}

/**
 * Wait until the registry serves one version, and return its manifest.
 *
 * A publish is not instantly readable: the version arrives after replication, and the
 * packument can lag behind the version document. Polling the VERSION endpoint is
 * deliberate — it is the smallest document that cannot be satisfied by a stale packument.
 * @param {string} name - the package name.
 * @param {string} version - the version to wait for.
 * @param {object} [options] - injection points, all optional.
 * @param {string} [options.registry] - the registry base URL.
 * @param {number} [options.timeoutMs] - how long to keep asking. Defaults to ten minutes.
 * @param {number} [options.intervalMs] - pause between attempts. Defaults to five seconds.
 * @param {(url: string) => Promise<{ status: number, body?: unknown }>} [options.fetchJson] - the registry read.
 * @param {(ms: number) => Promise<void>} [options.sleep] - the pause.
 * @param {() => number} [options.now] - the clock.
 * @returns {Promise<Record<string, unknown> | undefined>} the manifest, or undefined when the budget ran out.
 */
export async function waitForVersion(name, version, options = {}) {
  const {
    registry = 'https://registry.npmjs.org',
    timeoutMs = 600_000,
    intervalMs = 5_000,
    fetchJson: read = fetchJson,
    sleep = defaultSleep,
    now = Date.now,
  } = options
  const base = registry.replace(/\/+$/u, '')
  const url = `${base}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`
  const deadline = now() + timeoutMs
  let last = 'no answer yet'
  for (;;) {
    const answer = await read(url)
    if (answer.body !== undefined) return answer.body
    last = `HTTP ${String(answer.status)}`
    if (now() >= deadline) break
    await sleep(intervalMs)
  }
  console.log(`       (waited ${String(Math.round(timeoutMs / 1000))}s; last answer ${last})`)
  return undefined
}

/**
 * The shell's module-loader stand-in.
 *
 * The published bundle is browser CJS: it calls `window.__ModuleLoader__.load(entry)`
 * and later `entry.factory(require)`. Both are reproduced here, with a `require` that
 * answers the platform modules the shell's frozen table would answer and loads real
 * React from the invoking checkout.
 * @returns {{ window: unknown, require: (id: string) => unknown, loaded: unknown[] }} the sandbox.
 */
function moduleLoaderSandbox() {
  const requireFromRepo = createRequire(join(REPO, 'package.json'))
  /** A stand-in module/component that tolerates any property access. */
  const stub = (extra = {}) => new Proxy({ __esModule: true, ...extra }, {
    get(target, property, receiver) {
      if (property === '__esModule') return true
      if (property === 'default') return receiver
      if (property === 'then') return undefined
      if (Reflect.has(target, property)) return Reflect.get(target, property, receiver)
      return () => undefined
    },
  })
  const load = (id) => {
    if (id === '@deepseek-ai/dsh-client-ui-primitives') {
      return stub({
        IconEllipsisOutlineRegular: () => null,
        Menu: () => null,
      })
    }
    if (id === 'react' || id === 'react/jsx-runtime') return requireFromRepo(id)
    return stub()
  }
  const loaded = []
  return {
    window: { __ModuleLoader__: { load: (entry) => { loaded.push(entry) } } },
    require: load,
    loaded,
  }
}

/**
 * Execute one built client bundle and report what it fills when applied.
 *
 * `attachBubbleCapture` and the footer style injection both return early without a
 * `document`, so this runs headless. The effect callbacks are collected and disposed
 * afterwards so the catalog's `setInterval` does not keep the process alive.
 * @param {string} bundlePath - the extracted `lib/client.js`.
 * @returns {{ name: string, inject: string[], seats: string[], registrations: Array<{ options: Record<string, unknown>, component: unknown }> }} what it registered.
 */
function runPublishedClientBundle(bundlePath) {
  const code = readFileSync(bundlePath, 'utf8')
  const sandbox = moduleLoaderSandbox()
  const moduleShim = { exports: {} }
  const run = new Function('window', 'module', 'exports', 'require', code)
  run(sandbox.window, moduleShim, moduleShim.exports, sandbox.require)
  if (sandbox.loaded.length !== 1) {
    throw new Error(`the bundle handed the loader ${String(sandbox.loaded.length)} entries, not one`)
  }
  const entry = sandbox.loaded[0]
  const plugin = entry.factory(sandbox.require)

  const seats = []
  const registrations = []
  const disposers = []
  const rpc = { call: async () => ({ ok: false, error: { code: 'internal', message: 'stub' } }) }
  const ctx = {
    slots: {
      inject: (name, callback) => { seats.push(name); return callback() },
      register: (options, component) => { registrations.push({ options, component }); return () => {} },
    },
    locale: {
      register: () => () => {},
      bind: () => (key) => key,
    },
    connection: { rpc },
    get: (name) => (name === 'connection' ? { rpc } : undefined),
    effect: (callback) => {
      const disposer = callback()
      if (typeof disposer === 'function') disposers.push(disposer)
    },
    on: () => () => {},
    logger: { info() {}, warn() {}, error() {} },
  }
  try {
    plugin.apply(ctx)
  } finally {
    for (const dispose of disposers.reverse()) {
      try { dispose() } catch { /* a stub teardown must not mask the result */ }
    }
  }
  return {
    name: String(plugin.name),
    inject: Array.isArray(plugin.inject) ? plugin.inject.map(String) : [],
    seats,
    registrations,
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const flags = new Map()
  const positional = []
  // Flags that take no value. Without this set a `--flag` swallows the argument after it.
  const BOOLEAN_FLAGS = new Set(['keep', 'allow-no-provenance'])
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument.startsWith('--')) {
      const key = argument.slice(2)
      if (BOOLEAN_FLAGS.has(key)) { flags.set(key, 'true'); continue }
      flags.set(key, argv[index + 1] ?? '')
      index += 1
      continue
    }
    positional.push(argument)
  }

  const name = flags.get('package') ?? MANIFEST.name
  const version = (positional[0] ?? 'latest').replace(/^v/u, '')
  const expectedGitHead = flags.get('expect-git-head')
  const registry = (flags.get('registry') ?? MANIFEST.publishConfig?.registry ?? 'https://registry.npmjs.org').replace(/\/+$/u, '')
  const timeoutMs = Number(flags.get('timeout-ms') ?? '600000')

  console.log(`verify-release: ${name}@${version}${expectedGitHead === undefined ? '' : ` (expected commit ${expectedGitHead.slice(0, 8)})`}`)

  const manifest = await waitForVersion(name, version, { registry, timeoutMs })
  const served = manifest === undefined ? `nothing at ${name}@${version}` : `${name}@${String(manifest.version)}`
  if (!check('the registry serves the version', manifest !== undefined, served)) return report()
  const resolvedVersion = String(manifest.version)

  check('the record is the version asked for', resolvedVersion === version, resolvedVersion)
  if (expectedGitHead !== undefined) {
    check('the record was built from the expected commit', manifest.gitHead === expectedGitHead,
      `gitHead ${String(manifest.gitHead)}`)
  } else {
    skipped.push('gitHead (no --expect-git-head given)')
  }
  const provenance = manifest.dist?.attestations?.provenance
  if (provenance === undefined && flags.get('allow-no-provenance') === 'true') {
    skipped.push('provenance (--allow-no-provenance: a hand-published release has none)')
  } else {
    check('the record carries a provenance attestation', provenance !== undefined,
      provenance === undefined ? 'no dist.attestations.provenance' : String(provenance.predicateType))
  }

  // The tarball, downloaded and extracted: everything below reads these bytes.
  const workdir = mkdtempSync(join(tmpdir(), 'dsh-shortcut-verify-'))
  try {
    const tarballUrl = manifest.dist?.tarball
    const tarball = join(workdir, 'package.tgz')
    let downloaded = false
    if (typeof tarballUrl === 'string') {
      const response = await fetch(tarballUrl, { headers: { 'cache-control': 'no-cache' } })
      if (response.ok) {
        writeFileSync(tarball, Buffer.from(await response.arrayBuffer()))
        downloaded = true
      }
    }
    check('the registry\'s tarball downloads', downloaded,
      typeof tarballUrl === 'string' ? tarballUrl.split('/').pop() ?? tarballUrl : 'the record names no dist.tarball')
    if (!downloaded) return report()

    const integrity = manifest.dist?.integrity
    if (typeof integrity === 'string' && integrity.startsWith('sha512-')) {
      const digest = `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`
      check('the tarball is the digest the registry declares', digest === integrity, integrity.slice(0, 28) + '…')
    } else {
      skipped.push('tarball integrity (the record declares none)')
    }

    execFileSync('tar', ['-xzf', tarball, '-C', workdir])
    const packageDir = join(workdir, 'package')

    const shipped = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
    check('the tarball\'s own manifest is the version asked for', shipped.version === resolvedVersion, String(shipped.version))
    check('the tarball\'s own manifest is this package', shipped.name === name, String(shipped.name))
    check('the tarball\'s manifest names the same entry points', shipped.main === MANIFEST.main
      && shipped.exports?.['./client']?.default === MANIFEST.exports?.['./client']?.default
      && shipped.dsh?.bundle?.patch === MANIFEST.dsh?.bundle?.patch,
    `${String(shipped.main)} / ${String(shipped.exports?.['./client']?.default)} / ${String(shipped.dsh?.bundle?.patch)}`)
    check('the tarball\'s manifest carries the same client inject list',
      JSON.stringify(shipped.dsh?.client?.inject) === JSON.stringify(MANIFEST.dsh?.client?.inject),
      `${String(shipped.dsh?.client?.inject?.length ?? 0)} entries`)
    check('the tarball\'s manifest ships the same file list',
      JSON.stringify(shipped.files) === JSON.stringify(MANIFEST.files),
      `${String(shipped.files?.length ?? 0)} entries`)

    const missing = REQUIRED_FILES.filter((file) => !existsSync(join(packageDir, file)))
    check('every promised file is in the tarball', missing.length === 0,
      missing.length === 0 ? `${String(REQUIRED_FILES.length)} files` : `missing ${missing.join(', ')}`)

    const sizeOf = (relative) => existsSync(join(packageDir, relative)) ? statSync(join(packageDir, relative)).size : -1
    const hostBytes = sizeOf('lib/index.js')
    check('the host bundle is a real bundle', hostBytes > MIN_HOST_BUNDLE_BYTES, `${String(hostBytes)} bytes`)
    const clientBytes = sizeOf('lib/client.js')
    check('the client bundle is a real bundle', clientBytes > MIN_CLIENT_BUNDLE_BYTES, `${String(clientBytes)} bytes`)
    check('the client bundle asks the shell for its primitives',
      readFileSync(join(packageDir, 'lib/client.js'), 'utf8').includes('@deepseek-ai/dsh-client-ui-primitives'),
      'dsh-client-ui-primitives')

    // The one check that runs the artifact. React is a peer this package does not ship,
    // so when the invoking checkout cannot provide it the check is SKIPPED and said so —
    // a skip is reported, never silently counted as a pass.
    let reactAvailable = true
    try {
      createRequire(join(REPO, 'package.json'))('react')
    } catch {
      reactAvailable = false
    }
    if (!reactAvailable) {
      skipped.push('running the published client bundle (React is not resolvable from the invoking checkout)')
    } else {
      try {
        const ran = runPublishedClientBundle(join(packageDir, 'lib/client.js'))
        check('the published client bundle keeps its plugin name', ran.name === 'ui-shortcut', ran.name)
        check('the published client bundle declares its inject list',
          ['slots', 'locale', 'connection'].every((service) => ran.inject.includes(service)),
          ran.inject.join(', '))
        check('the published client bundle applies to a client context',
          EXPECTED_SEATS.every((seat) => ran.seats.includes(seat)),
          ran.seats.join(', '))
        check('the published client bundle fills three seats',
          ran.registrations.length === EXPECTED_SEATS.length
          && EXPECTED_SEATS.every((seat) => ran.registrations.some((entry) => entry.options?.name === seat)),
          `${String(ran.registrations.length)} registrations`)
        check('every filled seat has a component',
          ran.registrations.every((entry) => typeof entry.component === 'function'),
          `${String(ran.registrations.filter((entry) => typeof entry.component !== 'function').length)} without`)
      } catch (error) {
        check('the published client bundle runs', false, error instanceof Error ? error.message : String(error))
      }
    }
  } finally {
    // Only ever remove the directory this script created, and prove it first: the bug
    // this guard exists against is a cleanup that resolves to the real user profile.
    const resolvedWork = resolve(workdir)
    const tempRoot = resolve(tmpdir()) + sep
    if (!resolvedWork.startsWith(tempRoot)) {
      throw new Error(`refusing to remove a workdir outside ${tempRoot}: ${resolvedWork}`)
    }
    if (flags.get('keep') === 'true') console.log(`       (kept ${workdir})`)
    else rmSync(workdir, { recursive: true, force: true })
  }
  report()
}

/** Print the summary and set the exit code. */
function report() {
  if (skipped.length > 0) console.log(`skipped: ${skipped.join('; ')}`)
  if (failures.length === 0) {
    console.log('verify-release: PASS')
    return
  }
  console.log(`verify-release: FAIL — ${failures.join('; ')}`)
  process.exitCode = 1
}

// Run only when this file IS the program. The waiting loop above is exported so a test
// can drive it with a fake registry, and importing this module must not start a check.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
