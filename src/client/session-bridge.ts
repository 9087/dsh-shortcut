/**
 * The bridge between the React chat view and the DOM-injected capture button.
 *
 * The user bubble's action row is rendered by the stock chat view and has no
 * plugin seat, so the "add to shortcuts" button is injected into that DOM (see
 * `bubble-capture.ts`). Placement needs no React, but the two facts the button
 * must act on do: which session the page is showing, and the text of the
 * message whose row was clicked.
 *
 * A tiny session-scoped seat (registered into the session header utilities,
 * which the shell renders for the shown session) publishes both here: it is
 * handed `sessionId` and the chat snapshot by the shell. The DOM side then
 * joins `data-chat-node-key` → published text, so capture never scrapes the
 * rendered prose unless the seat has not reported yet.
 *
 * @module dsh-shortcut/client/session-bridge
 */

import { useSyncExternalStore } from 'react'

/** Narrow an unknown value to a record. */
function recordOf(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** One chat node as the published snapshot exposes it. */
interface ChatNodeLike {
  key?: unknown
  kind?: unknown
  data?: unknown
}

/** The session the seat last reported, if any. */
let currentSessionId: string | undefined
/** The snapshot the current session's texts were built from. */
let currentSnapshot: unknown
/** `data-chat-node-key` → user message text. */
let texts = new Map<string, string>()
/** `data-chat-node-key` → the shortcut a delivered trigger card came from. */
let cardNames = new Map<string, string>()
/** Bumped on every committed publish; React readers subscribe to it. */
let revision = 0
const listeners = new Set<() => void>()

/** Wake React readers. */
function notify(): void {
  revision += 1
  for (const listener of [...listeners]) listener()
}

/** Pull the node array out of a chat snapshot, by any shape the shell has used. */
function nodesOf(snapshot: unknown): unknown[] {
  const root = recordOf(snapshot)
  if (root === undefined) return []
  const nodes = recordOf(root.nodes)
  if (nodes === undefined) return []
  const values = nodes.values
  if (typeof values === 'function') {
    try {
      const listed = values.call(nodes)
      if (Array.isArray(listed)) return listed
    } catch {
      // Fall through to the keyed reader below.
    }
  }
  const order = root.order
  const get = nodes.get
  if (Array.isArray(order) && typeof get === 'function') {
    const collected: unknown[] = []
    for (const key of order) {
      if (typeof key !== 'string') continue
      try {
        const node = get.call(nodes, key)
        if (node !== undefined) collected.push(node)
      } catch {
        // One unreadable node must not lose the rest.
      }
    }
    return collected
  }
  return []
}

/** Join a user node's text blocks. */
function textOfData(data: unknown): string {
  const content = recordOf(data)?.content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    const row = recordOf(block)
    if (row?.type === 'text' && typeof row.text === 'string') parts.push(row.text)
  }
  return parts.join('\n').trim()
}

/** Build the key → text map from one chat snapshot. */
function buildTexts(snapshot: unknown): Map<string, string> {
  const map = new Map<string, string>()
  for (const node of nodesOf(snapshot)) {
    const row = recordOf(node) as ChatNodeLike | undefined
    if (row === undefined || row.kind !== 'user' || typeof row.key !== 'string') continue
    const text = textOfData(row.data)
    if (text.length > 0) map.set(row.key, text)
  }
  return map
}

/**
 * Build the key → shortcut-name map from one chat snapshot.
 *
 * A delivered shortcut is a `turn-trigger` node whose message source is ours, so the DOM card
 * can be titled with the record it came from — the join is the node key the shell already puts
 * on the card. Only our own source is collected, so other wake sources (a scheduled reminder,
 * a goal, a webhook) keep the shell's own title.
 */
function buildCardNames(snapshot: unknown): Map<string, string> {
  const names = new Map<string, string>()
  for (const node of nodesOf(snapshot)) {
    const row = recordOf(node) as ChatNodeLike | undefined
    if (row === undefined || typeof row.key !== 'string') continue
    const source = recordOf(recordOf(row.data)?.source)
    if (source?.kind !== 'shortcut') continue
    const name = source.shortcutName
    if (typeof name === 'string' && name.length > 0) names.set(row.key, name)
  }
  return names
}

/**
 * Publish the shown session and its message texts.
 * @param sessionId - the session the seat belongs to, when the shell named one.
 * @param snapshot - the chat snapshot handed to the seat.
 */
export function publishSeat(sessionId: string | undefined, snapshot: unknown): void {
  if (sessionId === currentSessionId && snapshot === currentSnapshot) return
  currentSessionId = sessionId
  currentSnapshot = snapshot
  texts = buildTexts(snapshot)
  cardNames = buildCardNames(snapshot)
  notify()
}

/**
 * Withdraw one seat's facts, unless a newer publish already replaced them.
 * @param snapshot - the snapshot the unmounting seat had published.
 */
export function unpublishSeat(snapshot: unknown): void {
  if (currentSnapshot !== snapshot) return
  currentSessionId = undefined
  currentSnapshot = undefined
  texts = new Map()
  cardNames = new Map()
  notify()
}

/** The session the page is showing, as last published. */
export function publishedSessionId(): string | undefined {
  return currentSessionId
}

/** The text of one user message, as last published. */
export function publishedText(nodeKey: string): string | undefined {
  return texts.get(nodeKey)
}

/**
 * The shortcut a delivered trigger card came from, as last published.
 * @param nodeKey - the card's `data-chat-node-key`.
 * @returns the record name, or undefined for any other wake source.
 */
export function publishedCardName(nodeKey: string): string | undefined {
  return cardNames.get(nodeKey)
}

/**
 * Read a bubble's text from its rendered DOM, for the window before the seat
 * has published (or on a shell that hands the seat no chat snapshot). The
 * message row's own chrome (clock label, action buttons) is excluded by taking
 * the flow item and dropping its actions row.
 * @param flow - the `[data-chat-flow-kind="user"]` element.
 * @returns the visible text, trimmed.
 */
export function scrapeBubbleText(flow: Element): string {
  const clone = flow.cloneNode(true)
  if (!(clone instanceof Element)) return ''
  for (const actions of clone.querySelectorAll('[data-clock]')) actions.remove()
  for (const button of clone.querySelectorAll('button')) button.remove()
  return (clone.textContent ?? '').trim()
}

/**
 * Subscribe to bridge publishes outside React.
 *
 * A published snapshot is not a DOM change, so a DOM-only observer never learns that a card
 * can now be titled: the bridge has to wake its readers itself.
 * @param listener - called after every committed publish or withdrawal.
 * @returns the unsubscribe function.
 */
export function subscribeBridge(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Subscribe React to bridge publishes. */
export function useBridgeRevision(): number {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    () => revision,
    () => revision,
  )
}

/**
 * The session the page is showing, as a value React re-renders on.
 *
 * The seat publishes on every session switch and withdraws on unmount, so this tracks the
 * conversation actually on screen — including the "no session view" case (the Settings
 * page), which answers undefined rather than the last session that was open.
 * @returns the shown session id, or undefined when no session view is mounted.
 */
export function useCurrentSessionId(): string | undefined {
  useBridgeRevision()
  return currentSessionId
}
