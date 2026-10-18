/**
 * Draft rules shared by both halves, so the dialog's disabled state and the
 * host's acceptance can never disagree.
 *
 * The host is still authoritative (two browser tabs can race), but the browser
 * asks the same questions to enable/disable its confirm button, which is what
 * keeps "the button looked enabled but the host refused" from happening.
 *
 * A target is either the session's own (lead) agent or one of its addressable
 * child agents: a continuable subagent or an agent-team teammate. Those two
 * share one address shape (the parent session authorizes the child), which is
 * why only `childSessionId` distinguishes them on the wire.
 *
 * @module dsh-shortcut/share
 */

import { LABEL_MAX_LENGTH, NAME_MAX_LENGTH, TARGET_KINDS, TEXT_MAX_LENGTH } from './types.ts'
import type {
  ShortcutDraft, ShortcutEntry, ShortcutError, ShortcutErrorCode, ShortcutTarget, ShortcutTargetKind,
} from './types.ts'

/** Trim and reject anything that is not a usable string. */
export function normalized(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

/** Trim an optional label, dropping empty/overlong values. */
function label(value: unknown): string | undefined {
  const trimmed = normalized(value)
  if (trimmed === undefined) return undefined
  return trimmed.length > LABEL_MAX_LENGTH ? trimmed.slice(0, LABEL_MAX_LENGTH) : trimmed
}

/** The uniqueness key of a name: trimmed and case-folded. */
export function nameKey(name: string): string {
  return name.trim().toLocaleLowerCase()
}

/** Every reason a draft would be refused, in the order the UI explains them. */
export type DraftProblem = Extract<ShortcutErrorCode, 'invalid-input' | 'name-taken'>

/** A validated draft, ready for the store. */
export interface ValidDraft {
  name: string
  sessionId: string
  target: ShortcutTarget
  text: string
}

/** Whether one value is a known target kind. */
export function isTargetKind(value: unknown): value is ShortcutTargetKind {
  return typeof value === 'string' && (TARGET_KINDS as readonly string[]).includes(value)
}

/** Largest accepted ancestor chain (defensive bound for a hand-written file). */
const ANCESTOR_MAX = 32

/** Trim an optional session-id chain, refusing duplicates and empty entries. */
function ancestorsOf(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length === 0 || value.length > ANCESTOR_MAX) return undefined
  const ids: string[] = []
  for (const item of value) {
    const id = normalized(item)
    if (id === undefined) return undefined
    ids.push(id)
  }
  return new Set(ids).size === ids.length ? ids : undefined
}

/**
 * Normalize one target, refusing an address that cannot deliver.
 * @param raw - the target as it arrived on the wire.
 * @param sessionId - the already-validated owning session id.
 * @returns the normalized target, or undefined when the address is unusable.
 */
export function normalizeTarget(raw: unknown, sessionId: string): ShortcutTarget | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const fields = raw as Record<string, unknown>
  if (!isTargetKind(fields.kind)) return undefined
  const childSessionId = normalized(fields.childSessionId)
  if (fields.kind === 'main') {
    if (childSessionId !== undefined) return undefined
  } else if (childSessionId === undefined || childSessionId === sessionId) {
    return undefined
  }
  const target: ShortcutTarget = { kind: fields.kind }
  if (childSessionId !== undefined) target.childSessionId = childSessionId
  const ancestors = ancestorsOf(fields.ancestors)
  // A present-but-malformed chain is a refusal, not "no chain".
  if (fields.ancestors !== undefined && ancestors === undefined) return undefined
  if (ancestors !== undefined) {
    if (fields.kind === 'main') return undefined
    // The chain runs from the top-level session down to the direct parent,
    // which is exactly `sessionId`.
    if (ancestors[ancestors.length - 1] !== sessionId) return undefined
    target.ancestors = ancestors
  }
  const workspaceTitle = label(fields.workspaceTitle)
  const sessionTitle = label(fields.sessionTitle)
  const leafLabel = label(fields.leafLabel)
  const path = label(fields.path)
  if (workspaceTitle !== undefined) target.workspaceTitle = workspaceTitle
  if (sessionTitle !== undefined) target.sessionTitle = sessionTitle
  if (leafLabel !== undefined) target.leafLabel = leafLabel
  if (path !== undefined) target.path = path
  return target
}

/**
 * Validate one draft against the current list.
 * @param entries - all existing records, for the name-uniqueness rule.
 * @param draft - the raw values from the dialog.
 * @param excludeId - the record being edited, so it may keep its own name.
 * @returns the validated draft, or the rule that refused it.
 */
export function validateDraft(
  entries: readonly ShortcutEntry[],
  draft: ShortcutDraft,
  excludeId?: string | undefined,
): { ok: true; draft: ValidDraft } | { ok: false; problem: DraftProblem } {
  const name = normalized(draft.name)
  const text = normalized(draft.text)
  const sessionId = normalized(draft.sessionId)
  if (name === undefined || text === undefined || sessionId === undefined) return { ok: false, problem: 'invalid-input' }
  if (name.length > NAME_MAX_LENGTH || text.length > TEXT_MAX_LENGTH) return { ok: false, problem: 'invalid-input' }
  const target = normalizeTarget(draft.target, sessionId)
  if (target === undefined) return { ok: false, problem: 'invalid-input' }
  const key = nameKey(name)
  for (const entry of entries) {
    if (excludeId !== undefined && entry.id === excludeId) continue
    if (nameKey(entry.name) === key) return { ok: false, problem: 'name-taken' }
  }
  return { ok: true, draft: { name, sessionId, target, text } }
}

/** Build the error detail the host puts on the wire. */
export function errorOf(code: ShortcutErrorCode, message: string): ShortcutError {
  return { code, message }
}
