/**
 * Wire types shared by the host and browser halves of dsh-shortcut.
 *
 * A shortcut is one durable record: a user-visible name, the id of an EXISTING
 * session it delivers to, and the exact text that is sent. The record is
 * captured either from a user message bubble (target = that session, text =
 * that bubble) or from the Settings page (target picked explicitly).
 *
 * @module dsh-shortcut/types
 */

/** The logical RPC channel this plugin owns on the DSH connection. */
export const SHORTCUT_CHANNEL = '/shortcut'

/** Current on-disk envelope version. */
export const STORE_VERSION = 1

/** Largest accepted name length, after trimming. */
export const NAME_MAX_LENGTH = 60

/** Largest accepted text length, after trimming. */
export const TEXT_MAX_LENGTH = 20_000

/** One shortcut record. */
export interface ShortcutEntry {
  /** Stable identity (uuid), used by edit/delete/send. */
  id: string
  /** User-visible name, unique among all records (case-insensitive, trimmed). */
  name: string
  /** Target session id; must name an existing session at send time. */
  sessionId: string
  /** Text delivered as one user message. */
  text: string
  /** Unix epoch ms of creation. */
  createdAt: number
  /** Unix epoch ms of the last edit. */
  updatedAt: number
}

/** The on-disk envelope. */
export interface ShortcutFile {
  version: typeof STORE_VERSION
  entries: ShortcutEntry[]
}

/** A draft before the host assigns identity and timestamps. */
export interface ShortcutDraft {
  name: string
  sessionId: string
  text: string
}

/** An edit address: the id plus the full replacement draft. */
export interface ShortcutEdit {
  id: string
  draft: ShortcutDraft
}

/** Closed vocabulary of failures a caller can branch on. */
export type ShortcutErrorCode =
  /** Shape violated (blank name, blank text, missing session, too long). */
  | 'invalid-input'
  /** Another record already owns this name. */
  | 'name-taken'
  /** The requested id is not in the store (already deleted). */
  | 'not-found'
  /** The store file exists but cannot be read/parsed, or cannot be written. */
  | 'store-unavailable'
  /** The target session no longer exists. */
  | 'session-not-found'
  /** The target session is archived; it cannot accept a prompt. */
  | 'session-archived'
  /** The target session refused the prompt (busy/writer-held). */
  | 'session-busy'
  /** Delivery failed for any other reason. */
  | 'send-failed'

/** One business failure as it crosses the wire. */
export interface ShortcutError {
  code: ShortcutErrorCode
  /** Host-language detail; the client shows its own localized sentence. */
  message: string
}

/** A successful payload. */
export type ShortcutValue =
  | { entries: ShortcutEntry[] }
  | { entry: ShortcutEntry }
  | { removed: true }
  | { accepted: true }

/** List request: no arguments. */
export interface ListRequest { readonly kind: 'list' }

/** Create request. */
export interface CreateRequest {
  readonly kind: 'create'
  readonly draft: ShortcutDraft
}

/** Update request. */
export interface UpdateRequest {
  readonly kind: 'update'
  readonly edit: ShortcutEdit
}

/** Remove request. */
export interface RemoveRequest {
  readonly kind: 'remove'
  readonly id: string
}

/** Send request. */
export interface SendRequest {
  readonly kind: 'send'
  readonly id: string
}

/** Every request this channel accepts. */
export type ShortcutRequest = ListRequest | CreateRequest | UpdateRequest | RemoveRequest | SendRequest
