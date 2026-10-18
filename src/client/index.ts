/**
 * dsh-shortcut, browser half.
 *
 * Registers three seats on the 0.2.0 shell and mounts the DOM bridge for the
 * message-bubble button:
 *
 * - `sidebar.footer.action` — the "快捷方式" row directly above Settings, and
 *   the menu that delivers a shortcut without switching sessions;
 * - `settings.section` — the "快捷方式" Settings page (list/add/edit/delete);
 * - `conversation.session.header.utilities` — an invisible session-scoped seat
 *   that publishes the shown session and its user-message texts;
 * - plus a MutationObserver that injects "add to shortcut" left of the copy
 *   button on each durable user bubble.
 *
 * @module dsh-shortcut/client
 */

import { ShortcutApi } from './api.ts'
import type { ClientRpc } from './api.ts'
import { attachBubbleCapture } from './bubble-capture.ts'
import { ShortcutFooterEntry } from './components/FooterEntry.tsx'
import { ShortcutSessionSeat } from './components/SessionSeat.tsx'
import { ShortcutSettingsSection } from './components/SettingsSection.tsx'
import { editorStore } from './editor.ts'
import { entriesStore } from './entries.ts'
import { dictionaries, NS } from './locale.ts'
import type { Translate } from './locale.ts'
import { startCatalog } from './catalog.ts'

/** Stable Cordis plugin name for this entry. */
export const name = 'ui-shortcut'

/** Services that must exist before apply(): slots to fill, locale to speak, wire to talk. */
export const inject = ['slots', 'locale', 'connection']

/** The locale service slice this plugin uses. */
interface LocaleApi {
  register(ns: string, dictionaries: { zh: Record<string, string>; en: Record<string, string> }): () => void
  bind(ns: string): (key: string, params?: Record<string, unknown>) => string
}

/** The slot registry slice this plugin uses (typed loosely: two seats are foreign SlotMap keys). */
interface SlotsApi {
  inject(name: string, callback: () => unknown): void
  register(config: Record<string, unknown>, component: unknown): unknown
}

/** Console surface used for contained seat failures. */
interface LoggerLike {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

/** The client cordis context, narrowed to what this plugin touches. */
interface ClientContextLike {
  get(name: string): unknown
  effect(callback: () => void | (() => void), label?: string): void
  on?(event: string, callback: (...args: unknown[]) => void): unknown
  slots: SlotsApi
  locale: LocaleApi
  logger?: LoggerLike | undefined
}

/**
 * Fill one seat, with the failure contained.
 *
 * A registration runs inside the client boot; a throw here would take down
 * more than this plugin's one surface. A refused seat costs that surface and
 * says why on the console.
 * @param ctx - the client context.
 * @param slot - SlotMap key to fill.
 * @param config - registration options.
 * @param component - the React component filling it.
 */
function seat(ctx: ClientContextLike, slot: string, config: Record<string, unknown>, component: unknown): void {
  try {
    ctx.slots.inject(slot, () => ctx.slots.register({ name: slot, ...config }, component))
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    ctx.logger?.error(`dsh-shortcut: could not fill ${slot}: ${message}`)
  }
}

/**
 * The renderer gives every footer seat root `display: contents`, so several
 * plugins' actions are crammed into the shell's one flex row and the settings
 * row below can be pushed around. Stack the entries vertically instead, the
 * same way dsh-diff-approval does — and defer to the dedicated
 * dsh-footer-order plugin when it is present, so the two never fight.
 */
function injectFooterStackStyle(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector('style[data-dsh-shortcut-footer-stack]') !== null) return
  const footerOrderInstalled = (): boolean => {
    for (const style of document.querySelectorAll('style')) {
      if ((style.textContent ?? '').includes('--dsh-footer-order-gap')) return true
    }
    return false
  }
  const inject = (): void => {
    if (document.querySelector('style[data-dsh-shortcut-footer-stack]') !== null) return
    if (footerOrderInstalled()) return
    const style = document.createElement('style')
    style.setAttribute('data-dsh-shortcut-footer-stack', '')
    style.textContent = 'div[data-slot="sidebar.footer.action"]{display:flex!important;flex-direction:column!important;flex:1 1 auto!important;align-items:stretch!important;}'
    document.head.appendChild(style)
  }
  if (document.querySelector('div[data-slot="sidebar.footer.action"]') !== null) {
    inject()
    return
  }
  const observer = new MutationObserver(() => {
    if (document.querySelector('div[data-slot="sidebar.footer.action"]') !== null) {
      observer.disconnect()
      inject()
    }
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })
}

/**
 * Mount the shortcut surfaces.
 * @param ctx - client context carrying slots, locale and the wire.
 */
export function apply(ctx: ClientContextLike): void {
  injectFooterStackStyle()

  ctx.effect(() => ctx.locale.register(NS, dictionaries), 'dsh-shortcut: dictionaries')
  const t = ctx.locale.bind(NS) as Translate

  const connection = ctx.get('connection') as { rpc?: ClientRpc } | undefined
  if (connection?.rpc === undefined) throw new Error('dsh-shortcut: the connection RPC service is unavailable')
  entriesStore.bind(new ShortcutApi(connection.rpc))
  startCatalog(ctx, () => ctx.get('sessions'), () => ctx.get('workspaces'))

  seat(ctx, 'conversation.session.header.utilities', {
    id: 'shortcut-session-seat',
    order: -20,
    locale: NS,
  }, ShortcutSessionSeat)

  // Order 90 keeps this row below other footer plugins and directly above the
  // shell's Settings row, which is the position the product asks for.
  seat(ctx, 'sidebar.footer.action', {
    id: 'shortcut-footer',
    order: 90,
    locale: NS,
  }, ShortcutFooterEntry)

  seat(ctx, 'settings.section', {
    id: 'shortcut',
    order: 110,
    label: () => t('settings.tabLabel'),
    locale: NS,
  }, ShortcutSettingsSection)

  // The bubble button: one delegated click, self-healing placement.
  ctx.effect(() => attachBubbleCapture({
    t,
    onCapture: capture => { editorStore.openCapture(capture) },
  }), 'dsh-shortcut: bubble capture')

  // A new connection generation means the host may have restarted with a
  // different store state; re-read rather than showing a stale list.
  ctx.effect(() => {
    const off = ctx.on?.('connection/reset', () => { void entriesStore.refresh() })
    return () => {
      if (typeof off === 'function') (off as () => void)()
    }
  }, 'dsh-shortcut: reconnect refresh')
}
