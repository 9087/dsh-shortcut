/**
 * Documentation screenshots for both READMEs.
 *
 * Boots one throwaway `dsh web` per language, drives the real GUI through the
 * whole story (capture from a bubble, menu, delivery, Settings, target picker),
 * and writes the six images under `docs/images/`:
 *
 *   shortcut-*.png      Chinese UI, used by README.zh.md
 *   shortcut-*.en.png   English UI, used by README.md
 *
 * Deliberately separate from the E2E suite: that suite asserts behaviour, and
 * its browser occasionally dies mid-run; this script is the reproducible way to
 * regenerate the images after a UI change. The two "new session" presses carry
 * a settle delay so the shell's generated sidebar titles keep the first
 * characters of the seeded message.
 *
 * Usage:
 *   $env:DSH_BIN = '...\@deepseek-ai\dsh\lib\bin.js'
 *   node scripts/screenshots.mjs
 */
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { bootstrapHome, makeFixture, resolveDsh, startHost, stopHost } from '../e2e/helpers/host.ts'
import { dismissNotices, newGuiPage } from '../e2e/helpers/gui.ts'

const step = message => { console.log(`[screenshots] ${message}`) }

/** Per-language fixture data and screenshot suffix. */
const LOCALES = [
  {
    locale: 'zh',
    suffix: '',
    capture: '重启服务：请重启 dev 服务',
    other: '这是第二个会话的消息',
    name: '重启服务',
  },
  {
    locale: 'en',
    suffix: '.en',
    capture: 'Restart the dev service',
    other: 'Deploy the release',
    name: 'Restart service',
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
  await page.waitForTimeout(500)
  await page.evaluate(() => {
    const editor = [...document.querySelectorAll('[contenteditable="true"]')]
      .find(element => element.getBoundingClientRect().width > 0)
    editor?.focus()
  })
  const accepted = page.waitForResponse(
    response => response.url().includes('/api/session/prompt') && response.request().method() === 'POST',
    { timeout: 30_000 },
  )
  await page.keyboard.type(text, { delay: 15 })
  await page.keyboard.press('Enter')
  await accepted
  await page.waitForTimeout(600)
}

/**
 * Capture the five screenshots for one language.
 * @param {typeof LOCALES[number]} data
 */
async function captureLocale(data) {
  const fixture = makeFixture(`shots-${data.locale}`, data.locale)
  let host
  let browser
  try {
    step(`${data.locale}: fixture ${fixture.home}`)
    await bootstrapHome(dsh, fixture)
    writeFileSync(join(fixture.home, 'settings.yaml'), `locale:\n  preference: ${data.locale}\n`)
    host = await startHost(dsh, fixture.home, fixture.workspace, fixture.logFile)
    browser = await chromium.launch()
    const page = await newGuiPage(browser)
    await page.goto(host.url, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('text=/工作区|Workspaces/', { timeout: 60_000 })
    await dismissNotices(page)
    await page.waitForSelector('[data-dsh-shortcut-footer]', { timeout: 30_000 })
    step(`${data.locale}: shell ready`)

    await newSessionWith(page, data.capture)
    const flow = page.locator('[data-chat-flow-kind="user"]').first()
    await flow.waitFor({ state: 'visible', timeout: 30_000 })
    step(`${data.locale}: session A created`)

    // The bubble's action row, hovered so the controls are revealed.
    await flow.hover()
    const flowBox = await flow.boundingBox()
    if (flowBox !== null) {
      await page.screenshot({
        path: join('docs', 'images', `shortcut-bubble${data.suffix}.png`),
        clip: {
          x: Math.max(0, flowBox.x - 16),
          y: Math.max(0, flowBox.y - 8),
          width: flowBox.width + 140,
          height: flowBox.height + 8,
        },
      })
    }

    // The sidebar foot: our row directly above Settings.
    const footerBox = await page.locator('[data-slot="sidebar.footer.action"]').boundingBox()
    const settingsRowBox = await page.locator('[data-slot="sidebar.settings"] button').first().boundingBox()
    if (footerBox !== null && settingsRowBox !== null) {
      await page.screenshot({
        path: join('docs', 'images', `shortcut-sidebar${data.suffix}.png`),
        clip: {
          x: 0,
          y: Math.max(0, footerBox.y - 10),
          width: 300,
          height: Math.min(900, settingsRowBox.y + settingsRowBox.height - footerBox.y + 20),
        },
      })
    }
    step(`${data.locale}: sidebar + bubble shots`)

    // Capture dialog, seeded from that bubble.
    await flow.locator('[data-dsh-shortcut-add]').click()
    const name = page.locator('[data-dsh-shortcut-name]')
    await name.waitFor({ state: 'visible', timeout: 15_000 })
    await page.waitForTimeout(300)
    await page.screenshot({ path: join('docs', 'images', `shortcut-dialog${data.suffix}.png`) })
    await name.fill(data.name)
    await page.locator('[data-dsh-shortcut-confirm]').click()
    await name.waitFor({ state: 'hidden', timeout: 15_000 })
    step(`${data.locale}: capture dialog shot`)

    await newSessionWith(page, data.other)
    step(`${data.locale}: session B created`)

    // The menu, opened above the sidebar-foot row.
    await page.locator('[data-dsh-shortcut-trigger]').click()
    await page.getByRole('menuitem', { name: data.name }).waitFor({ state: 'visible', timeout: 15_000 })
    await page.waitForTimeout(400)
    await page.screenshot({ path: join('docs', 'images', `shortcut-menu${data.suffix}.png`) })
    step(`${data.locale}: menu shot`)

    // "About this menu" (the menu's last item) explains the plugin and management.
    await page.getByRole('menuitem', { name: /关于此菜单|About this menu/ }).click()
    const about = page.locator('[data-dsh-shortcut-about]')
    await about.waitFor({ state: 'visible', timeout: 15_000 })
    await page.waitForTimeout(400)
    await page.screenshot({ path: join('docs', 'images', `shortcut-about${data.suffix}.png`) })
    await page.locator('[data-dsh-shortcut-about-close]').click()
    await about.waitFor({ state: 'hidden', timeout: 10_000 })
    step(`${data.locale}: about shot`)

    // The Settings page.
    await page.locator('[data-slot="sidebar.settings"] button').first().click()
    const tab = page.locator('button[class*="navCell"]').filter({ hasText: /Shortcuts|快捷方式/ }).first()
    await tab.waitFor({ state: 'visible', timeout: 20_000 })
    await tab.click()
    await page.locator('[data-dsh-shortcut-row]').first().waitFor({ state: 'visible', timeout: 20_000 })
    await page.waitForTimeout(500)
    await page.screenshot({ path: join('docs', 'images', `shortcut-settings${data.suffix}.png`) })
    step(`${data.locale}: settings shot`)

    // Narrow layout: the add action becomes a full-width row under the intro.
    await page.setViewportSize({ width: 620, height: 820 })
    await page.waitForTimeout(300)
    await page.screenshot({ path: join('docs', 'images', `shortcut-settings-narrow${data.suffix}.png`) })
    await page.setViewportSize({ width: 1400, height: 900 })
    step(`${data.locale}: narrow settings shot`)

    // The target tree is inline in the dialog (no dropdown to open).
    await page.locator('[data-dsh-shortcut-settings-add]').click()
    await page.locator('[data-dsh-shortcut-name]').waitFor({ state: 'visible', timeout: 15_000 })
    const picker = page.locator('[data-dsh-shortcut-picker]')
    await picker.waitFor({ state: 'visible', timeout: 15_000 })
    // The tree opens with workspaces collapsed; press the first one to expand it.
    await picker.locator('[data-dsh-shortcut-tree-workspace]').first().click()
    const pickerSession = picker.locator('[data-dsh-shortcut-tree-session]').first()
    await pickerSession.waitFor({ state: 'visible', timeout: 15_000 })
    await page.waitForTimeout(500)
    await page.screenshot({ path: join('docs', 'images', `shortcut-picker${data.suffix}.png`) })
    step(`${data.locale}: picker shot`)
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
