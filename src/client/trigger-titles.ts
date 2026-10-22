/**
 * Title the shell's trigger card for a DELIVERED shortcut.
 *
 * A delivery wakes the agent, so the shell draws that turn's wake message as its own
 * `turn-trigger` card — the same card a scheduled reminder gets. Its title comes from a CLOSED
 * switch over `source.kind` inside the shell, and an unknown kind falls back to the generic
 * "收到执行请求"; there is no seam to teach it a new kind without taking over the renderer for
 * EVERY wake source. So the title is corrected here instead, in the DOM, joined through the
 * node key the shell already puts on the card: the session bridge publishes
 * `data-chat-node-key → shortcut name` for the nodes whose source is ours, and only those cards
 * are touched. A scheduled reminder, a goal, or a webhook keeps exactly the title it had.
 *
 * This is the same technique (and the same stable anchors) as the browser's capture button: no
 * chat-view slot renders a user message's chrome, so the plugin decorates the rendered DOM and
 * re-applies after each React pass.
 *
 * @module dsh-shortcut/client/trigger-titles
 */

import type { Translate } from './locale.ts'
import { publishedCardName, subscribeBridge } from './session-bridge.ts'

/** What the bridge needs from its owner. */
export interface TriggerTitleOptions {
  /** Translator for the plugin's own namespace. */
  t: Translate
}

/** The flow items the shell renders a wake card in. */
const CARD = '[data-chat-flow-kind="turn-trigger"]'

/**
 * Find the card's title element.
 *
 * The header button's direct children are, in order: an icon span (it holds an `<svg>`), the
 * title span, a `<time>`, and a chevron `<svg>`. Selecting by position would break the moment
 * the shell inserts a node, so the title is identified by shape: the span that carries text and
 * no icon of its own.
 * @param card - one `[data-chat-flow-kind="turn-trigger"]` element.
 * @returns the title span, when the card has the expected shape.
 */
function titleSpanOf(card: Element): Element | undefined {
  const header = card.querySelector('button[aria-expanded]')
  if (header === null) return undefined
  for (const child of [...header.children]) {
    if (child.tagName !== 'SPAN') continue
    if (child.querySelector('svg') !== null) continue
    return child
  }
  return undefined
}

/**
 * Correct one card's title, when it belongs to a delivered shortcut.
 * @param card - one `[data-chat-flow-kind="turn-trigger"]` element.
 * @param t - translator for the plugin's namespace.
 * @returns the title written, or undefined when the card is not ours.
 */
function retitle(card: Element, t: Translate): string | undefined {
  const key = card.getAttribute('data-chat-node-key')
  if (key === null) return undefined
  const name = publishedCardName(key)
  if (name === undefined) return undefined
  const span = titleSpanOf(card)
  if (span === undefined) return undefined
  const title = `${t('card.title')} · ${name}`
  if (span.textContent !== title) span.textContent = title
  card.setAttribute('data-dsh-shortcut-card', '')
  return title
}

/**
 * Attach the title bridge.
 *
 * Returns early without a `document`, like every other bridge in this plugin: the published
 * bundle is exercised in a headless harness (and any SSR-ish host) where those globals simply
 * do not exist, and a decoration must never be the reason a plugin fails to load.
 * @param options - the owner's translator.
 * @returns a disposer that stops observing and restores nothing (the cards unmount with the view).
 */
export function attachTriggerTitles(options: TriggerTitleOptions): () => void {
  if (typeof document === 'undefined') return () => {}
  const { t } = options
  let frame = 0
  let disposed = false

  /** Bring every rendered card in line with the published snapshot. */
  const ensure = (): void => {
    frame = 0
    if (disposed) return
    for (const card of document.querySelectorAll(CARD)) retitle(card, t)
  }

  /** Coalesce DOM mutations into one pass per frame. */
  const schedule = (): void => {
    if (disposed || frame !== 0) return
    frame = requestAnimationFrame(ensure)
  }

  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  // A publish is not a DOM change: a card may already be on screen when its name arrives.
  const unsubscribe = subscribeBridge(schedule)
  schedule()

  return () => {
    disposed = true
    unsubscribe()
    observer.disconnect()
    if (frame !== 0) cancelAnimationFrame(frame)
    frame = 0
  }
}
