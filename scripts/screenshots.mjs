/**
 * Documentation screenshots for both READMEs.
 *
 * Boots one throwaway `dsh web` per language with a realistic-looking fixture
 * (a named workspace, a few plausible sessions, a handful of saved shortcuts)
 * and writes the two cropped images the READMEs use:
 *
 *   shortcut-dialog*.png  the add-shortcut dialog with its target tree
 *   shortcut-menu*.png    the sidebar shortcut row with its menu open
 *
 * Everything is cropped to the control under discussion — the README never
 * shows the whole shell. Deliberately separate from the E2E suite: that suite
 * asserts behaviour, this script only regenerates the documentation images.
 *
 * Usage:
 *   $env:DSH_BIN = '...\@deepseek-ai\dsh\lib\bin.js'
 *   node scripts/screenshots.mjs
 */
import { chromium } from '@playwright/test'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { bootstrapHome, makeFixture, resolveDsh, startHost, stopHost } from '../e2e/helpers/host.ts'
import { dismissNotices, newGuiPage } from '../e2e/helpers/gui.ts'

const step = message => { console.log(`[screenshots] ${message}`) }

/** Realistic fixture content per language (localized UI, one named workspace). */
const LOCALES = [
  {
    locale: 'zh',
    suffix: '',
    workspace: 'web-console',
    sessions: [
      '修复登录页的重定向循环，并补一个回归测试',
      '让计费回调的处理保持幂等',
      '升级前端构建流水线到新的打包器',
    ],
    shortcuts: [
      '修复登录重定向',
      '计费回调幂等',
      '升级构建流水线',
    ],
    dialog: {
      name: '修复登录重定向',
      text: '请检查 OAuth 回调里 state 的校验顺序，并补一个覆盖该路径的回归测试。',
    },
  },
  {
    locale: 'en',
    suffix: '.en',
    workspace: 'web-console',
    sessions: [
      'Fix the login redirect loop and add a regression test',
      'Make the billing webhook idempotent',
      'Upgrade the frontend build pipeline',
    ],
    shortcuts: [
      'Fix login redirect',
      'Idempotent billing webhook',
      'Upgrade the build pipeline',
    ],
    dialog: {
      name: 'Fix login redirect',
      text: 'Please review the state validation order in the OAuth callback and add a regression test for that path.',
    },
  },
]

const dsh = resolveDsh()
if (dsh === undefined) throw new Error('no dsh found; set DSH_BIN to .../@deepseek-ai/dsh/lib/bin.js')
mkdirSync(join('docs', 'images'), { recursive: true })

/**
 * Press New session, let the shell bind the blank session, then type with real keys.
 * @param {import('@playwright/test').Page} page
 * @param {string} text
 */
async function newSessionWith(page, text) {
  await dismissNotices(page)
  await page.getByRole('button', { name: /New session|新建会话/ }).first().click()
  await page.waitForFunction(() => {
    return [...document.querySelectorAll('[contenteditable="true"], [data-composer-input]')]
      .some(element => element.getBoundingClientRect().width > 0)
  }, { timeout: 20_000 })
  await page.waitForTimeout(400)
  await page.evaluate(() => {
    const editor = [...document.querySelectorAll('[contenteditable="true"]')]
      .find(element => element.getBoundingClientRect().width > 0)
    editor?.focus()
  })
  const accepted = page.waitForResponse(
    response => response.url().includes('/api/session/prompt') && response.request().method() === 'POST',
    { timeout: 30_000 },
  )
  await page.keyboard.type(text, { delay: 8 })
  await page.keyboard.press('Enter')
  await accepted
  await page.waitForTimeout(500)
}

/**
 * Seed a few saved shortcuts so the menu has realistic rows before the client
 * mounts; the records never deliver, they only render.
 * @param {string} home - the throwaway DSH_HOME.
 * @param {readonly string[]} names - shortcut names to seed.
 */
function seedShortcuts(home, names) {
  const dir = join(home, 'shortcut')
  mkdirSync(dir, { recursive: true })
  const now = Date.now()
  const entries = names.map((name, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    name,
    sessionId: 'seeded-session',
    text: name,
    navigate: true,
    target: { kind: 'main' },
    createdAt: now - index * 60_000,
    updatedAt: now - index * 60_000,
  }))
  writeFileSync(join(dir, 'entries.json'), `${JSON.stringify({ version: 2, entries }, null, 2)}\n`)
}

/**
 * Screenshot one element (plus its shadow), cropped — never the whole shell.
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} locator
 * @param {string} path
 * @param {number} margin
 */
async function cropShot(page, locator, path, margin = 16) {
  const box = await locator.boundingBox()
  if (box === null) throw new Error(`cannot crop ${path}: element not laid out`)
  await page.screenshot({
    path,
    clip: {
      x: Math.max(0, box.x - margin),
      y: Math.max(0, box.y - margin),
      width: box.width + margin * 2,
      height: box.height + margin * 2,
    },
  })
}

/**
 * Capture the two README screenshots for one language.
 * @param {typeof LOCALES[number]} data
 */
async function captureLocale(data) {
  const fixture = makeFixture(`shots-${data.locale}`, data.locale)
  // Give the workspace a real name; the sidebar shows its directory basename.
  const namedWorkspace = join(fixture.home, data.workspace)
  renameSync(fixture.workspace, namedWorkspace)
  fixture.workspace = namedWorkspace

  let host
  let browser
  try {
    step(`${data.locale}: fixture ${fixture.home}`)
    await bootstrapHome(dsh, fixture)
    writeFileSync(join(fixture.home, 'settings.yaml'), `locale:\n  preference: ${data.locale}\n`)
    seedShortcuts(fixture.home, data.shortcuts)
    host = await startHost(dsh, fixture.home, fixture.workspace, fixture.logFile)
    browser = await chromium.launch()
    const page = await newGuiPage(browser)
    await page.goto(host.url, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('text=/工作区|Workspaces/', { timeout: 60_000 })
    await dismissNotices(page)
    await page.waitForSelector('[data-dsh-shortcut-footer]', { timeout: 30_000 })
    step(`${data.locale}: shell ready`)

    for (const session of data.sessions) await newSessionWith(page, session)
    step(`${data.locale}: sessions created`)

    // The sidebar row and its open menu.
    await page.locator('[data-dsh-shortcut-trigger]').click()
    const menu = page.getByRole('menu')
    await menu.waitFor({ state: 'visible', timeout: 15_000 })
    await page.waitForTimeout(300)
    const triggerBox = await page.locator('[data-dsh-shortcut-trigger]').boundingBox()
    const menuBox = await menu.boundingBox()
    if (triggerBox !== null && menuBox !== null) {
      await page.screenshot({
        path: join('docs', 'images', `shortcut-menu${data.suffix}.png`),
        clip: {
          x: 0,
          y: Math.max(0, menuBox.y - 12),
          width: menuBox.x + menuBox.width + 12,
          height: Math.max(triggerBox.y + triggerBox.height, menuBox.y + menuBox.height) - menuBox.y + 24,
        },
      })
    }
    await page.keyboard.press('Escape')
    step(`${data.locale}: menu shot`)

    // The add-shortcut dialog, opened from Settings, with the target tree.
    await page.locator('[data-slot="sidebar.settings"] button').first().click()
    const tab = page.locator('button[class*="navCell"]').filter({ hasText: /Shortcuts|快捷方式/ }).first()
    await tab.waitFor({ state: 'visible', timeout: 20_000 })
    await tab.click()
    await page.locator('[data-dsh-shortcut-settings-add]').click()
    await page.locator('[data-dsh-shortcut-name]').waitFor({ state: 'visible', timeout: 15_000 })
    const picker = page.locator('[data-dsh-shortcut-picker]')
    await picker.locator('[data-dsh-shortcut-tree-workspace]').first().click()
    const firstSession = picker.locator('[data-dsh-shortcut-tree-session]').first()
    await firstSession.waitFor({ state: 'visible', timeout: 15_000 })
    await firstSession.click()
    await page.locator('[data-dsh-shortcut-name]').fill(data.dialog.name)
    await page.locator('[data-dsh-shortcut-text]').fill(data.dialog.text)
    await page.waitForTimeout(300)
    // Crop the shortcut modal itself (the Settings page is also a role="dialog",
    // so pick the one that owns our name field) with 20px of breathing room.
    const shortcutDialog = page.locator('[role="dialog"]').filter({ has: page.locator('[data-dsh-shortcut-name]') }).first()
    const dialogBox = await shortcutDialog.boundingBox()
    if (dialogBox === null) throw new Error('cannot crop the shortcut dialog: not laid out')
    const margin = 20
    await page.screenshot({
      path: join('docs', 'images', `shortcut-dialog${data.suffix}.png`),
      clip: {
        x: Math.max(0, dialogBox.x - margin),
        y: Math.max(0, dialogBox.y - margin),
        width: dialogBox.width + margin * 2,
        height: dialogBox.height + margin * 2,
      },
    })
    step(`${data.locale}: dialog shot`)
  } finally {
    if (browser !== undefined) await browser.close().catch(() => {})
    if (host !== undefined) await stopHost(host.proc)
    fixture.cleanup()
  }
}

const watchdog = setTimeout(() => { console.error('[screenshots] timed out'); process.exit(2) }, 300_000)
try {
  for (const data of LOCALES) await captureLocale(data)
} finally {
  clearTimeout(watchdog)
}
step('done')
