/**
 * Draft rules shared by both halves, so the dialog's disabled state and the
 * host's acceptance can never disagree.
 *
 * The host is still authoritative (two browser tabs can race), but the browser
 * asks the same questions to enable/disable its confirm button, which is what
 * keeps "the button looked enabled but the host refused" from happening.
 *
 * @module dsh-shortcut/share
 */

import { NAME_MAX_LENGTH, TEXT_MAX_LENGTH } from './types.ts'
import type { ShortcutDraft, ShortcutEntry, ShortcutError, ShortcutErrorCode } from './types.ts'

/** Trim and reject anything that is not a usable string. */
export function normalized(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
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
  text: string
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
  const key = nameKey(name)
  for (const entry of entries) {
    if (excludeId !== undefined && entry.id === excludeId) continue
    if (nameKey(entry.name) === key) return { ok: false, problem: 'name-taken' }
  }
  return { ok: true, draft: { name, sessionId, text } }
}

/** Build the error detail the host puts on the wire. */
export function errorOf(code: ShortcutErrorCode, message: string): ShortcutError {
  return { code, message }
}
