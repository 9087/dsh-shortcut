/**
 * Grouping for the shortcut menu.
 *
 * The card lists every record; once several sessions are in play that is a flat list the
 * reader has to scan for the one shortcut belonging to the conversation in front of them.
 * This module splits the records into three groups, drawn in this order:
 *
 * 1. `current` — bound to the session the page is SHOWING (the fact the bubble button
 *    already reads, see `session-bridge.ts`);
 * 2. `any` — records marked "sendable to any session", which deliver to whatever session is
 *    shown when they are triggered;
 * 3. `other` — everything else.
 *
 * The grouping is flat heading rows inside one always-open card, not a collapsible tree: a
 * heading is a `MenuLabel` entry, which the shell draws as a non-interactive
 * `role="presentation"` row in its tertiary label color. "Always expanded" therefore needs
 * no state — there is nothing here to open or close.
 *
 * A heading is drawn only for a group that actually has rows: a heading with nothing under
 * it reads as a broken list. With no session view mounted (the Settings page, or a shell
 * that hands the seat nothing) there is no "current session" to separate and no heading is
 * drawn at all — a lone "Other sessions" over every record would be noise.
 *
 * @module dsh-shortcut/client/menu-groups
 */

import type { MenuEntry, MenuItem } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ShortcutEntry } from '../types.ts'
import type { Translate } from './locale.ts'

/** Which group a record belongs to. */
export type ShortcutGroupTitle = 'current' | 'any' | 'other'

/** The records split by the session on screen. */
export interface ShortcutMenuGroups {
  /** Whether group headings carry meaning for this list (a session view is mounted). */
  headings: boolean
  /** Records bound to the session on screen, in store order. */
  current: readonly ShortcutEntry[]
  /** Records that deliver wherever the reader is, independent of the session on screen. */
  anySession: readonly ShortcutEntry[]
  /** Every remaining record, in store order. */
  other: readonly ShortcutEntry[]
}

/**
 * Split records by the session the page is showing.
 *
 * A bound record's OWNING session decides its group, so a shortcut that addresses a
 * subagent or a team member of the current session still counts as "this session". An
 * any-session record never joins either session group, because it is not addressed to one.
 * @param entries - every record, in store order.
 * @param currentSessionId - the shown session, or undefined when no session view is up.
 * @returns the three groups, with `headings` false when there is nothing to separate.
 */
export function groupShortcuts(
  entries: readonly ShortcutEntry[],
  currentSessionId: string | undefined,
): ShortcutMenuGroups {
  if (currentSessionId === undefined || currentSessionId.length === 0) {
    // One flat list: with no session on screen neither session group means anything and an
    // any-session record is not special either. Store order is the only sane rule.
    return { headings: false, current: [], anySession: [], other: entries }
  }
  const current: ShortcutEntry[] = []
  const anySession: ShortcutEntry[] = []
  const other: ShortcutEntry[] = []
  for (const entry of entries) {
    if (entry.anySession) anySession.push(entry)
    else if (entry.sessionId === currentSessionId) current.push(entry)
    else other.push(entry)
  }
  return { headings: true, current, anySession, other }
}

/** The selectable row for one record. */
function rowOf(entry: ShortcutEntry): MenuItem {
  return { id: entry.id, label: entry.name }
}

/** One heading row, in the shell's own heading style (lighter, non-interactive). */
function headingOf(title: ShortcutGroupTitle, t: Translate): MenuEntry {
  const key = title === 'current'
    ? 'menu.currentSession'
    : title === 'any' ? 'menu.anySession' : 'menu.otherSessions'
  return { type: 'label', id: `group-${title}`, text: t(key) }
}

/**
 * The heading plus the rows of one group, or nothing when the group is empty.
 * @param entries - the group's records.
 * @param title - which group this is, for the heading id and its dictionary key.
 * @param t - plugin translator.
 * @param withHeading - whether headings are drawn at all for this list.
 * @returns the rows to draw, heading first.
 */
function groupRows(
  entries: readonly ShortcutEntry[],
  title: ShortcutGroupTitle,
  t: Translate,
  withHeading: boolean,
): MenuEntry[] {
  if (entries.length === 0) return []
  const rows = entries.map(rowOf)
  return withHeading ? [headingOf(title, t), ...rows] : rows
}

/**
 * Flatten the groups into the menu's data rows: current, then any-session, then the rest.
 *
 * Callers append whatever footer rows they own (the About entry, behind its separator);
 * this function owns only the record rows and their headings.
 * @param groups - the split produced by {@link groupShortcuts}.
 * @param t - plugin translator.
 * @returns the record rows in draw order.
 */
export function shortcutRows(groups: ShortcutMenuGroups, t: Translate): MenuEntry[] {
  return [
    ...groupRows(groups.current, 'current', t, groups.headings),
    ...groupRows(groups.anySession, 'any', t, groups.headings),
    ...groupRows(groups.other, 'other', t, groups.headings),
  ]
}
