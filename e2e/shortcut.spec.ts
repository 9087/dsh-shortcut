/**
 * Real-browser E2E: the whole dsh-shortcut story, in the actual DSH Web GUI
 * against a throwaway `DSH_HOME`.
 *
 * The suite boots a private `dsh web` (never the user's 3080 process), links
 * this checkout into that home's web profile, and drives Chromium:
 *
 *   1. the plugin activates and its sidebar trigger sits directly above Settings;
 *   2. every durable user bubble carries "add to shortcut" immediately LEFT of
 *      the copy button, and the capture dialog seeds itself from that bubble;
 *   3. a captured shortcut delivers its text into the ORIGINAL session while the
 *      reader stays in another one (the target's transcript gains the message;
 *      the current session's does not, and the page never navigated);
 *   4. the Settings page can edit, add and delete records;
 *   5. the records survive a host restart.
 *
 * The plugin's `lib/` must already be built (`pnpm run e2e` does not build).
 * Labels are asserted in both languages: the GUI's locale is the host's, not
 * the test's, and a run must not depend on which one the fixture came up in.
 */

import { chromium, expect, test, type Browser, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  bootstrapHome, describeHome, makeFixture, resolveDsh, startHost, stopHost, tail,
  type Fixture, type Host,
} from './helpers/host.ts'
import { beginSession, dismissNotices, newGuiPage } from './helpers/gui.ts'

/** The text captured from a bubble and later delivered by the menu. */
const CAPTURE_TEXT = '重启服务：请重启 dev 服务'
/** The second session's own message; used to prove the view did not switch. */
const OTHER_TEXT = '这是第二个会话的消息'
/** The name typed into the capture dialog. */
const SHORTCUT_NAME = '重启服务'
/** The renamed record after the Settings edit. */
const RENAMED = '重启服务（已改名）'
/** A record created from the Settings page by hand. */
const MANUAL_NAME = '手动添加'
/** The injected button's accessible name, in either UI language. */
const ADD_LABEL = /加入快捷方式|Add to shortcuts/
/** A delivery banner, in either UI language. */
const SENT_BANNER = /已发送到|Sent to/
/** The Settings tab label, in either UI language. */
const TAB_LABEL = /快捷方式|Shortcuts/

let fixture: Fixture
let browser: Browser
let page: Page
let host: Host
let sessionA: string
let sessionB: string

/**
 * Capture one documentation screenshot, when `E2E_SCREENSHOTS=1` asked for it.
 * The suite's assertions are the test; these images are the hand-off artefact.
 * @param name - file name under `docs/images`.
 * @param options - optional clip rectangle in page coordinates.
 */
async function shoot(name: string, options: { clip?: { x: number; y: number; width: number; height: number } } = {}): Promise<void> {
  if (process.env.E2E_SCREENSHOTS !== '1') return
  const directory = join('docs', 'images')
  mkdirSync(directory, { recursive: true })
  await page.screenshot({
    path: join(directory, name),
    ...(options.clip === undefined ? { fullPage: false } : { clip: options.clip }),
  })
}

test.describe.configure({ mode: 'serial' })

test.describe('dsh-shortcut (real Chromium)', () => {
  test.beforeAll(async ({ browser: launched }) => {
    const dsh = resolveDsh()
    if (dsh === undefined) {
      test.skip(true, 'no dsh executable found: set DSH_BIN to .../@deepseek-ai/dsh/lib/bin.js')
      return
    }
    browser = launched
    fixture = makeFixture('shortcut')
    await bootstrapHome(dsh, fixture)
    // The bootstrap's own first boot may persist its defaults into the home;
    // pin the language again before the measured boot so the labels this suite
    // asserts are the ones it wrote (both languages are still matched below).
    writeFileSync(join(fixture.home, 'settings.yaml'), 'locale:\n  preference: zh\n')
    host = await startHost(dsh, fixture.home, fixture.workspace, fixture.logFile)
    page = await newGuiPage(browser)
    page.on('pageerror', error => { console.log('[pageerror]', error.message) })
    await page.goto(host.url, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('text=/工作区|Workspaces/', { timeout: 60_000 })
    await dismissNotices(page)

    // A boot that loses the plugin is only a warning, not an exit: the plugin's
    // own DOM is the real proof that it activated, and the log is checked so a
    // "silently inactive" registration cannot pass as a green run.
    await expect(page.locator('[data-dsh-shortcut-footer]')).toBeVisible({ timeout: 30_000 })
    const log = readFileSync(host.logFile, 'utf8')
    expect(log, `boot log:\n${tail(host.logFile)}`).not.toContain('startup failed:')
    expect(log, `boot log:\n${tail(host.logFile)}`).not.toContain('dsh-shortcut (dsh-shortcut)')

    const workspaceTitle = fixture.workspace.split(/[\\/]/).pop() ?? 'workspace'
    sessionA = await beginSession(page, workspaceTitle, fixture.home, CAPTURE_TEXT)
  })

  test.afterAll(async () => {
    if (page !== undefined) await page.close().catch(() => {})
    if (host !== undefined) await stopHost(host.proc)
    fixture?.cleanup()
  })

  test('1. the sidebar trigger sits above Settings, and the bubble button left of copy', async () => {
    const trigger = page.locator('[data-dsh-shortcut-trigger]')
    await expect(trigger).toBeVisible()
    const settingsTrigger = page.locator('[data-slot="sidebar.settings"] button').first()
    await expect(settingsTrigger).toBeVisible()
    const triggerBox = await trigger.boundingBox()
    const settingsBox = await settingsTrigger.boundingBox()
    expect(triggerBox).not.toBeNull()
    expect(settingsBox).not.toBeNull()
    // Our row is above the Settings row, in the same sidebar foot.
    expect(triggerBox!.y).toBeLessThan(settingsBox!.y)
    expect(settingsBox!.y - (triggerBox!.y + triggerBox!.height)).toBeLessThan(24)

    const flow = page.locator('[data-chat-flow-kind="user"]').first()
    await expect(flow).toBeVisible({ timeout: 30_000 })
    await flow.hover()
    const add = flow.locator('[data-dsh-shortcut-add]')
    await expect(add).toHaveCount(1)
    await expect(add).toHaveAttribute('aria-label', ADD_LABEL)
    const copy = flow.locator('[data-clock="start"] button:not([data-dsh-shortcut-add])').first()
    await expect(copy).toHaveCount(1)
    // Immediately left of the copy control: the previous sibling IS the copy button.
    const placement = await add.evaluate((button) => {
      const row = button.parentElement
      const copyButton = row?.querySelector('button:not([data-dsh-shortcut-add])') ?? null
      const mine = button.getBoundingClientRect()
      const copyBox = copyButton?.getBoundingClientRect() ?? null
      return {
        nextIsCopy: button.nextElementSibling === copyButton,
        leftOfCopy: copyBox === null ? false : mine.right <= copyBox.left + 1,
      }
    })
    expect(placement).toEqual({ nextIsCopy: true, leftOfCopy: true })

    // Hand-off screenshots: the bubble's action row and the sidebar foot.
    const flowBox = await flow.boundingBox()
    if (flowBox !== null) {
      await shoot('shortcut-bubble.png', {
        clip: { x: Math.max(0, flowBox.x - 16), y: Math.max(0, flowBox.y - 16), width: flowBox.width + 140, height: flowBox.height + 56 },
      })
    }
    const footerBox = await page.locator('[data-slot="sidebar.footer.action"]').boundingBox()
    const settingsRowBox = await settingsTrigger.boundingBox()
    if (footerBox !== null && settingsRowBox !== null) {
      await shoot('shortcut-sidebar.png', {
        clip: {
          x: 0,
          y: Math.max(0, footerBox.y - 10),
          width: 300,
          height: Math.min(900, settingsRowBox.y + settingsRowBox.height - footerBox.y + 20),
        },
      })
    }
  })

  test('2. the bubble button opens the dialog seeded from that bubble, and capture stores the record', async () => {
    const flow = page.locator('[data-chat-flow-kind="user"]').first()
    await flow.hover()
    await flow.locator('[data-dsh-shortcut-add]').click()

    const name = page.locator('[data-dsh-shortcut-name]')
    const text = page.locator('[data-dsh-shortcut-text]')
    const confirm = page.locator('[data-dsh-shortcut-confirm]')
    await expect(name).toBeVisible()
    await expect(name).toHaveValue('')
    await expect(text).toHaveValue(CAPTURE_TEXT)
    await expect(confirm).toBeDisabled()
    const dialog = page.locator('[role="dialog"][aria-modal="true"]')
    await expect(dialog).toBeVisible()
    await page.waitForTimeout(250)
    await shoot('shortcut-dialog.png')

    await name.fill(SHORTCUT_NAME)
    await expect(confirm).toBeEnabled()
    await confirm.click()
    await expect(name).toBeHidden()
    await expect(page.getByText(new RegExp(`[「"]${SHORTCUT_NAME}[」"]`)).first()).toBeVisible({ timeout: 10_000 })

    await expect.poll(() => storedEntries().length, { timeout: 10_000 }).toBe(1)
    const [entry] = storedEntries()
    expect(entry).toMatchObject({ name: SHORTCUT_NAME, sessionId: sessionA, text: CAPTURE_TEXT })
  })

  test('3. the menu delivers into the original session without switching the view', async () => {
    const workspaceTitle = fixture.workspace.split(/[\\/]/).pop() ?? 'workspace'
    sessionB = await beginSession(page, workspaceTitle, fixture.home, OTHER_TEXT)
    expect(sessionB).not.toBe(sessionA)
    // The shell is showing B when its own header publishes B's id.
    await expect(page.locator(`[data-dsh-shortcut-session="${sessionB}"]`)).toBeAttached({ timeout: 30_000 })

    await page.locator('[data-dsh-shortcut-trigger]').click()
    const item = page.getByRole('menuitem', { name: SHORTCUT_NAME })
    await expect(item).toBeVisible()
    await page.waitForTimeout(250)
    await shoot('shortcut-menu.png')
    await item.click()
    await expect(page.getByText(SENT_BANNER)).toBeVisible({ timeout: 10_000 })

    // The press did NOT navigate: the page still shows the second session.
    await expect(page.locator(`[data-dsh-shortcut-session="${sessionB}"]`)).toBeAttached()
    await expect(page.locator(`[data-dsh-shortcut-session="${sessionA}"]`)).toHaveCount(0)

    // The ORIGINAL session now holds a second copy of the delivered message.
    // (The sidebar title is that session's first message.)
    const originalRow = page.getByRole('treeitem').filter({ hasText: '请重启 dev 服务' }).first()
    await expect(originalRow).toBeVisible({ timeout: 15_000 })
    await originalRow.click()
    await expect(page.locator(`[data-dsh-shortcut-session="${sessionA}"]`)).toBeAttached({ timeout: 15_000 })
    await expect(page.locator('[data-chat-flow-kind="user"]')).toHaveCount(2, { timeout: 15_000 })

    // And the session the reader was in received nothing.
    const secondRow = page.getByRole('treeitem').filter({ hasText: '第二个会话的消息' }).first()
    await secondRow.click()
    await expect(page.locator(`[data-dsh-shortcut-session="${sessionB}"]`)).toBeAttached({ timeout: 15_000 })
    await expect(page.locator('[data-chat-flow-kind="user"]')).toHaveCount(1)
  })

  test('4. the Settings page edits, adds and deletes records', async () => {
    await page.locator('[data-slot="sidebar.settings"] button').first().click()
    // The shell's own nav list; the class local name is stable across builds.
    const tab = page.locator('button[class*="navCell"]').filter({ hasText: TAB_LABEL }).first()
    await expect(tab).toBeVisible({ timeout: 15_000 })
    await tab.click()
    const row = page.locator('[data-dsh-shortcut-row]').filter({ hasText: SHORTCUT_NAME })
    await expect(row).toBeVisible({ timeout: 15_000 })
    await shoot('shortcut-settings.png')

    // --- edit the name
    await row.locator('[data-dsh-shortcut-edit]').click()
    const name = page.locator('[data-dsh-shortcut-name]')
    await expect(name).toHaveValue(SHORTCUT_NAME)
    await name.fill(RENAMED)
    await page.locator('[data-dsh-shortcut-confirm]').click()
    await expect(page.locator('[data-dsh-shortcut-row]').filter({ hasText: RENAMED })).toBeVisible({ timeout: 10_000 })
    expect(storedEntries().map(entry => entry.name)).toEqual([RENAMED])

    // --- add a record by hand (target picked from the session list)
    await page.locator('[data-dsh-shortcut-settings-add]').click()
    const confirm = page.locator('[data-dsh-shortcut-confirm]')
    await expect(confirm).toBeDisabled()
    await name.fill(MANUAL_NAME)
    await page.locator('[data-dsh-shortcut-session-picker]').click()
    await page.getByRole('menuitem').first().click()
    await page.locator('[data-dsh-shortcut-text]').fill('手动输入的内容')
    await expect(confirm).toBeEnabled()
    await confirm.click()
    await expect(page.locator('[data-dsh-shortcut-row]')).toHaveCount(2, { timeout: 10_000 })

    // --- delete the manual record
    await page.locator('[data-dsh-shortcut-row]').filter({ hasText: MANUAL_NAME })
      .locator('[data-dsh-shortcut-delete]').click()
    await page.locator('[data-dsh-shortcut-delete-confirm]').click()
    await expect(page.locator('[data-dsh-shortcut-row]').filter({ hasText: MANUAL_NAME })).toHaveCount(0, { timeout: 10_000 })
    expect(storedEntries().map(entry => entry.name)).toEqual([RENAMED])
  })

  test('5. records survive a host restart', async () => {
    const dsh = resolveDsh()
    if (dsh === undefined) throw new Error('dsh vanished between tests')
    await page.close()
    await stopHost(host.proc)
    host = await startHost(dsh, fixture.home, fixture.workspace, fixture.logFile)
    page = await newGuiPage(browser)
    await page.goto(host.url, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('text=/工作区|Workspaces/', { timeout: 60_000 })
    await dismissNotices(page)
    await page.locator('[data-dsh-shortcut-trigger]').click()
    await expect(page.getByRole('menuitem', { name: RENAMED })).toBeVisible({ timeout: 20_000 })
    expect(storedEntries().map(entry => entry.name)).toEqual([RENAMED])
  })
})

/** Read the plugin's own store file from the throwaway home. */
function storedEntries(): Array<{ name: string; sessionId: string; text: string }> {
  try {
    const file = join(fixture.home, 'shortcut', 'entries.json')
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { entries?: unknown }
    return Array.isArray(parsed.entries) ? parsed.entries as Array<{ name: string; sessionId: string; text: string }> : []
  } catch {
    return []
  }
}

/** Keep the failure dump useful while the fixture is still around. */
test.afterEach(async () => {
  if (test.info().status === 'failed' && fixture !== undefined) {
    console.log(`[e2e] home: ${fixture.home}\n${describeHome(fixture.home)}`)
  }
})
