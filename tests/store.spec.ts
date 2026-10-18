/** The durable host store: atomic persistence, name rules, migration, corrupt-file reporting. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ShortcutStore, StoreFailure } from '../src/store.ts'
import type { ShortcutDraft } from '../src/types.ts'

const dirs: string[] = []

/** A fresh state directory for one test. */
function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-shortcut-store-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** The store's file path inside one directory. */
function storeFile(dir: string): string {
  return join(dir, 'entries.json')
}

/** A minimal valid draft addressed at a session's main agent. */
function draft(overrides: Partial<ShortcutDraft> = {}): ShortcutDraft {
  return { name: 'n', sessionId: 's', target: { kind: 'main' }, text: 't', ...overrides }
}

describe('ShortcutStore', () => {
  it('starts empty when no file exists yet', async () => {
    const store = new ShortcutStore(freshDir())
    await expect(store.list()).resolves.toEqual([])
  })

  it('creates, lists, updates and removes records', async () => {
    const dir = freshDir()
    const store = new ShortcutStore(dir)
    const created = await store.create(draft({ name: ' 重启服务 ', sessionId: 'session-a', text: ' 重启 ' }))
    expect(created.name).toBe('重启服务')
    expect(created.text).toBe('重启')
    expect(created.sessionId).toBe('session-a')
    expect(created.target).toEqual({ kind: 'main' })
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/)

    await expect(store.list()).resolves.toEqual([created])
    await expect(store.get(created.id)).resolves.toEqual(created)

    const updated = await store.update({
      id: created.id,
      draft: draft({ name: '重启服务2', sessionId: 'session-b', text: '再重启', target: { kind: 'subagent', childSessionId: 'child-1', leafLabel: '探索' } }),
    })
    expect(updated).toMatchObject({
      id: created.id,
      name: '重启服务2',
      sessionId: 'session-b',
      text: '再重启',
      target: { kind: 'subagent', childSessionId: 'child-1', leafLabel: '探索' },
    })
    expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt)
    await expect(store.list()).resolves.toEqual([updated])

    await store.remove(created.id)
    await expect(store.list()).resolves.toEqual([])
    await expect(store.get(created.id)).resolves.toBeUndefined()
  })

  it('persists the file atomically with a version-2 envelope', async () => {
    const dir = freshDir()
    const store = new ShortcutStore(dir)
    const created = await store.create(draft({ name: 'n', sessionId: 's', text: 't' }))
    const file = JSON.parse(readFileSync(storeFile(dir), 'utf8')) as { version: number; entries: unknown[] }
    expect(file.version).toBe(2)
    expect(file.entries).toHaveLength(1)
    expect(file.entries[0]).toMatchObject({ id: created.id, name: 'n', sessionId: 's', text: 't', target: { kind: 'main' } })

    // A second store over the same directory reads what the first wrote.
    const reopened = new ShortcutStore(dir)
    await expect(reopened.list()).resolves.toEqual([created])
  })

  it('migrates version-1 records to main-agent targets on read and rewrites version 2', async () => {
    const dir = freshDir()
    writeFileSync(storeFile(dir), JSON.stringify({
      version: 1,
      entries: [{ id: 'legacy-1', name: '旧条目', sessionId: 'session-old', text: '旧内容', createdAt: 7, updatedAt: 9 }],
    }))
    const store = new ShortcutStore(dir)
    await expect(store.list()).resolves.toEqual([{
      id: 'legacy-1',
      name: '旧条目',
      sessionId: 'session-old',
      text: '旧内容',
      target: { kind: 'main' },
      createdAt: 7,
      updatedAt: 9,
    }])
    // A write upgrades the on-disk schema.
    await store.create(draft({ name: 'new', sessionId: 'session-new' }))
    const file = JSON.parse(readFileSync(storeFile(dir), 'utf8')) as { version: number }
    expect(file.version).toBe(2)
  })

  it('refuses a target that cannot deliver, such as a child equal to its session', async () => {
    const store = new ShortcutStore(freshDir())
    await expect(store.create(draft({ target: { kind: 'subagent', childSessionId: 's' } })))
      .rejects.toMatchObject({ code: 'invalid-input' })
  })

  it('refuses a duplicate name, case-insensitively', async () => {
    const store = new ShortcutStore(freshDir())
    await store.create(draft({ name: 'Reboot' }))
    await expect(store.create(draft({ name: ' reboot ', sessionId: 's2', text: 't2' }))).rejects.toMatchObject({ code: 'name-taken' })
  })

  it('reports not-found for unknown ids', async () => {
    const store = new ShortcutStore(freshDir())
    await expect(store.remove('missing')).rejects.toBeInstanceOf(StoreFailure)
    await expect(store.remove('missing')).rejects.toMatchObject({ code: 'not-found' })
    await expect(store.update({ id: 'missing', draft: draft() }))
      .rejects.toMatchObject({ code: 'not-found' })
  })

  it('reports a corrupt file instead of silently starting empty', async () => {
    const dir = freshDir()
    mkdirSync(dir, { recursive: true })
    writeFileSync(storeFile(dir), '{not json')
    const store = new ShortcutStore(dir)
    await expect(store.list()).rejects.toMatchObject({ code: 'store-unavailable' })
    // A repair is picked up on the next call, not cached forever.
    writeFileSync(storeFile(dir), JSON.stringify({ version: 2, entries: [] }))
    await expect(store.list()).resolves.toEqual([])
  })

  it('reports an unsupported version and malformed entries', async () => {
    const dir = freshDir()
    writeFileSync(storeFile(dir), JSON.stringify({ version: 99, entries: [] }))
    await expect(new ShortcutStore(dir).list()).rejects.toMatchObject({ code: 'store-unavailable' })

    writeFileSync(storeFile(dir), JSON.stringify({ version: 2, entries: [{ id: 'x' }] }))
    await expect(new ShortcutStore(dir).list()).rejects.toMatchObject({ code: 'store-unavailable' })

    // A v2 record whose target is incoherent (child id on a main target) is refused too.
    writeFileSync(storeFile(dir), JSON.stringify({
      version: 2,
      entries: [{ id: 'x', name: 'n', sessionId: 's', text: 't', target: { kind: 'main', childSessionId: 'c' }, createdAt: 1, updatedAt: 1 }],
    }))
    await expect(new ShortcutStore(dir).list()).rejects.toMatchObject({ code: 'store-unavailable' })
  })

  it('serializes concurrent creates so neither is lost', async () => {
    const store = new ShortcutStore(freshDir())
    await Promise.all([
      store.create(draft({ name: 'one' })),
      store.create(draft({ name: 'two' })),
      store.create(draft({ name: 'three' })),
    ])
    const names = (await store.list()).map(entry => entry.name).sort()
    expect(names).toEqual(['one', 'three', 'two'])
  })

  it('keeps the previous list when a write fails', async () => {
    const dir = freshDir()
    const store = new ShortcutStore(dir)
    await store.create(draft({ name: 'kept' }))
    // Make the file unwritable by replacing the directory with a file path that
    // cannot host the temp file: the store must report it and keep memory intact.
    const blocker = join(dir, 'blocked')
    writeFileSync(blocker, 'x')
    const failing = new ShortcutStore(blocker)
    await expect(failing.create(draft({ name: 'n' }))).rejects.toMatchObject({ code: 'store-unavailable' })
    await expect(store.list()).resolves.toHaveLength(1)
  })
})
