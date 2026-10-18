/**
 * Opening a delivered shortcut's target in the shell.
 *
 * Delivery itself is host-side (the text is queued into the target agent), but
 * "jump there afterwards" is a shell navigation. DSH keeps navigation out of
 * the Session Controller on purpose: the view owner exposes it as
 * `ctx.uiWorkspace.openSession(target)`, which selects a session (or a
 * subagent/member address) and shows its conversation as one action.
 *
 * The plugin's React surfaces do not own a context, so the client half binds
 * one reader here at apply time. Navigation is best-effort: a shell without the
 * service (or one that refuses the address) only skips the jump — the message
 * has already been delivered either way.
 *
 * @module dsh-shortcut/client/navigation
 */

import type { ShortcutTarget } from '../types.ts'

/** The context slice this module reads lazily when the reader navigates. */
interface ContextLike {
  get(name: string): unknown
}

/** The view owner's navigation verb, narrowed to the one call used here. */
interface UiWorkspaceLike {
  openSession(target: unknown): void
}

/** The Session Controller's address resolver for child sessions. */
interface SessionsLike {
  subagentAddress?(id: string): unknown
}

/** How the reader reaches the client context. */
let readContext: (() => ContextLike | undefined) | undefined

/**
 * Install the context reader (called once from the plugin's browser apply).
 * @param reader - returns the live client context.
 */
export function bindNavigation(reader: () => ContextLike | undefined): void {
  readContext = reader
}

/** The receipt a successful delivery carries (name/session/target). */
export interface DeliveredTarget {
  sessionId: string
  target: ShortcutTarget
}

/**
 * Show the delivered shortcut's target, when the shell can navigate.
 * @param receipt - the host's delivery receipt.
 */
export function openDeliveredTarget(receipt: DeliveredTarget): void {
  const ctx = readContext?.()
  if (ctx === undefined) return
  const ui = ctx.get('uiWorkspace') as Partial<UiWorkspaceLike> | undefined
  if (ui === undefined || typeof ui.openSession !== 'function') return
  const child = receipt.target.kind === 'main' ? undefined : receipt.target.childSessionId
  const sessionId = receipt.sessionId.length === 0 ? undefined : receipt.sessionId
  // A child session is addressed through its durable parent address so the
  // shell opens it inside the session it belongs to; the raw id is the fallback.
  let address: unknown = child ?? sessionId
  if (child !== undefined) {
    try {
      const sessions = ctx.get('sessions') as SessionsLike | undefined
      address = sessions?.subagentAddress?.(child) ?? child
    } catch {
      address = child
    }
  }
  if (address === undefined) return
  try {
    ui.openSession(address)
  } catch {
    // Navigation is cosmetic: the message was already delivered.
  }
}
