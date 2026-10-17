/** Draft validation: the rules the dialog's disabled state and the host share. */
import { describe, expect, it } from 'vitest'
import { nameKey, validateDraft } from '../src/share.ts'
import type { ShortcutEntry } from '../src/types.ts'

/** One stored record, filled enough for the rules under test. */
function entry(overrides: Partial<ShortcutEntry>): ShortcutEntry {
  return {
    id: 'id-1',
    name: '重启服务',
    sessionId: 'session-a',
    text: '重启',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('nameKey', () => {
  it('trims and folds case', () => {
    expect(nameKey('  Reboot  ')).toBe('reboot')
    expect(nameKey('重启服务')).toBe('重启服务')
  })
})

describe('validateDraft', () => {
  it('accepts a complete draft and normalizes its strings', () => {
    const result = validateDraft([], { name: '  重启服务 ', sessionId: ' session-a ', text: '  重启  ' })
    expect(result).toEqual({ ok: true, draft: { name: '重启服务', sessionId: 'session-a', text: '重启' } })
  })

  it('refuses blank name, session and text', () => {
    expect(validateDraft([], { name: ' ', sessionId: 's', text: 'x' })).toEqual({ ok: false, problem: 'invalid-input' })
    expect(validateDraft([], { name: 'n', sessionId: '', text: 'x' })).toEqual({ ok: false, problem: 'invalid-input' })
    expect(validateDraft([], { name: 'n', sessionId: 's', text: '   ' })).toEqual({ ok: false, problem: 'invalid-input' })
  })

  it('refuses overlong values', () => {
    expect(validateDraft([], { name: 'n'.repeat(61), sessionId: 's', text: 'x' })).toEqual({ ok: false, problem: 'invalid-input' })
    expect(validateDraft([], { name: 'n', sessionId: 's', text: 'x'.repeat(20_001) })).toEqual({ ok: false, problem: 'invalid-input' })
  })

  it('refuses a name another record already owns, case-insensitively', () => {
    const entries = [entry({ id: 'a', name: 'Reboot' })]
    expect(validateDraft(entries, { name: 'reboot', sessionId: 's', text: 'x' })).toEqual({ ok: false, problem: 'name-taken' })
    expect(validateDraft(entries, { name: ' reboot ', sessionId: 's', text: 'x' })).toEqual({ ok: false, problem: 'name-taken' })
  })

  it('lets the edited record keep its own name', () => {
    const entries = [entry({ id: 'a', name: 'Reboot' })]
    const result = validateDraft(entries, { name: 'Reboot', sessionId: 's', text: 'x' }, 'a')
    expect(result.ok).toBe(true)
  })

  it('still refuses another record\'s name while editing', () => {
    const entries = [entry({ id: 'a', name: 'Alpha' }), entry({ id: 'b', name: 'Beta' })]
    expect(validateDraft(entries, { name: 'beta', sessionId: 's', text: 'x' }, 'a')).toEqual({ ok: false, problem: 'name-taken' })
  })
})
