/**
 * The sidebar-foot entry: the button in the footer action list the shell draws
 * above its own Settings button, and the menu it opens.
 *
 * Pressing a menu item delivers that shortcut's text into its target agent. By
 * default it also opens that target in the shell (the shortcut's "jump to that
 * session" switch, on from the start), so the delivered message is visible at
 * once; records can turn the jump off and then delivery stays in the background,
 * leaving the reader in the conversation they are reading. The outcome is
 * reported by a toast, and a failure keeps its reason.
 *
 * This entry also hosts the plugin's single dialog and banner instance: it is
 * mounted for the life of the page, so a capture started from a bubble (a DOM
 * button, not a React surface) always has a home for its dialog.
 *
 * @module dsh-shortcut/client/components/FooterEntry
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { IconEllipsisOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import { ShortcutFailure } from '../api.ts'
import { bannerStore, mountedHosts } from '../editor.ts'
import { entriesStore, useEntries } from '../entries.ts'
import { errorText } from '../locale.ts'
import type { Translate } from '../locale.ts'
import { groupShortcuts, shortcutRows } from '../menu-groups.ts'
import { openDeliveredTarget } from '../navigation.ts'
import { useCurrentSessionId } from '../session-bridge.ts'
import { targetShortLabel } from '../catalog.ts'
import { ShortcutIcon } from './ShortcutIcon.tsx'
import { ShortcutEditorDialog } from './EditorDialog.tsx'
import { ShortcutAboutDialog } from './AboutDialog.tsx'
import { BannerHost } from './BannerHost.tsx'
import css from '../styles.module.css'
import type { ReactNode } from 'react'

/** Menu-id of the last item; it opens the about dialog instead of delivering. */
const ABOUT_ID = 'about'

/** Props the sidebar footer seat supplies: column state and the localizer. */
export interface FooterEntryProps {
  /** Whether the sidebar shows labels (false renders the 56px rail). */
  wide: boolean
  /** The framework's localizer for this plugin's namespace. */
  t: Translate
}

/**
 * Render the shortcut button and its menu.
 * @param props - column state and localizer.
 * @returns the footer row plus the plugin's dialog/banner hosts.
 */
export function ShortcutFooterEntry({ wide, t }: FooterEntryProps): ReactNode {
  const list = useEntries()
  // Which session the page is showing. The menu groups by it, so it has to be a
  // render-reactive value, not the module's last-known id (see `useCurrentSessionId`).
  const currentSessionId = useCurrentSessionId()
  const [open, setOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)

  // Claim the page-lifetime host seat and load the records once.
  useEffect(() => {
    mountedHosts.footer = true
    entriesStore.ensureLoaded()
    return () => { mountedHosts.footer = false }
  }, [])

  // A menu opened before the first read finished should show the newest list.
  useEffect(() => {
    if (open) entriesStore.ensureLoaded()
  }, [open])

  // The records split by the session on screen: the current session's shortcuts first,
  // then everything else. Both groups are flat heading rows in one always-open card, so
  // there is no expanded state to keep.
  const groups = useMemo(
    () => groupShortcuts(list.entries, currentSessionId),
    [list.entries, currentSessionId],
  )

  const items = useMemo<MenuEntry[]>(() => {
    // The last row is always the about entry, separated from the records (or
    // from the empty/load-failure note) so it never reads as another shortcut.
    const about: MenuEntry = { id: ABOUT_ID, label: t('menu.about') }
    const separator: MenuEntry = { type: 'separator', id: 'about-separator' }
    if (list.phase === 'error') {
      return [{ type: 'label', id: 'load-failed', text: t('menu.loadFailed') }, separator, about]
    }
    if (list.entries.length === 0) {
      return [{ type: 'label', id: 'empty', text: t('menu.empty') }, separator, about]
    }
    return [...shortcutRows(groups, t), separator, about]
  }, [groups, list.entries.length, list.phase, t])

  const deliver = async (id: string): Promise<void> => {
    setOpen(false)
    try {
      // The shown session is handed over on every delivery: an any-session record
      // delivers there, and the host ignores it for every other record.
      const receipt = await entriesStore.send(id, currentSessionId)
      bannerStore.show(t('toast.sent', { target: targetShortLabel(receipt.target, receipt.sessionId, t) }), { tone: 'success' })
      if (receipt.navigate) openDeliveredTarget(receipt)
    } catch (error: unknown) {
      const code = error instanceof ShortcutFailure ? error.code : 'send-failed'
      bannerStore.show(errorText(t, code), { holdMs: 6000 })
    }
  }

  const onSelect = (id: string): void => {
    if (id === ABOUT_ID) {
      setOpen(false)
      setAboutOpen(true)
      return
    }
    if (!list.entries.some(entry => entry.id === id)) return
    void deliver(id)
  }

  const label = t('trigger.label')

  // `Menu`'s right side is anchored to the anchor's TOP. To make the menu's
  // BOTTOM line up with the button's bottom edge, hand it a synthetic anchor
  // rect whose top is `button.bottom - menuHeight`: the card then grows upward
  // from the button's bottom line. The menu height is the live card height, so
  // it stays aligned as the record list scrolls or changes.
  const menuAnchorRect = useCallback((): DOMRect | null => {
    const triggerEl = document.querySelector('[data-dsh-shortcut-trigger]')
    if (!(triggerEl instanceof HTMLElement)) return null
    const rect = triggerEl.getBoundingClientRect()
    const selector = css.menuCard === undefined ? '' : `.${css.menuCard}`
    const card = selector.length === 0 ? null : document.querySelector(selector)
    const height = card instanceof HTMLElement ? card.getBoundingClientRect().height : 0
    return new DOMRect(rect.left, rect.bottom - height, rect.width, rect.height)
  }, [])

  // Geometry mirrors the shell's Settings trigger row (same width, padding and
  // 4px / -2px margins), so the open-state highlight and the popup menu line up
  // with the Settings button below it. The trailing ellipsis is the affordance:
  // this control opens a menu rather than acting immediately.
  const trigger = (
    <button
      type="button"
      className={wide ? css.footerButton : css.footerButtonRail}
      aria-label={label}
      title={t('trigger.tooltip')}
      aria-haspopup="menu"
      aria-expanded={open}
      data-dsh-shortcut-trigger=""
      data-active={open ? '' : undefined}
      onClick={() => { setOpen(value => !value) }}
    >
      <span className={css.footerIcon}><ShortcutIcon /></span>
      {wide && <span className={css.footerLabel}>{label}</span>}
      {wide && (
        <span className={css.footerAffordance} data-dsh-shortcut-affordance="" aria-hidden="true">
          <IconEllipsisOutlineRegular size={16} />
        </span>
      )}
    </button>
  )

  return (
    <div className={wide ? css.footerRoot : `${css.footerRoot} ${css.footerRailRoot}`} data-dsh-shortcut-footer="">
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        anchor={trigger}
        items={items}
        onSelect={onSelect}
        side="right"
        portal
        getAnchorRect={menuAnchorRect}
        listClassName={css.menuCard ?? ''}
      />
      <ShortcutEditorDialog t={t} />
      <ShortcutAboutDialog open={aboutOpen} onClose={() => { setAboutOpen(false) }} t={t} />
      <BannerHost />
    </div>
  )
}
