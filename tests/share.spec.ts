/** Draft validation: the rules the dialog's disabled state and the host share. */
import { describe, expect, it } from 'vitest'
import { nameKey, normalizeTarget, validateDraft } from '../src/share.ts'
import type { ShortcutEntry, ShortcutTarget } from '../src/types.ts'

/** One stored record, filled enough for the rules under test. */
function entry(overrides: Partial<ShortcutEntry>): ShortcutEntry {
  return {
    id: 'id-1',
    name: '重启服务',
    sessionId: 'session-a',
    target: { kind: 'main' },
    text: '重启',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

/** A complete main-agent draft. */
function draft(overrides: Record<string, unknown> = {}): { name: string; sessionId: string; target: unknown; text: string } {
  return { name: 'n', sessionId: 's', target: { kind: 'main' as const }, text: 'x', ...overrides }
}

describe('nameKey', () => {
  it('trims and folds case', () => {
    expect(nameKey('  Reboot  ')).toBe('reboot')
    expect(nameKey('重启服务')).toBe('重启服务')
  })
})

describe('normalizeTarget', () => {
  it('accepts the main agent and drops optional labels when blank', () => {
    expect(normalizeTarget({ kind: 'main' }, 's')).toEqual({ kind: 'main' })
  })

  it('refuses a child id on a main target', () => {
    expect(normalizeTarget({ kind: 'main', childSessionId: 'c' }, 's')).toBeUndefined()
  })

  it('requires a child id for subagent and member targets, distinct from the session', () => {
    expect(normalizeTarget({ kind: 'subagent' }, 's')).toBeUndefined()
    expect(normalizeTarget({ kind: 'member' }, 's')).toBeUndefined()
    expect(normalizeTarget({ kind: 'subagent', childSessionId: 's' }, 's')).toBeUndefined()
    expect(normalizeTarget({ kind: 'subagent', childSessionId: 'child-x' }, 's')).toEqual({ kind: 'subagent', childSessionId: 'child-x' })
    expect(normalizeTarget({ kind: 'member', childSessionId: ' child-y ' }, 's')).toEqual({ kind: 'member', childSessionId: 'child-y' })
  })

  it('carries an ancestor chain only for a child target, ending at the owning session', () => {
    expect(normalizeTarget({ kind: 'subagent', childSessionId: 'child-x', ancestors: ['root-1', 's'] }, 's')).toEqual({
      kind: 'subagent', childSessionId: 'child-x', ancestors: ['root-1', 's'],
    })
    // The chain must end at the direct parent session and be non-empty/unique.
    expect(normalizeTarget({ kind: 'subagent', childSessionId: 'child-x', ancestors: ['root-1'] }, 's')).toBeUndefined()
    expect(normalizeTarget({ kind: 'subagent', childSessionId: 'child-x', ancestors: ['s', 's'] }, 's')).toBeUndefined()
    expect(normalizeTarget({ kind: 'subagent', childSessionId: 'child-x', ancestors: [] }, 's')).toBeUndefined()
    // A main-agent target has no ancestor chain.
    expect(normalizeTarget({ kind: 'main', ancestors: ['s'] }, 's')).toBeUndefined()
  })

  it('refuses an unknown kind and non-objects', () => {
    expect(normalizeTarget({ kind: 'fork', childSessionId: 'c' }, 's')).toBeUndefined()
    expect(normalizeTarget(undefined, 's')).toBeUndefined()
    expect(normalizeTarget([], 's')).toBeUndefined()
  })

  it('trims labels and caps them at the label limit', () => {
    const target = normalizeTarget({ kind: 'main', path: `  ${'p'.repeat(500)}  ` }, 's')
    expect(target?.path).toHaveLength(400)
    expect(normalizeTarget({ kind: 'member', childSessionId: 'c', leafLabel: '  writer ' }, 's')).toEqual({
      kind: 'member',
      childSessionId: 'c',
      leafLabel: 'writer',
    })
  })
})

describe('validateDraft', () => {
  it('accepts a complete draft and normalizes its strings', () => {
    const result = validateDraft([], draft({ name: '  重启服务 ', sessionId: ' session-a ', text: '  重启  ' }))
    expect(result).toEqual({
      ok: true,
      draft: { name: '重启服务', sessionId: 'session-a', target: { kind: 'main' }, text: '重启' },
    })
  })

  it('normalizes a child target end to end', () => {
    const target: ShortcutTarget = { kind: 'member', childSessionId: ' child-1 ', leafLabel: ' writer ', ancestors: [' session-a '] }
    const result = validateDraft([], draft({ sessionId: ' session-a ', target }))
    expect(result).toEqual({
      ok: true,
      draft: {
        name: 'n',
        sessionId: 'session-a',
        target: { kind: 'member', childSessionId: 'child-1', leafLabel: 'writer', ancestors: ['session-a'] },
        text: 'x',
      },
    })
  })

  it('refuses an invalid target', () => {
    expect(validateDraft([], draft({ target: { kind: 'subagent' } }))).toEqual({ ok: false, problem: 'invalid-input' })
    expect(validateDraft([], draft({ target: { kind: 'main', childSessionId: 'c' } }))).toEqual({ ok: false, problem: 'invalid-input' })
    expect(validateDraft([], draft({ target: undefined }))).toEqual({ ok: false, problem: 'invalid-input' })
  })

  it('refuses blank name, session and text', () => {
    expect(validateDraft([], draft({ name: ' ' }))).toEqual({ ok: false, problem: 'invalid-input' })
    expect(validateDraft([], draft({ sessionId: '' }))).toEqual({ ok: false, problem: 'invalid-input' })
    expect(validateDraft([], draft({ text: '   ' }))).toEqual({ ok: false, problem: 'invalid-input' })
  })

  it('refuses overlong values', () => {
    expect(validateDraft([], draft({ name: 'n'.repeat(61) }))).toEqual({ ok: false, problem: 'invalid-input' })
    expect(validateDraft([], draft({ text: 'x'.repeat(20_001) }))).toEqual({ ok: false, problem: 'invalid-input' })
  })

  it('refuses a name another record already owns, case-insensitively', () => {
    const entries = [entry({ id: 'a', name: 'Reboot' })]
    expect(validateDraft(entries, draft({ name: 'reboot' }))).toEqual({ ok: false, problem: 'name-taken' })
    expect(validateDraft(entries, draft({ name: ' reboot ' }))).toEqual({ ok: false, problem: 'name-taken' })
  })

  it('lets the edited record keep its own name', () => {
    const entries = [entry({ id: 'a', name: 'Reboot' })]
    const result = validateDraft(entries, draft({ name: 'Reboot' }), 'a')
    expect(result.ok).toBe(true)
  })

  it('still refuses another record\'s name while editing', () => {
    const entries = [entry({ id: 'a', name: 'Alpha' }), entry({ id: 'b', name: 'Beta' })]
    expect(validateDraft(entries, draft({ name: 'beta' }), 'a')).toEqual({ ok: false, problem: 'name-taken' })
  })
})
