/**
 * The "add to shortcuts" button on a user message bubble.
 *
 * The stock chat view draws a user message's action row itself and offers no
 * slot a plugin can fill, so the button is injected into that row as a DOM
 * sibling placed immediately BEFORE the copy button — the position the product
 * asks for. The chat view is React-owned, so this module is deliberately
 * idempotent and self-healing: on every mutation batch it re-ensures exactly
 * one button per durable user bubble, in the right position, and it never
 * touches the React-owned copy button itself.
 *
 * Stable anchors, not CSS-module hashes: flow kind, the action row's
 * `data-clock`, and `data-chat-node-key` are semantic attributes of the chat
 * view. The copy button supplies its own class name to the injected button,
 * so the two controls share one styling (size, hover, icon colour) without
 * this plugin shipping a copy of the design tokens.
 *
 * @module dsh-shortcut/client/bubble-capture
 */

import type { Translate } from './locale.ts'
import { publishedSessionId, publishedText, scrapeBubbleText } from './session-bridge.ts'

/** Marks an injected button, both for idempotency and for the delegated click. */
const BUTTON_ATTR = 'data-dsh-shortcut-add'

/** The durable user-message flow item. Optimistic echoes carry no node key and are skipped. */
const FLOW_SELECTOR = '[data-chat-flow-kind="user"]'

/** The action row a user bubble renders (`clock: 'start'`). */
const ACTION_ROW_SELECTOR = '[data-clock="start"]'

/** The injected glyph: a bookmark with a plus, 16×16, currentColor. */
const GLYPH = [
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">',
  '<path d="M3.5 2.75h9v10.5L8 10.4l-4.5 2.85V2.75Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
  '<path d="M8 5.1v3.4M6.3 6.8h3.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  '</svg>',
].join('')

/** What one capture press resolved. */
export interface BubbleCapture {
  /** The session the bubble belongs to, when the bridge knows it. */
  sessionId?: string | undefined
  /** The bubble's text; empty when nothing could be read. */
  text: string
}

/** Inputs for {@link attachBubbleCapture}. */
export interface BubbleCaptureOptions {
  t: Translate
  onCapture: (capture: BubbleCapture) => void
}

/** The actions row of a user bubble, or undefined for anything else. */
function actionRowOf(node: Element): HTMLElement | undefined {
  const row = node.closest(ACTION_ROW_SELECTOR)
  if (!(row instanceof HTMLElement)) return undefined
  const flow = row.closest(FLOW_SELECTOR)
  if (!(flow instanceof HTMLElement)) return undefined
  if (flow.getAttribute('data-chat-node-key') === null) return undefined
  return row
}

/** One button's styling source: the copy control already in the row. */
function copyButtonOf(row: HTMLElement): HTMLButtonElement | undefined {
  for (const child of row.children) {
    if (child instanceof HTMLButtonElement && !child.hasAttribute(BUTTON_ATTR)) return child
  }
  return undefined
}

/** Build one injected button, styled exactly like the copy control beside it. */
function createButton(copy: HTMLButtonElement, t: Translate): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.setAttribute(BUTTON_ATTR, '')
  button.className = copy.className
  button.setAttribute('aria-label', t('bubble.add'))
  button.title = t('bubble.add')
  button.innerHTML = GLYPH
  return button
}

/** The injected button already in one row, if any. */
function injectedOf(row: HTMLElement): HTMLButtonElement | undefined {
  for (const child of row.children) {
    if (child instanceof HTMLButtonElement && child.hasAttribute(BUTTON_ATTR)) return child
  }
  return undefined
}

/** Keep a stale accessible label in step with the current locale. */
function relabel(button: HTMLButtonElement, t: Translate): void {
  const label = t('bubble.add')
  if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label)
  if (button.title !== label) button.title = label
}

/** Ensure one correctly placed button per durable user bubble. */
function scan(t: Translate): void {
  for (const node of document.querySelectorAll(ACTION_ROW_SELECTOR)) {
    const row = actionRowOf(node)
    if (row === undefined) continue
    const copy = copyButtonOf(row)
    if (copy === undefined) continue
    const existing = injectedOf(row)
    if (existing === undefined) {
      copy.before(createButton(copy, t))
      continue
    }
    relabel(existing, t)
    if (existing.nextElementSibling !== copy) copy.before(existing)
  }
}

/**
 * Install the injection and the delegated capture handler.
 * @param options - locale read at scan time and the capture callback.
 * @returns teardown: observer disconnected, listener removed, buttons removed.
 */
export function attachBubbleCapture(options: BubbleCaptureOptions): () => void {
  if (typeof document === 'undefined') return () => {}
  let frame = 0
  const ensure = (): void => {
    frame = 0
    scan(options.t)
  }
  const schedule = (): void => {
    if (frame !== 0) return
    frame = requestAnimationFrame(ensure)
  }
  const onClick = (event: MouseEvent): void => {
    const target = event.target
    if (!(target instanceof Element)) return
    const button = target.closest(`[${BUTTON_ATTR}]`)
    if (button === null) return
    const flow = button.closest(FLOW_SELECTOR)
    if (!(flow instanceof HTMLElement)) return
    event.preventDefault()
    event.stopPropagation()
    const nodeKey = flow.getAttribute('data-chat-node-key')
    const published = nodeKey === null ? undefined : publishedText(nodeKey)
    const text = published ?? scrapeBubbleText(flow)
    options.onCapture({ sessionId: publishedSessionId(), text })
  }
  document.addEventListener('click', onClick, true)
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true })
  schedule()
  return () => {
    document.removeEventListener('click', onClick, true)
    observer.disconnect()
    if (frame !== 0) cancelAnimationFrame(frame)
    for (const node of document.querySelectorAll(`[${BUTTON_ATTR}]`)) node.remove()
  }
}
