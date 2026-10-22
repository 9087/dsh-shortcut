/** Draft validation: the rules the dialog's disabled state and the host share. */
import { describe, expect, it } from 'vitest'
import {
  cleanName, hasCjk, isCjkDominant, languageMismatch, languageTagOf, nameFromTitle, nameKey, normalizeTarget,
  suggestName, validateDraft,
} from '../src/share.ts'
import type { ShortcutEntry, ShortcutTarget } from '../src/types.ts'

/** One stored record, filled enough for the rules under test. */
function entry(overrides: Partial<ShortcutEntry>): ShortcutEntry {
  return {
    id: 'id-1',
    name: '重启服务',
    sessionId: 'session-a',
    target: { kind: 'main' },
    text: '重启',
    navigate: true,
    anySession: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

/** A complete main-agent draft. */
function draft(overrides: Record<string, unknown> = {}): { name: string; sessionId: string; target: unknown; text: string; navigate?: boolean } {
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
      draft: {
        name: '重启服务',
        sessionId: 'session-a',
        target: { kind: 'main' },
        text: '重启',
        navigate: true,
        anySession: false,
      },
    })
  })

  it('defaults any-session off, and keeps an explicit on', () => {
    const off = validateDraft([], draft())
    expect(off.ok && (off as { draft: { anySession: boolean } }).draft.anySession).toBe(false)
    // Only an explicit `true` makes a record session-agnostic; anything else is the bound
    // default, which is what an older client (no field at all) must keep getting.
    const on = validateDraft([], draft({ anySession: true }))
    expect(on.ok && (on as { draft: { anySession: boolean } }).draft.anySession).toBe(true)
  })

  it('defaults navigation on, and keeps an explicit off', () => {
    expect(validateDraft([], draft()).ok && (validateDraft([], draft()) as { draft: { navigate: boolean } }).draft.navigate).toBe(true)
    const off = validateDraft([], draft({ navigate: false }))
    expect(off.ok && (off as { draft: { navigate: boolean } }).draft.navigate).toBe(false)
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
        navigate: true,
        anySession: false,
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

  it('refuses an overlong name but accepts text of any length', () => {
    expect(validateDraft([], draft({ name: 'n'.repeat(61) }))).toEqual({ ok: false, problem: 'invalid-input' })
    // No text cap: the host's reminder prompt has none either, so refusing here would
    // reject text the rest of the product accepts.
    const long = validateDraft([], draft({ text: 'x'.repeat(20_001) }))
    expect(long.ok).toBe(true)
    expect(long.ok && long.draft.text.length).toBe(20_001)
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

describe('suggestName', () => {
  it('uses the first non-empty line, whitespace collapsed', () => {
    expect(suggestName('重启服务：请重启 dev 服务', [])).toBe('重启服务：请重启 dev 服务')
    expect(suggestName('   \n\n  重启服务   马上  \n第二行不该用 ', [])).toBe('重启服务 马上')
  })

  it('drops the markers a prompt often starts with', () => {
    expect(suggestName('## 部署到测试环境', [])).toBe('部署到测试环境')
    expect(suggestName('- 整理本周发布说明', [])).toBe('整理本周发布说明')
    expect(suggestName('"重启服务"', [])).toBe('重启服务')
    expect(suggestName('# \n', [])).toBe('')
  })

  it('answers nothing for a blank prompt, so the action stays inert', () => {
    expect(suggestName('', [])).toBe('')
    expect(suggestName('   \n\t ', [])).toBe('')
  })

  it('cuts a long first line on a word boundary, inside the name cap', () => {
    const suggested = suggestName('deploy the service to the staging cluster and verify it', [])
    expect(suggested.length).toBeLessThanOrEqual(40)
    expect(suggested).toBe('deploy the service to the staging')
  })

  it('de-duplicates against the records that already exist', () => {
    const entries = [entry({ id: 'a', name: '重启服务' })]
    expect(suggestName('重启服务，请重启 dev 服务', entries)).toBe('重启服务，请重启 dev 服务')
    expect(suggestName('重启服务', entries)).toBe('重启服务 2')
    expect(suggestName('重启服务', [entry({ id: 'a', name: '重启服务' }), entry({ id: 'b', name: '重启服务 2' })]))
      .toBe('重启服务 3')
  })

  it('never de-duplicates against the record being edited', () => {
    const entries = [entry({ id: 'a', name: '重启服务' })]
    expect(suggestName('重启服务', entries, 'a')).toBe('重启服务')
  })

  it('keeps a long de-duplicated name inside the cap', () => {
    const base = 'deploy the service to the staging cluster'
    const firstCut = suggestName(base, [])
    const entries = [entry({ id: 'a', name: firstCut })]
    const suggested = suggestName(base, entries)
    expect(suggested.length).toBeLessThanOrEqual(60)
    expect(suggested.endsWith(' 2')).toBe(true)
  })
})

describe('cleanName', () => {
  it('strips the chrome a model wraps a title in', () => {
    expect(cleanName('"重启服务。"')).toBe('重启服务')
    expect(cleanName('标题：部署到测试环境')).toBe('部署到测试环境')
    expect(cleanName('Title: Deploy to staging.')).toBe('Deploy to staging')
    expect(cleanName('**生成发布检查单**')).toBe('生成发布检查单')
  })

  it('keeps only the first non-empty line, so a chatty answer cannot fill the field', () => {
    expect(cleanName('\n\n重启服务\n这是因为……')).toBe('重启服务')
  })

  it('answers nothing when the answer has no words in it', () => {
    expect(cleanName('')).toBe('')
    expect(cleanName('  "。"  ')).toBe('')
  })

  it('stays inside the name cap', () => {
    expect(cleanName('n'.repeat(200)).length).toBeLessThanOrEqual(60)
  })
})

describe('nameFromTitle', () => {
  it('cleans the title and makes it unique against the other records', () => {
    const entries = [entry({ id: 'a', name: '重启服务' })]
    expect(nameFromTitle('「重启服务」。', entries)).toBe('重启服务 2')
  })

  it('never de-duplicates against the record being edited', () => {
    const entries = [entry({ id: 'a', name: '重启服务' })]
    expect(nameFromTitle('重启服务', entries, 'a')).toBe('重启服务')
  })
})

describe('language constraint', () => {
  it('recognises the CJK scripts and nothing else', () => {
    expect(hasCjk('请重启服务')).toBe(true)
    expect(hasCjk('再起動して')).toBe(true)
    expect(hasCjk('재시작')).toBe(true)
    expect(hasCjk('restart dev')).toBe(false)
    expect(hasCjk('1234 !!!')).toBe(false)
  })

  it('decides the family by the DOMINANT script, not by a stray word', () => {
    // A Chinese prompt that borrows English tech words is still Chinese.
    expect(isCjkDominant('请重启 dev 服务')).toBe(true)
    expect(isCjkDominant('帮我 review 这个 PR，看看有没有内存泄漏')).toBe(true)
    // An English prompt that mentions one Chinese name is still English.
    expect(isCjkDominant('add a retry to the 微信 upload client')).toBe(false)
    // One CJK character is never a language signal.
    expect(isCjkDominant('restart 啊')).toBe(false)
  })

  it('pins the language tag only for a CJK text', () => {
    expect(languageTagOf('请重启 dev 服务')).toBe('zh')
    // Kana wins over Han: Japanese prose contains Han characters too.
    expect(languageTagOf('再起動して、確認する')).toBe('ja')
    expect(languageTagOf('재시작하고 확인')).toBe('ko')
    // Latin/Cyrillic do not decide a language: the model is told to mirror instead.
    expect(languageTagOf('restart the dev service')).toBeUndefined()
    expect(languageTagOf('перезапустить сервис')).toBeUndefined()
    // A Latin-dominant prompt is not pinned to Chinese by a borrowed word.
    expect(languageTagOf('add a retry to the 微信 upload client')).toBeUndefined()
  })

  it('treats an answer in the other family as a mismatch', () => {
    // A Chinese prompt titled in the instructions' own language is the failure this guards.
    expect(languageMismatch('请重启 dev 服务', 'Restart the dev service')).toBe(true)
    expect(languageMismatch('restart the dev service', '重启 dev 服务')).toBe(true)
  })

  it('allows mixed titles, which still carry the prompt\'s own script', () => {
    expect(languageMismatch('请重启 dev 服务', '重启 dev 服务')).toBe(false)
    expect(languageMismatch('restart the dev service', 'Restart dev service')).toBe(false)
  })

  it('does not judge a Latin-dominant prompt that merely mentions a CJK name', () => {
    expect(languageMismatch('add a retry to the 微信 upload client', 'Add upload retry')).toBe(false)
  })
})
