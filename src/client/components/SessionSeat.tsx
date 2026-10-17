/**
 * The session-scoped seat that publishes what the DOM-injected bubble button
 * needs: the shown session id and the chat snapshot (from which each user
 * message's text is derived by node key).
 *
 * It renders nothing. The shell hands every session-scope slot component
 * `sessionId` and `useChat`; both are read defensively so a shell that offers
 * only one of them still leaves the other facts intact.
 *
 * @module dsh-shortcut/client/components/SessionSeat
 */

import { useEffect } from 'react'
import { publishSeat, unpublishSeat } from '../session-bridge.ts'
import type { ReactNode } from 'react'

/** Props the shell injects into a session-scoped seat. */
export interface SessionSeatProps {
  /** The session this header is showing. */
  sessionId?: string | undefined
  /** The chat snapshot selector hook, merged onto session-scope slots by ui-chat. */
  useChat?: unknown
}

/** A hook stand-in for a shell that does not hand this seat the chat snapshot. */
const noChat = <Selected,>(selector: (snapshot: unknown) => Selected): Selected => selector(undefined)

/**
 * Publish the shown session and its user-message texts.
 * @param props - the shell-injected session id and chat hook.
 * @returns null; this seat is invisible by design.
 */
export function ShortcutSessionSeat(props: SessionSeatProps): ReactNode {
  const useChat = typeof props.useChat === 'function'
    ? props.useChat as <Selected,>(selector: (snapshot: unknown) => Selected) => Selected
    : noChat
  // Subscribing to the whole snapshot is deliberate: the text map is rebuilt
  // whenever any node changes, which is exactly when a new bubble can appear.
  const snapshot = useChat((value: unknown) => value)
  useEffect(() => {
    publishSeat(props.sessionId, snapshot)
    return () => { unpublishSeat(snapshot) }
  }, [props.sessionId, snapshot])
  // A hidden marker of the shown session. The DOM side of this plugin needs the
  // fact in non-React code anyway, and a marker makes "which session is this
  // page showing" readable from the shell's own DOM (the E2E asserts on it).
  if (props.sessionId === undefined) return null
  return <span data-dsh-shortcut-session={props.sessionId} hidden aria-hidden="true" />
}
