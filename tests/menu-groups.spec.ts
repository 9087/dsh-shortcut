/** The shortcut menu's grouping: the current session first, any-session records next, the rest last. */
import { describe, expect, it } from 'vitest'
import { groupShortcuts, shortcutRows } from '../src/client/menu-groups.ts'
import type { MenuEntry, MenuItem } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ShortcutEntry } from '../src/types.ts'
import type { Translate } from '../src/client/locale.ts'

/** A stored record, only as complete as the grouping reads it. */
function entry(id: string, sessionId: string, name = id, anySession = false): ShortcutEntry {
  return {
    id,
    name,
    sessionId,
    text: `text of ${id}`,
    navigate: true,
    anySession,
    target: { kind: 'main' },
    createdAt: 0,
    updatedAt: 0,
  }
}

/** A translator that answers the group keys with their own names. */
const t = ((key: string) => `t:${key}`) as Translate

/** The ids of a rendered row list, in draw order ('--<heading id>' for a heading, 'sep' for a separator). */
function shapeOf(rows: readonly MenuEntry[]): string[] {
  return rows.map((row) => {
    if ('type' in row && row.type === 'separator') return 'sep'
    if ('type' in row && row.type === 'label') return `--${row.id}`
    return row.id
  })
}

/** The heading rows of a rendered list, in draw order. */
function headingsOf(rows: readonly MenuEntry[]): string[] {
  return rows
    .filter((row): row is MenuEntry & { type: 'label'; text: string } => 'type' in row && row.type === 'label')
    .map(row => row.text)
}

/** The selectable rows of a rendered list, in draw order. */
function rowsOf(rows: readonly MenuEntry[]): MenuItem[] {
  return rows.filter((row): row is MenuItem => !('type' in row))
}

describe('groupShortcuts', () => {
  it('splits records by the session on screen, keeping store order inside each group', () => {
    const entries = [entry('a1', 'A'), entry('b1', 'B'), entry('a2', 'A'), entry('c1', 'C')]
    const groups = groupShortcuts(entries, 'A')
    expect(groups.headings).toBe(true)
    expect(groups.current.map(item => item.id)).toEqual(['a1', 'a2'])
    expect(groups.other.map(item => item.id)).toEqual(['b1', 'c1'])
  })

  it('counts a subagent or team-member target as its owning session', () => {
    const child = entry('a1', 'A')
    child.target = { kind: 'subagent', childSessionId: 'child-of-A' }
    const groups = groupShortcuts([child], 'A')
    expect(groups.current.map(item => item.id)).toEqual(['a1'])
    expect(groups.other).toEqual([])
  })

  it('gives an any-session record its own group, never a session group', () => {
    // Even when the record was captured from the session on screen: the switch says it is
    // not addressed to that session any more, so it must not read as belonging to it.
    const groups = groupShortcuts([entry('any1', 'A', 'any1', true), entry('a1', 'A')], 'A')
    expect(groups.anySession.map(item => item.id)).toEqual(['any1'])
    expect(groups.current.map(item => item.id)).toEqual(['a1'])
    expect(groups.other).toEqual([])
  })

  it('keeps everything in one group, with no headings, when no session view is mounted', () => {
    const entries = [entry('a1', 'A'), entry('any1', 'A', 'any1', true), entry('b1', 'B')]
    const groups = groupShortcuts(entries, undefined)
    expect(groups.headings).toBe(false)
    expect(groups.current).toEqual([])
    expect(groups.anySession).toEqual([])
    // Store order, unbroken: with no session on screen no group means anything.
    expect(groups.other.map(item => item.id)).toEqual(['a1', 'any1', 'b1'])
  })

  it('treats an empty session id like no session, not like a session that matches nothing', () => {
    const entries = [entry('a1', 'A')]
    const groups = groupShortcuts(entries, '')
    expect(groups.headings).toBe(false)
    expect(groups.other.map(item => item.id)).toEqual(['a1'])
  })

  it('answers three empty groups for an empty store', () => {
    const groups = groupShortcuts([], 'A')
    expect(groups.headings).toBe(true)
    expect(groups.current).toEqual([])
    expect(groups.anySession).toEqual([])
    expect(groups.other).toEqual([])
  })
})

describe('shortcutRows', () => {
  it('draws current FIRST, then any-session, then the rest', () => {
    const rows = shortcutRows(
      groupShortcuts([entry('b1', 'B'), entry('any1', 'B', 'any1', true), entry('a1', 'A')], 'A'),
      t,
    )
    expect(shapeOf(rows)).toEqual(['--group-current', 'a1', '--group-any', 'any1', '--group-other', 'b1'])
    expect(headingsOf(rows)).toEqual([
      't:menu.currentSession',
      't:menu.anySession',
      't:menu.otherSessions',
    ])
  })

  it('omits the heading of an empty group rather than drawing a heading over nothing', () => {
    // No record belongs to the shown session: no current heading, the other two stay.
    const noCurrent = shortcutRows(groupShortcuts([entry('b1', 'B'), entry('any1', 'B', 'any1', true)], 'A'), t)
    expect(shapeOf(noCurrent)).toEqual(['--group-any', 'any1', '--group-other', 'b1'])

    // No any-session record: that heading is the one left out.
    const noAny = shortcutRows(groupShortcuts([entry('a1', 'A'), entry('b1', 'B')], 'A'), t)
    expect(shapeOf(noAny)).toEqual(['--group-current', 'a1', '--group-other', 'b1'])

    // Every record belongs to it: only the current group is drawn.
    const onlyCurrent = shortcutRows(groupShortcuts([entry('a1', 'A')], 'A'), t)
    expect(shapeOf(onlyCurrent)).toEqual(['--group-current', 'a1'])
  })

  it('draws no heading at all without a session view, but keeps every record', () => {
    const rows = shortcutRows(
      groupShortcuts([entry('a1', 'A'), entry('any1', 'A', 'any1', true)], undefined),
      t,
    )
    expect(headingsOf(rows)).toEqual([])
    expect(rowsOf(rows).map(row => row.id)).toEqual(['a1', 'any1'])
  })

  it('keeps every record row selectable and labelled with its name', () => {
    const rows = shortcutRows(groupShortcuts([entry('a1', 'A', 'Restart the dev service')], 'A'), t)
    expect(rowsOf(rows)).toEqual([{ id: 'a1', label: 'Restart the dev service' }])
  })

  it('draws nothing for an empty store', () => {
    expect(shortcutRows(groupShortcuts([], 'A'), t)).toEqual([])
  })

  it('gives every heading a stable id, so two openings cannot collide', () => {
    const rows = shortcutRows(
      groupShortcuts([entry('a1', 'A'), entry('any1', 'A', 'any1', true), entry('b1', 'B')], 'A'),
      t,
    )
    const ids = rows.map(row => row.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
