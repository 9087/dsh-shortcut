/**
 * The browser's view of the shortcut records, shared by every surface.
 *
 * One module-level store keeps the footer menu, the Settings page and the
 * capture dialog on the same list, so a record added from a bubble appears in
 * the menu immediately and an edit made in Settings is seen by the dialog that
 * produced it. Mutations update the list from the host's own response instead
 * of refetching: the response IS the stored record.
 *
 * @module dsh-shortcut/client/entries
 */

import { useSyncExternalStore } from 'react'
import { ShortcutFailure } from './api.ts'
import type { ShortcutApi } from './api.ts'
import type { ShortcutDraft, ShortcutEdit, ShortcutEntry, ShortcutErrorCode } from '../types.ts'

/** Load lifecycle of the shared list. */
export type EntriesPhase = 'idle' | 'loading' | 'ready' | 'error'

/** One observable list state. */
export interface EntriesState {
  phase: EntriesPhase
  entries: readonly ShortcutEntry[]
  /** Last load failure, when the list could not be read. */
  failure?: { code: ShortcutErrorCode; message: string } | undefined
}

/** The shared record store. */
export class EntriesStore {
  private api: ShortcutApi | undefined
  private state: EntriesState = { phase: 'idle', entries: [] }
  private readonly listeners = new Set<() => void>()
  private inflight: Promise<void> | undefined

  /**
   * Install the host port.
   * @param api - the plugin's RPC port.
   */
  bind(api: ShortcutApi): void {
    this.api = api
  }

  /** Current snapshot (stable between changes). */
  readonly getSnapshot = (): EntriesState => this.state

  /**
   * Subscribe to list changes.
   * @param listener - called after each committed state.
   * @returns unsubscribe.
   */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Commit one state and wake every reader. */
  private publish(next: EntriesState): void {
    this.state = next
    for (const listener of [...this.listeners]) listener()
  }

  /** Load the list the first time a surface needs it. */
  ensureLoaded(): void {
    if (this.state.phase === 'idle') void this.refresh()
  }

  /**
   * Re-read the host list.
   * @returns completion of the read (shared with a concurrent call).
   */
  async refresh(): Promise<void> {
    const api = this.api
    if (api === undefined) return
    this.inflight ??= (async () => {
      if (this.state.phase !== 'ready') this.publish({ phase: 'loading', entries: this.state.entries })
      try {
        const entries = await api.list()
        this.publish({ phase: 'ready', entries })
      } catch (error: unknown) {
        const failure = failureOf(error)
        this.publish({ phase: 'error', entries: this.state.entries, failure })
      } finally {
        this.inflight = undefined
      }
    })()
    return this.inflight
  }

  /**
   * Create one record and fold it into the list.
   * @param draft - dialog values.
   * @returns the stored record.
   */
  async create(draft: ShortcutDraft): Promise<ShortcutEntry> {
    const api = this.api
    if (api === undefined) throw new ShortcutFailure('store-unavailable', 'the store is not connected')
    const entry = await api.create(draft)
    this.publish({ phase: 'ready', entries: [...this.state.entries, entry] })
    return entry
  }

  /**
   * Replace one record and fold the host's answer into the list.
   * @param edit - identity plus replacement draft.
   * @returns the stored record.
   */
  async update(edit: ShortcutEdit): Promise<ShortcutEntry> {
    const api = this.api
    if (api === undefined) throw new ShortcutFailure('store-unavailable', 'the store is not connected')
    const entry = await api.update(edit)
    this.publish({
      phase: 'ready',
      entries: this.state.entries.map(existing => existing.id === entry.id ? entry : existing),
    })
    return entry
  }

  /**
   * Delete one record and fold the removal into the list.
   * @param id - record identity.
   */
  async remove(id: string): Promise<void> {
    const api = this.api
    if (api === undefined) throw new ShortcutFailure('store-unavailable', 'the store is not connected')
    await api.remove(id)
    this.publish({ phase: 'ready', entries: this.state.entries.filter(entry => entry.id !== id) })
  }

  /**
   * Deliver one record without touching the list.
   * @param id - record identity.
   * @returns the host's delivery receipt.
   */
  async send(id: string): Promise<{ name: string; sessionId: string }> {
    const api = this.api
    if (api === undefined) throw new ShortcutFailure('send-failed', 'the store is not connected')
    return api.send(id)
  }

  /** Find one record in the current list. */
  entryOf(id: string): ShortcutEntry | undefined {
    return this.state.entries.find(entry => entry.id === id)
  }
}

/** The plugin's single record store. */
export const entriesStore = new EntriesStore()

/** Normalize any thrown value into the coded failure shape the UI localizes. */
function failureOf(error: unknown): { code: ShortcutErrorCode; message: string } {
  if (error instanceof ShortcutFailure) return { code: error.code, message: error.message }
  return { code: 'store-unavailable', message: error instanceof Error ? error.message : String(error) }
}

/** Subscribe React to the shared list. */
export function useEntries(): EntriesState {
  return useSyncExternalStore(entriesStore.subscribe, entriesStore.getSnapshot, entriesStore.getSnapshot)
}
