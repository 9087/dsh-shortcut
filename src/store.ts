/**
 * Durable shortcut records on the host.
 *
 * One file (`<DSH_HOME>/shortcut/entries.json`), written atomically, read
 * once per process and kept in memory afterwards. Mutations are serialized so
 * two browser tabs cannot interleave a read-modify-write, and a failed write
 * leaves both the disk and the in-memory list at their previous state.
 *
 * Schema version 2 added the agent target. Version 1 records (session id only)
 * are read as `kind: 'main'` and are rewritten as version 2 on the next write,
 * so an existing shortcuts file keeps working.
 *
 * A corrupt or unreadable file is a REPORTED failure (`store-unavailable`)
 * rather than an empty list: silently answering "no shortcuts" would invite
 * the reader to re-add everything on top of a file that is merely malformed,
 * and the next write would overwrite it.
 *
 * @module dsh-shortcut/store
 */

import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { writeJsonAtomic } from './atomic-write.ts'
import { isTargetKind, validateDraft } from './share.ts'
import { STORE_VERSION } from './types.ts'
import type { ShortcutDraft, ShortcutEdit, ShortcutEntry, ShortcutFile, ShortcutTarget } from './types.ts'
import type { ShortcutErrorCode } from './types.ts'

/** A business failure the channel turns into a structured RPC error. */
export class StoreFailure extends Error {
  readonly code: ShortcutErrorCode

  /**
   * @param code - the caller-facing failure kind.
   * @param message - host-language detail.
   */
  constructor(code: ShortcutErrorCode, message: string) {
    super(message)
    this.name = 'StoreFailure'
    this.code = code
  }
}

/** `$DSH_HOME/shortcut`, falling back to `~/.dsh/shortcut` when the var is absent. */
export function defaultShortcutDir(): string {
  const home = process.env.DSH_HOME?.trim()
  return join(home === undefined || home.length === 0 ? join(homedir(), '.dsh') : home, 'shortcut')
}

/** Common fields of one stored record. */
function commonFields(row: Record<string, unknown>): boolean {
  return typeof row.id === 'string' && row.id.length > 0
    && typeof row.name === 'string'
    && typeof row.sessionId === 'string' && row.sessionId.length > 0
    && typeof row.text === 'string'
    && typeof row.createdAt === 'number'
    && typeof row.updatedAt === 'number'
}

/** Optional label fields a target may carry, all strings when present. */
function optionalLabels(value: Record<string, unknown>): boolean {
  for (const key of ['workspaceTitle', 'sessionTitle', 'leafLabel', 'path'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'string') return false
  }
  const ancestors = value.ancestors
  if (ancestors !== undefined) {
    if (!Array.isArray(ancestors) || ancestors.length === 0 || ancestors.length > 32) return false
    if (!ancestors.every(id => typeof id === 'string' && id.length > 0)) return false
    if (new Set(ancestors).size !== ancestors.length) return false
  }
  return true
}

/** Whether a v2 target is a coherent address. */
export function isStoredTarget(value: unknown, sessionId: string): value is ShortcutTarget {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const target = value as Record<string, unknown>
  if (!isTargetKind(target.kind)) return false
  if (target.kind === 'main') {
    if (target.childSessionId !== undefined || target.ancestors !== undefined) return false
  } else {
    if (typeof target.childSessionId !== 'string'
      || target.childSessionId.length === 0
      || target.childSessionId === sessionId) {
      return false
    }
    if (Array.isArray(target.ancestors) && target.ancestors[target.ancestors.length - 1] !== sessionId) return false
  }
  return optionalLabels(target)
}

/** Whether a parsed value is a version-2 record. */
function isEntry(value: unknown): value is ShortcutEntry {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  const navigateOk = row.navigate === undefined || typeof row.navigate === 'boolean'
  return commonFields(row) && navigateOk && isStoredTarget(row.target, row.sessionId as string)
}

/** Whether a parsed value is a legacy version-1 record. */
function isLegacyEntry(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  return commonFields(value as Record<string, unknown>)
}

/** Upgrade one v1 record: a session-id-only shortcut addressed the main agent. */
function migrateLegacy(entry: Record<string, unknown>): ShortcutEntry {
  return {
    id: entry.id as string,
    name: entry.name as string,
    sessionId: entry.sessionId as string,
    text: entry.text as string,
    navigate: true,
    target: { kind: 'main' },
    createdAt: entry.createdAt as number,
    updatedAt: entry.updatedAt as number,
  }
}

/** Parse the file's bytes into records, or say why it cannot be trusted. */
function parseFile(text: string): ShortcutEntry[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new StoreFailure('store-unavailable', 'entries.json is not valid JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new StoreFailure('store-unavailable', 'entries.json is not a shortcut file')
  }
  const file = parsed as { version?: unknown; entries?: unknown }
  if (!Array.isArray(file.entries)) {
    throw new StoreFailure('store-unavailable', 'entries.json has no entries list')
  }
  if (file.version === 1) {
    if (!file.entries.every(isLegacyEntry)) throw new StoreFailure('store-unavailable', 'entries.json has malformed entries')
    return file.entries.map(migrateLegacy)
  }
  if (file.version !== STORE_VERSION) {
    throw new StoreFailure('store-unavailable', `entries.json has unsupported version ${String(file.version)}`)
  }
  if (!file.entries.every(isEntry)) throw new StoreFailure('store-unavailable', 'entries.json has malformed entries')
  // Records written before the navigate switch existed default to true.
  return file.entries.map(entry => ({
    ...entry,
    navigate: entry.navigate !== false,
    target: { ...entry.target },
  }))
}

/** The host-side record store. */
export class ShortcutStore {
  private readonly file: string
  private entries: ShortcutEntry[] | undefined
  private loading: Promise<ShortcutEntry[]> | undefined
  private queue: Promise<unknown> = Promise.resolve()

  /**
   * @param directory - the state directory that holds `entries.json`.
   */
  constructor(directory: string) {
    this.file = join(directory, 'entries.json')
  }

  /** The file this store owns (for logs and tests). */
  get path(): string {
    return this.file
  }

  /** Load once; a failure is retried on the next call so a repaired file recovers. */
  private load(): Promise<ShortcutEntry[]> {
    if (this.entries !== undefined) return Promise.resolve(this.entries)
    this.loading ??= (async () => {
      try {
        const text = await readFile(this.file, 'utf8')
        this.entries = parseFile(text)
        return this.entries
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          this.entries = []
          return this.entries
        }
        this.loading = undefined
        throw error instanceof StoreFailure ? error : new StoreFailure('store-unavailable', String(error))
      }
    })()
    return this.loading
  }

  /** Serialize one read-modify-write: the write lands before the memory moves. */
  private async mutate<T>(operation: (entries: ShortcutEntry[]) => Promise<T>): Promise<T> {
    const previous = this.queue
    const run = (async () => {
      await previous.catch(() => {})
      const entries = await this.load()
      return operation(entries)
    })()
    this.queue = run.catch(() => {})
    return run
  }

  /** Replace the file, then the in-memory list. A failed write changes nothing. */
  private async persist(next: ShortcutEntry[]): Promise<void> {
    const file: ShortcutFile = { version: STORE_VERSION, entries: next }
    try {
      await writeJsonAtomic(this.file, file)
    } catch (error: unknown) {
      throw new StoreFailure('store-unavailable', `writing ${this.file} failed: ${String(error)}`)
    }
    this.entries = next
  }

  /**
   * Read every record, in insertion order.
   * @returns a defensive copy.
   */
  async list(): Promise<ShortcutEntry[]> {
    const entries = await this.load()
    return entries.map(entry => ({ ...entry, target: { ...entry.target } }))
  }

  /**
   * Read one record.
   * @param id - record identity.
   * @returns the record, or undefined when it is gone.
   */
  async get(id: string): Promise<ShortcutEntry | undefined> {
    const entries = await this.load()
    const found = entries.find(entry => entry.id === id)
    return found === undefined ? undefined : { ...found, target: { ...found.target } }
  }

  /**
   * Append one record.
   * @param draft - raw dialog values.
   * @returns the stored record.
   */
  async create(draft: ShortcutDraft): Promise<ShortcutEntry> {
    return this.mutate(async (entries) => {
      const checked = validateDraft(entries, draft)
      if (!checked.ok) {
        throw new StoreFailure(checked.problem, checked.problem === 'name-taken'
          ? `a shortcut named ${String(draft.name).trim()} already exists`
          : 'name, session, target and text are required')
      }
      const now = Date.now()
      const entry: ShortcutEntry = {
        id: randomUUID(),
        name: checked.draft.name,
        sessionId: checked.draft.sessionId,
        text: checked.draft.text,
        navigate: checked.draft.navigate,
        target: { ...checked.draft.target },
        createdAt: now,
        updatedAt: now,
      }
      await this.persist([...entries, entry])
      return { ...entry, target: { ...entry.target } }
    })
  }

  /**
   * Replace one record's fields.
   * @param edit - identity plus the replacement draft.
   * @returns the stored record.
   */
  async update(edit: ShortcutEdit): Promise<ShortcutEntry> {
    return this.mutate(async (entries) => {
      const index = entries.findIndex(entry => entry.id === edit.id)
      if (index < 0) throw new StoreFailure('not-found', `no shortcut with id ${edit.id}`)
      const checked = validateDraft(entries, edit.draft, edit.id)
      if (!checked.ok) {
        throw new StoreFailure(checked.problem, checked.problem === 'name-taken'
          ? `a shortcut named ${String(edit.draft.name).trim()} already exists`
          : 'name, session, target and text are required')
      }
      const existing = entries[index]
      if (existing === undefined) throw new StoreFailure('not-found', `no shortcut with id ${edit.id}`)
      const updated: ShortcutEntry = {
        ...existing,
        name: checked.draft.name,
        sessionId: checked.draft.sessionId,
        text: checked.draft.text,
        navigate: checked.draft.navigate,
        target: { ...checked.draft.target },
        updatedAt: Date.now(),
      }
      const next = entries.map(entry => entry.id === edit.id ? updated : entry)
      await this.persist(next)
      return { ...updated, target: { ...updated.target } }
    })
  }

  /**
   * Drop one record.
   * @param id - record identity.
   */
  async remove(id: string): Promise<void> {
    await this.mutate(async (entries) => {
      if (!entries.some(entry => entry.id === id)) throw new StoreFailure('not-found', `no shortcut with id ${id}`)
      await this.persist(entries.filter(entry => entry.id !== id))
    })
  }
}
