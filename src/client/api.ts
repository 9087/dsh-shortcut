/**
 * Browser port over the plugin's own connection channel.
 *
 * Every business failure the host reports keeps its closed `code`; the port
 * turns it into a typed {@link ShortcutFailure} so the UI can say the reason
 * rather than "something went wrong". Transport-level rejections (the socket
 * was down, the frame was dropped) become the same failure kind with a
 * generic code, so callers only ever handle one error type.
 *
 * @module dsh-shortcut/client/api
 */

import { SHORTCUT_CHANNEL } from '../types.ts'
import type { ShortcutDraft, ShortcutEdit, ShortcutEntry, ShortcutTarget } from '../types.ts'
import type { ShortcutErrorCode } from '../types.ts'

/** One RPC result as the Connection transport frames it. */
export type RpcOutcome =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string; details: object } }

/** The one caller shape this port needs from `ctx.connection.rpc`. */
export interface ClientRpc {
  call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<RpcOutcome>
}

/** A business or transport failure with a code the UI can localize. */
export class ShortcutFailure extends Error {
  readonly code: ShortcutErrorCode

  /**
   * @param code - closed failure kind.
   * @param message - host-language detail, for logs only.
   */
  constructor(code: ShortcutErrorCode, message: string) {
    super(message)
    this.name = 'ShortcutFailure'
    this.code = code
  }
}

/** Narrow an unknown value to a record. */
function recordOf(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** Read one target shape off the wire (also used by the delivery receipt). */
function targetOf(value: unknown): ShortcutTarget | undefined {
  const target = recordOf(value)
  const kind = target?.kind
  if (target === undefined || (kind !== 'main' && kind !== 'subagent' && kind !== 'member')) return undefined
  const rawAncestors = target.ancestors
  const ancestors = Array.isArray(rawAncestors)
    ? rawAncestors.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : []
  return {
    kind,
    ...(typeof target.childSessionId === 'string' ? { childSessionId: target.childSessionId } : {}),
    ...(ancestors.length === 0 ? {} : { ancestors }),
    ...(typeof target.leafLabel === 'string' ? { leafLabel: target.leafLabel } : {}),
    ...(typeof target.workspaceTitle === 'string' ? { workspaceTitle: target.workspaceTitle } : {}),
    ...(typeof target.sessionTitle === 'string' ? { sessionTitle: target.sessionTitle } : {}),
    ...(typeof target.path === 'string' ? { path: target.path } : {}),
  }
}

/** Read one stored record off the wire, refusing a malformed one. */
function entryOf(value: unknown): ShortcutEntry {
  const row = recordOf(value)
  const target = targetOf(row?.target)
  if (row === undefined
    || typeof row.id !== 'string'
    || typeof row.name !== 'string'
    || typeof row.sessionId !== 'string'
    || typeof row.text !== 'string'
    || typeof row.createdAt !== 'number'
    || typeof row.updatedAt !== 'number'
    || target === undefined) {
    throw new ShortcutFailure('store-unavailable', 'the host returned a malformed shortcut record')
  }
  return {
    id: row.id,
    name: row.name,
    sessionId: row.sessionId,
    text: row.text,
    // Records written before the switch existed arrive without the field.
    navigate: row.navigate !== false,
    // Only an explicit `true` is session-agnostic; a missing field is the bound default.
    anySession: row.anySession === true,
    target,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** What the host confirms about one delivery. */
export interface ShortcutDelivery {
  name: string
  /** The session that actually received the text — the caller's own, for an any-session record. */
  sessionId: string
  target: ShortcutTarget
  navigate: boolean
  anySession: boolean
}

/**
 * The conversation the page has open, as an `anySession` record needs it.
 *
 * `parentSessionId` is present only when that conversation is an addressable child (a
 * subagent or team member opened on its own): a child is reachable through the subagent
 * runtime, never through the session controller, so the host needs the parent.
 */
export interface ShownConversation {
  sessionId: string
  parentSessionId?: string | undefined
}

/** The business verbs the browser half calls. */
export class ShortcutApi {
  private readonly rpc: ClientRpc

  /** @param rpc - the connection's channel caller. */
  constructor(rpc: ClientRpc) {
    this.rpc = rpc
  }

  /**
   * Call one endpoint, folding a transport rejection into a coded failure.
   * @param endpoint - channel-relative endpoint.
   * @param payload - endpoint payload.
   * @returns the raw success value.
   */
  private async call(endpoint: string, payload: unknown): Promise<unknown> {
    let outcome: RpcOutcome
    try {
      outcome = await this.rpc.call(SHORTCUT_CHANNEL, endpoint, payload)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      throw new ShortcutFailure(endpoint === 'send' ? 'send-failed' : 'store-unavailable', message)
    }
    if (outcome.ok) return outcome.value
    const code = outcome.error.code as ShortcutErrorCode
    throw new ShortcutFailure(code, outcome.error.message)
  }

  /** Read every record. */
  async list(): Promise<ShortcutEntry[]> {
    const value = recordOf(await this.call('list', {}))
    const entries = value?.entries
    if (!Array.isArray(entries)) throw new ShortcutFailure('store-unavailable', 'the host returned no entries list')
    return entries.map(entryOf)
  }

  /**
   * Create one record.
   * @param draft - validated-by-host draft values.
   */
  async create(draft: ShortcutDraft): Promise<ShortcutEntry> {
    const value = recordOf(await this.call('create', { draft }))
    return entryOf(value?.entry)
  }

  /**
   * Replace one record.
   * @param edit - identity plus replacement draft.
   */
  async update(edit: ShortcutEdit): Promise<ShortcutEntry> {
    const value = recordOf(await this.call('update', { edit }))
    return entryOf(value?.entry)
  }

  /**
   * Delete one record.
   * @param id - record identity.
   */
  async remove(id: string): Promise<void> {
    await this.call('remove', { id })
  }

  /**
   * Deliver one record's text into its addressed agent.
   * @param id - record identity.
   * @param shown - the conversation the page has open. Required by an any-session record
   *   (it delivers there), ignored by every other record.
   * @returns the record name plus the session and target the host actually delivered to.
   */
  async send(id: string, shown?: ShownConversation | undefined): Promise<ShortcutDelivery> {
    const payload = shown === undefined
      ? { id }
      : {
          id,
          currentSessionId: shown.sessionId,
          ...(shown.parentSessionId === undefined ? {} : { currentParentSessionId: shown.parentSessionId }),
        }
    const value = recordOf(await this.call('send', payload))
    const entry = recordOf(value?.entry)
    const target = targetOf(entry?.target)
    if (entry === undefined || typeof entry.name !== 'string' || typeof entry.sessionId !== 'string' || target === undefined) {
      throw new ShortcutFailure('send-failed', 'the host did not confirm the delivery')
    }
    return {
      name: entry.name,
      sessionId: entry.sessionId,
      target,
      navigate: entry.navigate !== false,
      anySession: entry.anySession === true,
    }
  }
}
