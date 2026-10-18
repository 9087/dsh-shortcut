/**
 * Wire types shared by the host and browser halves of dsh-shortcut.
 *
 * A shortcut is one durable record: a user-visible name, a TARGET (a session,
 * or one agent inside it — a subagent / agent-team member), and the exact text
 * that is sent. The record is captured either from a user message bubble
 * (target = the bubble's own session, main agent) or from the Settings page's
 * tree picker, which can address any leaf agent of any workspace/session.
 *
 * @module dsh-shortcut/types
 */

/** The logical RPC channel this plugin owns on the DSH connection. */
export const SHORTCUT_CHANNEL = '/shortcut'

/** Current on-disk envelope version (2 = target model; 1 = session-id only). */
export const STORE_VERSION = 2

/** Largest accepted name length, after trimming. */
export const NAME_MAX_LENGTH = 60

/** Largest accepted text length, after trimming. */
export const TEXT_MAX_LENGTH = 20_000

/** Longest accepted label/path snapshot, after trimming. */
export const LABEL_MAX_LENGTH = 400

/**
 * Which agent a shortcut addresses inside its session:
 * - `main` — the session's own (lead) agent;
 * - `subagent` — one continuable subagent child of that agent;
 * - `member` — one agent-team teammate (also a continuable child of the lead).
 */
export type ShortcutTargetKind = 'main' | 'subagent' | 'member'

/** Every target kind, for validation. */
export const TARGET_KINDS: readonly ShortcutTargetKind[] = ['main', 'subagent', 'member']

/**
 * Where one shortcut delivers.
 *
 * `sessionId` on the entry is the owning top-level session (the parent that
 * authorizes a subagent prompt); `childSessionId` names the subagent/member
 * when the target is not the main agent.
 */
export interface ShortcutTarget {
  kind: ShortcutTargetKind
  /** Subagent/member session id; absent for `main`. */
  childSessionId?: string
  /**
   * Session-id chain from the top-level session down to this target's DIRECT
   * PARENT session (inclusive), used to auto-expand/reveal the target when the
   * editor reopens. Absent on records written before this field existed and on
   * main-agent targets.
   */
  ancestors?: string[]
  /** Workspace title captured when the shortcut was saved (display fallback). */
  workspaceTitle?: string
  /** Session title captured when the shortcut was saved (display fallback). */
  sessionTitle?: string
  /** Leaf label captured when the shortcut was saved (main agent / member name / subagent work). */
  leafLabel?: string
  /** `<workspace>/<session>/<leaf>` captured when the shortcut was saved. */
  path?: string
}

/** One shortcut record. */
export interface ShortcutEntry {
  /** Stable identity (uuid), used by edit/delete/send. */
  id: string
  /** User-visible name, unique among all records (case-insensitive, trimmed). */
  name: string
  /** Owning top-level session id; must name an existing session at send time. */
  sessionId: string
  /** Text delivered as one user message. */
  text: string
  /**
   * Whether triggering the shortcut also opens its target (the session, or the
   * agent inside it) in the shell. Defaults to true; records written before
   * this field existed are read as true.
   */
  navigate: boolean
  /** Which agent inside `sessionId` receives the text. */
  target: ShortcutTarget
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
  target: ShortcutTarget
  text: string
  /** Open the target after delivery; omitted means true (the default). */
  navigate?: boolean
}

/** An edit address: the id plus the full replacement draft. */
export interface ShortcutEdit {
  id: string
  draft: ShortcutDraft
}

/** Closed vocabulary of failures a caller can branch on. */
export type ShortcutErrorCode =
  /** Shape violated (blank name, blank text, missing session/target, too long). */
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
  /** A one-shot subagent cannot accept a message (only continuable children can). */
  | 'target-not-resumable'
  /** A subagent/member delivery needs its parent session to be live, and it is not. */
  | 'parent-unavailable'
  /** The addressed agent no longer exists or is not addressable from that parent. */
  | 'target-unavailable'
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
