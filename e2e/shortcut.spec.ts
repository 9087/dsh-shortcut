/**
 * Real-browser E2E: the whole dsh-shortcut story, in the actual DSH Web GUI
 * against a throwaway `DSH_HOME`.
 *
 * The suite boots a private `dsh web` (never the user's 3080 process), links
 * this checkout into that home's web profile, and drives Chromium:
 *
 *   1. the plugin activates and its sidebar trigger sits in the footer list above Settings;
 *   2. every durable user bubble carries "add to shortcut" immediately LEFT of
 *      the copy button, and the capture dialog seeds itself from that bubble;
 *   3. a captured shortcut delivers its text into the ORIGINAL session and
 *      navigates there by default (the jump switch), while the second session
 *      stays untouched; a record with the switch off delivers without moving;
 *   4. the Settings page can edit (including the jump switch), add and delete
 *      records;
 *   5. the records survive a host restart.
 *
 * The plugin's `lib/` must already be built (`pnpm run e2e` does not build).
 * Labels are asserted in both languages: the GUI's locale is the host's, not
 * the test's, and a run must not depend on which one the fixture came up in.
 * (`E2E_LOCALE=en` selects the English fixture; the README screenshots are
 * produced separately by `scripts/screenshots.mjs` so a doc image can never be
 * lost to a browser that dies mid-suite.)
 */

import { chromium, expect, test, type Browser, type Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  bootstrapHome, describeHome, makeFixture, resolveDsh, startHost, stopHost, tail,
  type Fixture, type Host,
} from './helpers/host.ts'
import { beginSession, dismissNotices, newGuiPage } from './helpers/gui.ts'

/** The fixture's UI language; the assertions accept either one. */
const LOCALE: 'zh' | 'en' = process.env.E2E_LOCALE === 'en' ? 'en' : 'zh'

/** The text captured from a bubble and later delivered by the menu. */
const CAPTURE_TEXT = LOCALE === 'en' ? 'Restart the dev service' : '重启服务：请重启 dev 服务'
/** The second session's own message; used to prove delivery stayed targeted. */
const OTHER_TEXT = LOCALE === 'en' ? 'This is the second session message' : '这是第二个会话的消息'
/** A substring of OTHER_TEXT that identifies that session in the sidebar (short for the same reason). */
const OTHER_PROBE = LOCALE === 'en' ? 'second session' : '第二个会话的消息'
/** The name typed into the capture dialog. */
const SHORTCUT_NAME = LOCALE === 'en' ? 'Restart service' : '重启服务'
/** The renamed record after the Settings edit. */
const RENAMED = LOCALE === 'en' ? 'Restart service (renamed)' : '重启服务（已改名）'
/** A record created from the Settings page by hand. */
const MANUAL_NAME = LOCALE === 'en' ? 'Added manually' : '手动添加'
/** The content of that manual record. */
const MANUAL_TEXT = LOCALE === 'en' ? 'Typed by hand' : '手动输入的内容'
/** The injected button's accessible name, in either UI language. */
const ADD_LABEL = /加入快捷方式|Add to shortcuts/
/** A delivery banner, in either UI language. */
const SENT_BANNER = /已发送到|Sent to/
/** The Settings tab label, in either UI language. */
const TAB_LABEL = /快捷方式|Shortcuts/
/** The menu's last item, in either UI language. */
const ABOUT_ITEM = /关于此菜单|About this menu/
/** The menu's current-session group heading, in either UI language. */
const CURRENT_GROUP = /^(当前会话|Current session)$/
/** The menu's other-sessions group heading, in either UI language. */
const OTHER_GROUP = /^(其他会话|Other sessions)$/
/** The menu's any-session group heading, in either UI language. */
const ANY_GROUP = /^(任意会话|Any session)$/
/** A substring of `CAPTURE_TEXT` that identifies session A in the sidebar (short, so a truncated title still matches). */
const FIRST_PROBE = LOCALE === 'en' ? 'Restart the dev' : '重启服务'
/** A search query the capture dialog's tree must still match (it derives from `CAPTURE_TEXT`). */
const TREE_QUERY = LOCALE === 'en' ? 'Restart' : '重启'

let fixture: Fixture
let browser: Browser
let page: Page
let host: Host
let sessionA: string
let sessionB: string

test.describe.configure({ mode: 'serial' })

test.describe('dsh-shortcut (real Chromium)', () => {
  test.beforeAll(async ({ browser: launched }) => {
    const dsh = resolveDsh()
    if (dsh === undefined) {
      test.skip(true, 'no dsh executable found: set DSH_BIN to .../@deepseek-ai/dsh/lib/bin.js')
      return
    }
    browser = launched
    fixture = makeFixture('shortcut', LOCALE)
    await bootstrapHome(dsh, fixture)
    // The bootstrap's own first boot may persist its defaults into the home;
    // pin the language again before the measured boot so the labels this suite
    // asserts are the ones it wrote (both languages are still matched below).
    writeFileSync(join(fixture.home, 'settings.yaml'), `locale:\n  preference: ${LOCALE}\n`)
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
    // The fixture has no model credentials, so that first turn fails fast. Wait for
    // it to SETTLE before any test sends a shortcut: a message admitted while the
    // session's only turn is still running goes into the agent's queue, and a
    // queued prompt does not reach the durable log at the same moment — which made
    // the delivery assertion below depend on when the first turn happened to end.
    await settleTurn(page)
  })

  test.afterAll(async () => {
    if (page !== undefined) await page.close().catch(() => {})
    if (host !== undefined) await stopHost(host.proc)
    fixture?.cleanup()
  })

  test('1. the sidebar trigger sits in the footer list above Settings, and the bubble button left of copy', async () => {
    const trigger = page.locator('[data-dsh-shortcut-trigger]')
    await expect(trigger).toBeVisible()
    // Geometry is read in ONE pass: the shell draws the sidebar foot after boot,
    // and two lazy locator resolutions can straddle a layout change.
    const geometry = await page.evaluate(() => {
      const rect = (element: Element): { x: number; y: number; width: number; height: number } => {
        const box = element.getBoundingClientRect()
        return { x: box.x, y: box.y, width: box.width, height: box.height }
      }
      const ours = document.querySelector('[data-dsh-shortcut-trigger]')
      const candidates = [...document.querySelectorAll('[data-slot="sidebar.settings"] button')]
      const settings = candidates.find(element => element.getBoundingClientRect().width > 0) ?? candidates[0]
      return {
        ours: ours === null ? null : rect(ours),
        settings: settings === undefined ? null : rect(settings),
        // The slot IS the requirement: the shell draws this action list above its own
        // Settings row, so a row in it is above Settings wherever it lands in the column.
        inFooterSlot: ours !== null && ours.closest('div[data-slot="sidebar.footer.action"]') !== null,
        footerRows: document.querySelectorAll('div[data-slot="sidebar.footer.action"] button').length,
      }
    })
    expect(geometry.ours).not.toBeNull()
    expect(geometry.settings).not.toBeNull()
    // Ours fills the footer column the same way the Settings trigger does (same left edge,
    // same width), so the two read as one stack.
    expect(Math.abs(geometry.ours!.x - geometry.settings!.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(geometry.ours!.width - geometry.settings!.width)).toBeLessThanOrEqual(1)
    // Above Settings — and NOT required to be flush against it: the footer action slot is
    // shared with every other footer plugin, any of which may insert rows between the two.
    // An adjacency assertion here would go red the moment a second plugin is installed.
    expect(geometry.inFooterSlot).toBe(true)
    expect(geometry.ours!.y).toBeLessThan(geometry.settings!.y)
    // The trailing affordance is the three-dot menu glyph, not a record count.
    await expect(trigger.locator('[data-dsh-shortcut-affordance]')).toBeVisible()
    await expect(trigger.locator('[data-dsh-shortcut-affordance] svg')).toHaveCount(1)
    expect(await trigger.innerText()).not.toMatch(/\d/)

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
    await expect(page.locator('[role="dialog"][aria-modal="true"]')).toBeVisible()
    // The navigate switch exists, defaults to on, and explains itself.
    const navigate = page.locator('[data-dsh-shortcut-navigate]')
    await expect(navigate).toBeVisible()
    await expect(navigate).toContainText(/跳转到该会话|Jump to the session/)
    const navSwitch = navigate.getByRole('switch')
    await expect(navSwitch).toHaveAttribute('aria-checked', 'true')
    // The any-session switch is there too, off by default: a captured record stays bound
    // to the session it came from unless the reader says otherwise.
    const anySession = page.locator('[data-dsh-shortcut-any-session]')
    await expect(anySession).toBeVisible()
    await expect(anySession).toContainText(/可发送给任意会话|Sendable to any session/)
    await expect(anySession.getByRole('switch')).toHaveAttribute('aria-checked', 'false')

    // The target tree is drawn, seeded at the bubble's session and REVEALED there — and it
    // is a control, not context: a capture can be retargeted (another session, one of its
    // agents, or made session-agnostic) before it is saved.
    const picker = page.locator('[data-dsh-shortcut-picker]')
    await expect(picker).toBeVisible()
    await expect(picker).not.toHaveAttribute('aria-disabled', 'true')
    await expect(picker.locator('[data-dsh-shortcut-selected]')).toBeVisible({ timeout: 15_000 })
    const search = picker.locator('[data-dsh-shortcut-tree-search]')
    await expect(search).toBeEnabled()
    const sessionRow = picker.locator('[data-dsh-shortcut-tree-session]').first()
    await expect(sessionRow).toBeEnabled()
    // The tree answers a search, which is the cheap proof that it is live. The query
    // MATCHES on purpose: a term that matches nothing re-derives the tree's expanded set
    // from an empty result, so clearing it leaves the tree collapsed — legal, but not
    // something this test wants to assert about a control it only needs to be interactive.
    await search.fill(TREE_QUERY)
    await expect(sessionRow).toBeVisible({ timeout: 10_000 })
    await search.fill('')
    await expect(sessionRow).toBeVisible({ timeout: 10_000 })

    await name.fill(SHORTCUT_NAME)
    await expect(confirm).toBeEnabled()
    await confirm.click()
    await expect(name).toBeHidden()
    await expect(page.getByText(new RegExp(`[「"]${SHORTCUT_NAME}[」"]`)).first()).toBeVisible({ timeout: 10_000 })

    await expect.poll(() => storedEntries().length, { timeout: 10_000 }).toBe(1)
    const [entry] = storedEntries()
    expect(entry).toMatchObject({
      name: SHORTCUT_NAME,
      sessionId: sessionA,
      text: CAPTURE_TEXT,
      navigate: true,
      anySession: false,
      target: { kind: 'main' },
    })
  })

  test('3. the menu has an About item, and a default shortcut jumps to its session on delivery', async () => {
    const workspaceTitle = fixture.workspace.split(/[\\/]/).pop() ?? 'workspace'
    sessionB = await beginSession(page, workspaceTitle, fixture.home, OTHER_TEXT)
    expect(sessionB).not.toBe(sessionA)
    // The shell is showing B when its own header publishes B's id.
    await expect(page.locator(`[data-dsh-shortcut-session="${sessionB}"]`)).toBeAttached({ timeout: 30_000 })

    // The last menu item explains the plugin and how records are managed.
    const trigger = page.locator('[data-dsh-shortcut-trigger]')
    await trigger.click()
    // Open keeps the same solid highlight the shell gives an open control.
    await expect(trigger).toHaveAttribute('data-active', '')
    // The menu opens to the RIGHT of the sidebar trigger, and it is roomier than
    // a stock menu (wider card, >= 40px rows).
    const menu = page.getByRole('menu')
    const triggerBox = await trigger.boundingBox()
    const menuBox = await menu.boundingBox()
    expect(triggerBox).not.toBeNull()
    expect(menuBox).not.toBeNull()
    expect(menuBox!.x).toBeGreaterThanOrEqual(triggerBox!.x + triggerBox!.width + 2)
    expect(menuBox!.width).toBeGreaterThanOrEqual(240)
    // Geometry alone does not prove the card is VISIBLE: a menu can be placed correctly
    // and still be covered by the sidebar it lives in, or by a later sibling. What the
    // reader needs is that the card is the element that actually paints at its own
    // position, and that it did not inherit the sidebar's layer to get there.
    const layering = await page.evaluate(() => {
      const menu = document.querySelector('[role="menu"]')
      if (menu === null) return null
      const box = menu.getBoundingClientRect()
      const mid = box.top + box.height / 2
      const paintedOnTop = (x: number, y: number): boolean => {
        const top = document.elementsFromPoint(x, y)[0]
        return top !== undefined && menu.contains(top)
      }
      const style = getComputedStyle(menu)
      return {
        parentIsBody: menu.parentElement === document.body,
        position: style.position,
        zIndex: Number.parseInt(style.zIndex, 10),
        probes: [
          paintedOnTop(box.left + 2, mid),
          paintedOnTop(box.left + box.width / 2, mid),
          paintedOnTop(box.right - 2, mid),
        ],
      }
    })
    expect(layering).not.toBeNull()
    // Portaled to the page, so the sidebar's own box and clipping cannot contain it.
    expect(layering!.parentIsBody).toBe(true)
    expect(layering!.position).toBe('fixed')
    // Above the shell's shared portaled-menu level (1100) — a tie there is decided by DOM
    // order, which is not a contract — and below the document-preview overlays (10000+).
    expect(layering!.zIndex).toBeGreaterThan(1100)
    expect(layering!.probes).toEqual([true, true, true])
    // The card's bottom edge lines up with the trigger's bottom edge.
    expect(Math.abs(menuBox!.y + menuBox!.height - (triggerBox!.y + triggerBox!.height))).toBeLessThanOrEqual(12)
    const aboutRow = page.getByRole('menuitem', { name: ABOUT_ITEM })
    const aboutBox = await aboutRow.boundingBox()
    expect(aboutBox).not.toBeNull()
    expect(aboutBox!.height).toBeGreaterThanOrEqual(30)
    await page.getByRole('menuitem', { name: ABOUT_ITEM }).click()
    const about = page.locator('[data-dsh-shortcut-about]')
    await expect(about).toBeVisible({ timeout: 10_000 })
    await expect(about).toContainText('dsh-shortcut')
    await expect(about).toContainText(ADD_LABEL)
    await expect(about).toContainText(/编辑|Edit|change/)
    await expect(about).toContainText(/删除|Delete/)
    await page.locator('[data-dsh-shortcut-about-close]').click()
    await expect(about).toBeHidden()

    await page.locator('[data-dsh-shortcut-trigger]').click()
    const item = page.getByRole('menuitem', { name: SHORTCUT_NAME })
    await expect(item).toBeVisible()
    await item.click()
    await expect(page.getByText(SENT_BANNER)).toBeVisible({ timeout: 10_000 })

    // The jump switch defaults to on, so delivery also OPENED the shortcut's
    // session: its transcript holds the original message plus the delivered copy.
    await expect(page.locator(`[data-dsh-shortcut-session="${sessionA}"]`)).toBeAttached({ timeout: 15_000 })
    await expect(page.locator(`[data-dsh-shortcut-session="${sessionB}"]`)).toHaveCount(0)
    await expect(page.locator('[data-chat-flow-kind="user"]')).toHaveCount(2, { timeout: 30_000 })

    // The session the reader was in received nothing.
    const secondRow = page.getByRole('treeitem').filter({ hasText: OTHER_PROBE }).first()
    await expect(secondRow).toBeVisible({ timeout: 20_000 })
    await secondRow.click({ timeout: 20_000 })
    await expect(page.locator(`[data-dsh-shortcut-session="${sessionB}"]`)).toBeAttached({ timeout: 15_000 })
    await expect(page.locator('[data-chat-flow-kind="user"]')).toHaveCount(1)
  })

  test('3b. the menu groups by the session on screen, current first and the rest after', async () => {
    // Starts where 3 left off: the shell shows B, and the only record targets A, so every
    // record belongs to the OTHER group.
    await expect(page.locator(`[data-dsh-shortcut-session="${sessionB}"]`)).toBeAttached({ timeout: 15_000 })
    const trigger = page.locator('[data-dsh-shortcut-trigger]')
    const menu = page.getByRole('menu')

    await trigger.click()
    await expect(menu).toBeVisible()
    // B has no shortcut of its own, so only the other-sessions heading is drawn: a
    // heading over an empty group is exactly what the grouping must NOT produce.
    await expect(menu.getByText(OTHER_GROUP)).toHaveCount(1)
    await expect(menu.getByText(CURRENT_GROUP)).toHaveCount(0)
    const otherHeadingBox = await menu.getByText(OTHER_GROUP).first().boundingBox()
    const recordBox = await page.getByRole('menuitem', { name: SHORTCUT_NAME }).boundingBox()
    expect(otherHeadingBox).not.toBeNull()
    expect(recordBox).not.toBeNull()
    // The heading sits ABOVE the row it heads.
    expect(otherHeadingBox!.y).toBeLessThan(recordBox!.y)

    // The heading is the shell's own heading treatment rather than a second row: smaller
    // and LIGHTER than the selectable rows below it.
    //
    // The leaf-only filter is load-bearing: the list's scroll viewport ALSO carries
    // role="presentation" and wraps every row, so picking the first match reads the
    // container and its inherited body color instead of the heading's own.
    const tones = await page.evaluate(() => {
      const menu = document.querySelector('[role="menu"]')
      if (menu === null) return null
      const heading = [...menu.querySelectorAll('[role="presentation"]')]
        .find(node => node.children.length === 0
          && /当前会话|其他会话|Current session|Other sessions/.test(node.textContent ?? ''))
      const row = menu.querySelector('[role="menuitem"]')
      if (heading === undefined || row === null) return null
      const headingStyle = getComputedStyle(heading)
      const rowStyle = getComputedStyle(row)
      /** Perceived lightness of an `rgb(...)`/`rgba(...)` color, 0..255. */
      const lightness = (color: string): number => {
        const [r, g, b] = (color.match(/\d+(?:\.\d+)?/g) ?? ['0', '0', '0']).map(Number)
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
      }
      return {
        headingColor: headingStyle.color,
        rowColor: rowStyle.color,
        headingLightness: lightness(headingStyle.color),
        rowLightness: lightness(rowStyle.color),
        headingSize: Number.parseFloat(headingStyle.fontSize),
        rowSize: Number.parseFloat(rowStyle.fontSize),
      }
    })
    expect(tones).not.toBeNull()
    expect(tones!.headingColor).not.toBe(tones!.rowColor)
    expect(tones!.headingLightness).toBeGreaterThan(tones!.rowLightness)
    expect(tones!.headingSize).toBeLessThan(tones!.rowSize)

    // Open A, the session the record targets.
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await page.getByRole('treeitem').filter({ hasText: FIRST_PROBE }).first().click({ timeout: 20_000 })
    await expect(page.locator(`[data-dsh-shortcut-session="${sessionA}"]`)).toBeAttached({ timeout: 15_000 })

    // Now the shown session IS the record's, so it moves under the current-session
    // heading, and the other heading goes away with its now-empty group.
    await trigger.click()
    await expect(menu).toBeVisible()
    await expect(menu.getByText(CURRENT_GROUP)).toHaveCount(1)
    await expect(menu.getByText(OTHER_GROUP)).toHaveCount(0)
    const currentHeadingBox = await menu.getByText(CURRENT_GROUP).first().boundingBox()
    const movedBox = await page.getByRole('menuitem', { name: SHORTCUT_NAME }).boundingBox()
    expect(currentHeadingBox).not.toBeNull()
    expect(movedBox).not.toBeNull()
    expect(currentHeadingBox!.y).toBeLessThan(movedBox!.y)
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()

    // Leave the shell on B, which is the state every later test was written against.
    await page.getByRole('treeitem').filter({ hasText: OTHER_PROBE }).first().click({ timeout: 20_000 })
    await expect(page.locator(`[data-dsh-shortcut-session="${sessionB}"]`)).toBeAttached({ timeout: 15_000 })
  })

  test('3c. the any-session switch re-groups the record and delivers to whoever is on screen', async () => {
    // Both halves of the switch's meaning, from the real editor: the menu moves the record
    // into its own group, and a click delivers it to the session being VIEWED rather than
    // the one it was captured from. The switch is turned back off at the end, so the tests
    // after this one see the plain bound record they were written against.
    await expect(page.locator(`[data-dsh-shortcut-session="${sessionB}"]`)).toBeAttached({ timeout: 15_000 })
    const trigger = page.locator('[data-dsh-shortcut-trigger]')
    const menu = page.getByRole('menu')

    /** Settings → Shortcuts → this record's editor, open. */
    const openEditor = async (): Promise<void> => {
      await page.locator('[data-slot="sidebar.settings"] button').first().click()
      const tab = page.locator('button[class*="navCell"]').filter({ hasText: TAB_LABEL }).first()
      await expect(tab).toBeVisible({ timeout: 15_000 })
      await tab.click()
      const row = page.locator('[data-dsh-shortcut-row]').filter({ hasText: SHORTCUT_NAME })
      await expect(row).toBeVisible({ timeout: 15_000 })
      await row.locator('[data-dsh-shortcut-edit]').click()
      await expect(page.locator('[data-dsh-shortcut-name]')).toHaveValue(SHORTCUT_NAME)
    }
    /** Close the editor and go back to B's conversation. */
    const backToB = async (): Promise<void> => {
      await page.keyboard.press('Escape')
      await expect(page.locator('[data-dsh-shortcut-name]')).toBeHidden({ timeout: 15_000 })
      await page.getByRole('treeitem').filter({ hasText: OTHER_PROBE }).first().click({ timeout: 20_000 })
      await expect(page.locator(`[data-dsh-shortcut-session="${sessionB}"]`)).toBeAttached({ timeout: 15_000 })
    }
    /** Save the open editor and wait for the store to answer. */
    const save = async (expected: boolean): Promise<void> => {
      await page.locator('[data-dsh-shortcut-confirm]').click()
      await expect(page.locator('[data-dsh-shortcut-name]')).toBeHidden({ timeout: 15_000 })
      await expect.poll(() => storedEntries()[0]?.anySession, { timeout: 10_000 }).toBe(expected)
    }

    await openEditor()
    const anySwitch = page.locator('[data-dsh-shortcut-any-session]').getByRole('switch')
    await expect(anySwitch).toHaveAttribute('aria-checked', 'false')
    // In EDIT the tree is a control, not context: this switch is not what unlocks it.
    await expect(page.locator('[data-dsh-shortcut-picker]')).not.toHaveAttribute('aria-disabled', 'true')
    await anySwitch.click()
    await expect(anySwitch).toHaveAttribute('aria-checked', 'true')
    await save(true)

    // Where the record came from no longer decides anything: it is triggered from B below.
    await backToB()
    await trigger.click()
    await expect(menu).toBeVisible()
    // It left the session groups entirely and got a heading of its own.
    await expect(menu.getByText(ANY_GROUP)).toHaveCount(1)
    await expect(menu.getByText(OTHER_GROUP)).toHaveCount(0)
    await expect(menu.getByText(CURRENT_GROUP)).toHaveCount(0)
    const anyHeading = await menu.getByText(ANY_GROUP).first().boundingBox()
    const anyRow = await page.getByRole('menuitem', { name: SHORTCUT_NAME }).boundingBox()
    expect(anyHeading).not.toBeNull()
    expect(anyRow).not.toBeNull()
    expect(anyHeading!.y).toBeLessThan(anyRow!.y)

    // Triggering it delivers into B — the session on screen — not into A, where it came from.
    const bubblesInB = await page.locator('[data-chat-flow-kind="user"]').count()
    await page.getByRole('menuitem', { name: SHORTCUT_NAME }).click()
    await expect(page.getByText(SENT_BANNER)).toBeVisible({ timeout: 10_000 })
    // The jump switch is on, so it navigates to where it delivered — which is here.
    await expect(page.locator(`[data-dsh-shortcut-session="${sessionB}"]`)).toBeAttached({ timeout: 15_000 })
    await expect(page.locator('[data-chat-flow-kind="user"]')).toHaveCount(bubblesInB + 1, { timeout: 30_000 })

    // Back off, and back into the ordinary grouping.
    await openEditor()
    await expect(anySwitch).toHaveAttribute('aria-checked', 'true')
    await anySwitch.click()
    await expect(anySwitch).toHaveAttribute('aria-checked', 'false')
    await save(false)
    await backToB()
    await trigger.click()
    await expect(menu.getByText(OTHER_GROUP)).toHaveCount(1)
    await expect(menu.getByText(ANY_GROUP)).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
  })

  test('4. the Settings page edits, adds and deletes records', async () => {
    await page.locator('[data-slot="sidebar.settings"] button').first().click()
    // The shell's own nav list; the class local name is stable across builds.
    const tab = page.locator('button[class*="navCell"]').filter({ hasText: TAB_LABEL }).first()
    await expect(tab).toBeVisible({ timeout: 15_000 })
    await tab.click()
    const row = page.locator('[data-dsh-shortcut-row]').filter({ hasText: SHORTCUT_NAME })
    await expect(row).toBeVisible({ timeout: 15_000 })

    // Narrow screens: the add action becomes a full-width row between the intro
    // paragraph and the list, instead of a squeezed control beside the title.
    await page.setViewportSize({ width: 480, height: 900 })
    const addAction = page.locator('[data-dsh-shortcut-settings-add]')
    const intro = page.locator('[data-dsh-shortcut-settings] p').first()
    const firstRow = page.locator('[data-dsh-shortcut-row]').first()
    const [addBox, introBox, rowBox, pageBox] = await Promise.all([
      addAction.boundingBox(), intro.boundingBox(), firstRow.boundingBox(),
      page.locator('[data-dsh-shortcut-settings]').boundingBox(),
    ])
    expect(addBox).not.toBeNull()
    expect(introBox).not.toBeNull()
    expect(rowBox).not.toBeNull()
    expect(pageBox).not.toBeNull()
    expect(addBox!.width).toBeGreaterThanOrEqual(pageBox!.width * 0.9)
    expect(addBox!.y).toBeGreaterThan(introBox!.y + introBox!.height - 2)
    // No huge blank between the intro and the full-width action row.
    expect(addBox!.y - (introBox!.y + introBox!.height)).toBeLessThanOrEqual(24)
    expect(addBox!.y + addBox!.height).toBeLessThanOrEqual(rowBox!.y + 2)
    await page.setViewportSize({ width: 1400, height: 900 })
    await expect(addAction).toBeVisible()
    // Wide: same placement (under the intro, above the list) but at its natural
    // width — the button is never stretched across the header.
    const [wideAdd, wideIntro, wideRow, widePage] = await Promise.all([
      addAction.boundingBox(),
      page.locator('[data-dsh-shortcut-settings] p').first().boundingBox(),
      page.locator('[data-dsh-shortcut-row]').first().boundingBox(),
      page.locator('[data-dsh-shortcut-settings]').boundingBox(),
    ])
    expect(wideAdd).not.toBeNull()
    expect(wideIntro).not.toBeNull()
    expect(wideRow).not.toBeNull()
    expect(widePage).not.toBeNull()
    expect(wideAdd!.y).toBeGreaterThan(wideIntro!.y + wideIntro!.height - 2)
    expect(wideAdd!.width).toBeLessThan(widePage!.width * 0.6)
    expect(wideAdd!.y + wideAdd!.height).toBeLessThanOrEqual(wideRow!.y + 2)

    // --- edit the name
    await row.locator('[data-dsh-shortcut-edit]').click()
    const name = page.locator('[data-dsh-shortcut-name]')
    await expect(name).toHaveValue(SHORTCUT_NAME)
    // Reopening at a stored target expands its workspace and brings the
    // selected row into view without any extra click.
    await expect(page.locator('[data-dsh-shortcut-picker] [data-dsh-shortcut-selected]'))
      .toBeVisible({ timeout: 15_000 })
    // The jump switch reopens in its stored state (on) and can be turned off.
    const navSwitch = page.locator('[data-dsh-shortcut-navigate]').getByRole('switch')
    await expect(navSwitch).toHaveAttribute('aria-checked', 'true')
    await navSwitch.click()
    await expect(navSwitch).toHaveAttribute('aria-checked', 'false')
    await name.fill(RENAMED)
    await page.locator('[data-dsh-shortcut-confirm]').click()
    await expect(page.locator('[data-dsh-shortcut-row]').filter({ hasText: RENAMED })).toBeVisible({ timeout: 10_000 })
    expect(storedEntries().map(entry => entry.name)).toEqual([RENAMED])
    expect(storedEntries()[0]?.navigate).toBe(false)

    // --- add a record by hand, picking the target from the tree
    await page.locator('[data-dsh-shortcut-settings-add]').click()
    const confirm = page.locator('[data-dsh-shortcut-confirm]')
    await expect(confirm).toBeDisabled()
    await name.fill(MANUAL_NAME)

    // The target tree is inline in the dialog — there is no dropdown to open.
    const picker = page.locator('[data-dsh-shortcut-picker]')
    await expect(picker).toBeVisible({ timeout: 10_000 })
    // The tree list is a stretched 200px panel: it does not hug its few rows and
    // the message body cannot stretch it beyond that cap.
    const treeList = picker.getByRole('tree')
    await expect(treeList).toBeVisible()
    const treeHeight = (await treeList.boundingBox())?.height ?? 0
    expect(treeHeight).toBeGreaterThanOrEqual(190)
    expect(treeHeight).toBeLessThanOrEqual(210)
    // Group rows wear the native folder icon; target rows do not. The tree opens
    // with workspaces collapsed, so the first press expands it.
    const workspaceRow = picker.locator('[data-dsh-shortcut-tree-workspace]').first()
    await expect(workspaceRow.locator('[data-dsh-shortcut-group-icon] svg')).toHaveCount(1)
    await workspaceRow.click()
    const treeSession = picker.locator('[data-dsh-shortcut-tree-session]').first()
    await expect(treeSession).toBeVisible({ timeout: 20_000 })
    await expect(treeSession.locator('[data-dsh-shortcut-group-icon]')).toHaveCount(0)
    await treeSession.click()
    // The read-only path line now shows workspace / session (no agent segment).
    await expect(page.locator('[data-dsh-shortcut-target]')).toContainText('/')

    await page.locator('[data-dsh-shortcut-text]').fill(MANUAL_TEXT)
    await expect(confirm).toBeEnabled()
    await confirm.click()
    await expect(page.locator('[data-dsh-shortcut-row]')).toHaveCount(2, { timeout: 10_000 })
    // The row shows the workspace / session path of its main-agent target.
    const workspaceTitle = fixture.workspace.split(/[\\/]/).pop() ?? 'workspace'
    const manualRow = page.locator('[data-dsh-shortcut-row]').filter({ hasText: MANUAL_NAME })
    await expect(manualRow).toContainText('/')
    await expect(manualRow).toContainText(workspaceTitle)
    const manualEntry = storedEntries().find(entry => entry.name === MANUAL_NAME)
    expect(manualEntry?.target).toMatchObject({ kind: 'main' })
    expect(typeof manualEntry?.target.path).toBe('string')
    // A manually added record also starts with the jump switch on.
    expect(manualEntry?.navigate).toBe(true)

    // --- delete the manual record
    await page.locator('[data-dsh-shortcut-row]').filter({ hasText: MANUAL_NAME })
      .locator('[data-dsh-shortcut-delete]').click()
    await page.locator('[data-dsh-shortcut-delete-confirm]').click()
    await expect(page.locator('[data-dsh-shortcut-row]').filter({ hasText: MANUAL_NAME })).toHaveCount(0, { timeout: 10_000 })
    expect(storedEntries().map(entry => entry.name)).toEqual([RENAMED])
  })

  test('4b. with the jump switch off, sending delivers without navigating', async () => {
    // Leave the Settings overlay (it owns a full-page mask) before driving the sidebar.
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-dsh-shortcut-settings]')).toBeHidden({ timeout: 10_000 })
    // Back to a conversation: pick the second session.
    const secondRow = page.getByRole('treeitem').filter({ hasText: OTHER_PROBE }).first()
    await expect(secondRow).toBeVisible({ timeout: 20_000 })
    await secondRow.click({ timeout: 20_000 })
    await expect(page.locator(`[data-dsh-shortcut-session="${sessionB}"]`)).toBeAttached({ timeout: 20_000 })

    await page.locator('[data-dsh-shortcut-trigger]').click()
    await page.getByRole('menuitem', { name: RENAMED }).click()
    await expect(page.getByText(SENT_BANNER)).toBeVisible({ timeout: 10_000 })
    // Switch off: the view stays on the second session and never opens A.
    await expect(page.locator(`[data-dsh-shortcut-session="${sessionB}"]`)).toBeAttached()
    await expect(page.locator(`[data-dsh-shortcut-session="${sessionA}"]`)).toHaveCount(0)
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
function storedEntries(): Array<{ name: string; sessionId: string; text: string; navigate?: boolean; target?: { kind?: string; path?: string } }> {
  try {
    const file = join(fixture.home, 'shortcut', 'entries.json')
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { entries?: unknown }
    return Array.isArray(parsed.entries)
      ? parsed.entries as Array<{ name: string; sessionId: string; text: string; navigate?: boolean; target?: { kind?: string; path?: string } }>
      : []
  } catch {
    return []
  }
}

/** Wait until the session on screen has finished its turn (done or failed). */
async function settleTurn(page: Page): Promise<void> {
  await expect(page.getByText(/处理失败|已完成|Failed|Done|invalid API key|API 密钥无效/i).first())
    .toBeVisible({ timeout: 30_000 })
}

/** Size of one session's durable log, or 0 when it cannot be found. */
test.afterEach(async () => {
  if (test.info().status === 'failed' && fixture !== undefined) {
    console.log(`[e2e] home: ${fixture.home}\n${describeHome(fixture.home)}`)
  }
})
