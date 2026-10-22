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

import { LABEL_MAX_LENGTH, NAME_MAX_LENGTH, TARGET_KINDS } from './types.ts'
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
  navigate: boolean
  anySession: boolean
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
  // The name is capped because it is a label; the text is not, because the host's reminder
  // feature accepts a prompt on the single rule "non-empty after trimming" (see types.ts).
  if (name.length > NAME_MAX_LENGTH) return { ok: false, problem: 'invalid-input' }
  const target = normalizeTarget(draft.target, sessionId)
  if (target === undefined) return { ok: false, problem: 'invalid-input' }
  const key = nameKey(name)
  for (const entry of entries) {
    if (excludeId !== undefined && entry.id === excludeId) continue
    if (nameKey(entry.name) === key) return { ok: false, problem: 'name-taken' }
  }
  return {
    ok: true,
    draft: {
      name,
      sessionId,
      target,
      text,
      // Only an explicit `false` turns navigation off; a missing field (an
      // older client, or a record written before the switch existed) is the
      // default: open the target.
      navigate: draft.navigate !== false,
      // Same polarity rule for the any-session switch: only an explicit `true`
      // makes a record session-agnostic, so a draft from an older client stays
      // bound to its own session.
      anySession: draft.anySession === true,
    },
  }
}

/**
 * Longest base a generated name may take, leaving room for a de-duplication suffix inside
 * {@link NAME_MAX_LENGTH}.
 */
const SUGGESTED_NAME_MAX = 40

/**
 * The name a prompt suggests: its first non-empty line, stripped of list/heading markers and
 * surrounding quotes, whitespace-collapsed, and cut on a word boundary.
 * @param text - the prompt.
 * @returns the base name, possibly empty for a blank prompt.
 */
function baseNameOf(text: string): string {
  const firstLine = text.split(/\r?\n/u).map(line => line.trim()).find(line => line.length > 0) ?? ''
  const collapsed = firstLine.replace(/\s+/gu, ' ').trim()
  // A prompt often starts with list or heading markers ("- 重启服务", "## 部署"); those are
  // punctuation about the prompt's shape, not part of the name it suggests. A quoted prompt
  // is stripped at both ends, or the closing quote would survive into the name.
  const stripped = collapsed
    .replace(/^[#>*\-•·"'`“”‘’\s]+/u, '')
    .replace(/["'`“”‘’]+$/u, '')
    .trim()
  // A line that was nothing BUT markers ("- ", "##") names nothing; there are no words in it.
  if (stripped.length === 0) return ''
  const source = stripped
  if (source.length <= SUGGESTED_NAME_MAX) return source
  // Cut on a word boundary when there is one far enough in, so a name does not end mid-word.
  const cut = source.slice(0, SUGGESTED_NAME_MAX)
  const lastSpace = cut.search(/\s\S*$/u)
  return (lastSpace > 10 ? cut.slice(0, lastSpace) : cut).trim()
}

/** Wrappers a title may come dressed in, each with the closer that must pair with it. */
const TITLE_WRAPPERS: readonly (readonly [string, string])[] = [
  ['「', '」'], ['『', '』'], ['（', '）'], ['(', ')'], ['【', '】'], ['[', ']'], ['《', '》'],
  ['"', '"'], ["'", "'"], ['`', '`'], ['“', '”'], ['‘', '’'],
]

/** Leading list/heading markers: punctuation about the answer's shape, not the name. */
const LEADING_MARKERS = /^(?:[#>\-*•·]+\s*)+/u

/** Trailing emphasis markers, which no name ends with on purpose. */
const TRAILING_MARKERS = /[*_~]+$/u

/** Sentence punctuation a title carries but a NAME does not need. */
const TRAILING_PUNCTUATION = /[。．.，,；;：:！!？?、]+$/u

/**
 * Clean a title PROPOSED BY SOMETHING ELSE (the model) into a name.
 *
 * A model answer is untrusted text: it is asked for one line, but may still carry list
 * markers, markdown emphasis, a `标题：` / `Title:` label, quotes, or a trailing full stop.
 * Only the first line is kept, so a chatty reply cannot smuggle a paragraph into a label
 * field, and wrappers are removed only in PAIRS — a name that legitimately ends in `）`
 * (e.g. "重启服务（已改名）") is left alone.
 * @param raw - the proposed title.
 * @returns the cleaned name, possibly empty.
 */
export function cleanName(raw: string): string {
  const firstLine = raw.split(/\r?\n/u).map(line => line.trim()).find(line => line.length > 0) ?? ''
  let text = firstLine.replace(/\s+/gu, ' ').trim()
  // A few passes settle nesting ("**「重启服务」**。"): each strip can expose another.
  for (let pass = 0; pass < 3; pass += 1) {
    const before = text
    text = text
      .replace(/^(?:标题|title)\s*[:：]\s*/iu, '')
      .replace(LEADING_MARKERS, '')
      .replace(TRAILING_MARKERS, '')
      .replace(TRAILING_PUNCTUATION, '')
      .trim()
    for (const [open, close] of TITLE_WRAPPERS) {
      if (text.length > open.length + close.length && text.startsWith(open) && text.endsWith(close)) {
        text = text.slice(open.length, text.length - close.length).trim()
      }
    }
    text = text.replace(TRAILING_PUNCTUATION, '').trim()
    if (text === before) break
  }
  return text.length > NAME_MAX_LENGTH ? text.slice(0, NAME_MAX_LENGTH).trim() : text
}

/**
 * Make a name unique against every other record, as the name rule requires.
 * @param base - the proposed name, already cleaned.
 * @param entries - every existing record.
 * @param excludeId - the record being edited, so it never de-duplicates against itself.
 * @returns the usable name, within {@link NAME_MAX_LENGTH}, or an empty string for an empty base.
 */
export function uniqueName(
  base: string,
  entries: readonly ShortcutEntry[],
  excludeId?: string | undefined,
): string {
  if (base.length === 0) return ''
  const taken = new Set(
    entries.filter(entry => excludeId === undefined || entry.id !== excludeId).map(entry => nameKey(entry.name)),
  )
  if (!taken.has(nameKey(base))) return base
  for (let index = 2; index < 1000; index += 1) {
    const suffix = ` ${index}`
    const room = NAME_MAX_LENGTH - suffix.length
    const candidate = `${base.slice(0, room).trim()}${suffix}`
    if (!taken.has(nameKey(candidate))) return candidate
  }
  return base.slice(0, NAME_MAX_LENGTH)
}

/**
 * Turn a model-proposed title into a usable name: clean it, then make it unique.
 * @param title - the model's answer.
 * @param entries - every existing record.
 * @param excludeId - the record being edited.
 * @returns the name, or an empty string when the answer had no words in it.
 */
export function nameFromTitle(
  title: string,
  entries: readonly ShortcutEntry[],
  excludeId?: string | undefined,
): string {
  return uniqueName(cleanName(title), entries, excludeId)
}

/**
 * Suggest a name for a record from its prompt with the DETERMINISTIC rule.
 *
 * This is what the dialog falls back to when the model is unavailable or its answer is
 * useless, so the result must be immediately savable: trimmed, unique against every other
 * record (case-insensitively, as the name rule is), and within {@link NAME_MAX_LENGTH}. A
 * collision appends ` 2`, ` 3` … rather than answering a taken name the dialog would refuse.
 * @param text - the prompt to name.
 * @param entries - every existing record, for the uniqueness check.
 * @param excludeId - the record being edited, so it never de-duplicates against itself.
 * @returns the suggestion, or an empty string when the prompt has no words in it.
 */
export function suggestName(
  text: string,
  entries: readonly ShortcutEntry[],
  excludeId?: string | undefined,
): string {
  return uniqueName(baseNameOf(text), entries, excludeId)
}

/** Build the error detail the host puts on the wire. */
export function errorOf(code: ShortcutErrorCode, message: string): ShortcutError {
  return { code, message }
}
