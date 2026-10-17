/**
 * The capture/edit dialog and the transient banner, as global observable
 * state.
 *
 * The dialog can be opened from either a message bubble (a DOM-injected
 * button, not a React surface) or the Settings page, so its state cannot live
 * in either tree; the footer entry — mounted for the life of the page — hosts
 * the single dialog instance. One banner at a time is enough: deliveries are
 * quick, and the newest outcome is the one the reader needs.
 *
 * @module dsh-shortcut/client/editor
 */

import { useSyncExternalStore } from 'react'
import { ShortcutFailure } from './api.ts'
import { entriesStore } from './entries.ts'
import { validateDraft } from '../share.ts'
import type { ShortcutDraft, ShortcutEntry, ShortcutErrorCode } from '../types.ts'

/** Which dialog is showing. */
export type EditorMode = 'create' | 'edit'

/** One dialog state. */
export interface EditorState {
  open: boolean
  mode: EditorMode
  /** Edited record id (edit mode only). */
  id?: string | undefined
  name: string
  sessionId: string
  /** The target session came from the bubble and cannot be changed here. */
  sessionFixed: boolean
  text: string
  submitting: boolean
  /** Last refusal, as a code the dialog localizes. */
  problem?: ShortcutErrorCode | undefined
}

/** The closed dialog. */
const CLOSED: EditorState = {
  open: false,
  mode: 'create',
  name: '',
  sessionId: '',
  sessionFixed: false,
  text: '',
  submitting: false,
}

/** What a capture from a bubble carries. */
export interface CaptureInput {
  /** The session the bubble belongs to; undefined when it could not be resolved. */
  sessionId?: string | undefined
  /** The bubble text; empty when it could not be read. */
  text: string
}

/** The dialog state machine. */
export class EditorStore {
  private state: EditorState = CLOSED
  private readonly listeners = new Set<() => void>()

  /** Current snapshot. */
  readonly getSnapshot = (): EditorState => this.state

  /**
   * Subscribe to dialog changes.
   * @param listener - called after each committed state.
   * @returns unsubscribe.
   */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Commit one state. */
  private publish(next: EditorState): void {
    this.state = next
    for (const listener of [...this.listeners]) listener()
  }

  /**
   * Open the dialog for a message-bubble capture.
   * @param input - the bubble's session and text, when known.
   */
  openCapture(input: CaptureInput): void {
    this.publish({
      ...CLOSED,
      open: true,
      mode: 'create',
      name: '',
      sessionId: input.sessionId ?? '',
      sessionFixed: input.sessionId !== undefined,
      text: input.text,
      submitting: false,
    })
  }

  /** Open the dialog empty, for the Settings page's Add button. */
  openCreate(): void {
    this.publish({ ...CLOSED, open: true, mode: 'create' })
  }

  /**
   * Open the dialog on one stored record.
   * @param entry - the record to edit.
   */
  openEdit(entry: ShortcutEntry): void {
    this.publish({
      ...CLOSED,
      open: true,
      mode: 'edit',
      id: entry.id,
      name: entry.name,
      sessionId: entry.sessionId,
      sessionFixed: false,
      text: entry.text,
      submitting: false,
    })
  }

  /** Close the dialog unless a submit is in flight. */
  close(): void {
    if (this.state.submitting) return
    this.publish(CLOSED)
  }

  /**
   * Change one field.
   * @param patch - the fields to overwrite.
   */
  patch(patch: Partial<Pick<EditorState, 'name' | 'text' | 'sessionId'>>): void {
    this.publish({ ...this.state, ...patch, problem: undefined })
  }

  /**
   * Submit the dialog to the host.
   * @returns the stored record, or undefined when the attempt failed.
   */
  async submit(): Promise<ShortcutEntry | undefined> {
    const state = this.state
    if (!state.open || state.submitting) return undefined
    const draft: ShortcutDraft = { name: state.name, sessionId: state.sessionId, text: state.text }
    const checked = validateDraft(entriesStore.getSnapshot().entries, draft, state.id)
    if (!checked.ok) {
      this.publish({ ...state, problem: checked.problem })
      return undefined
    }
    this.publish({ ...state, submitting: true, problem: undefined })
    try {
      const entry = state.mode === 'edit' && state.id !== undefined
        ? await entriesStore.update({ id: state.id, draft: checked.draft })
        : await entriesStore.create(checked.draft)
      this.publish(CLOSED)
      return entry
    } catch (error: unknown) {
      const problem = error instanceof ShortcutFailure ? error.code : 'store-unavailable'
      this.publish({ ...this.state, submitting: false, problem })
      return undefined
    }
  }
}

/** The dialog's single instance. */
export const editorStore = new EditorStore()

/** One transient banner. */
export interface BannerState {
  /** Per-show sequence, so re-showing the same text restarts its lifecycle. */
  key: number
  text: string
  tone?: 'success' | undefined
  holdMs?: number | undefined
}

/** The banner state machine. */
export class BannerStore {
  private current: BannerState | null = null
  private sequence = 0
  private readonly listeners = new Set<() => void>()

  /** Current banner, or null. */
  readonly getSnapshot = (): BannerState | null => this.current

  /**
   * Subscribe to banner changes.
   * @param listener - called after each committed banner.
   * @returns unsubscribe.
   */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Commit one banner. */
  private publish(next: BannerState | null): void {
    this.current = next
    for (const listener of [...this.listeners]) listener()
  }

  /**
   * Show one banner, replacing any current one.
   * @param text - localized sentence.
   * @param options - tone and hold time.
   */
  show(text: string, options: { tone?: 'success' | undefined; holdMs?: number | undefined } = {}): void {
    this.sequence += 1
    this.publish({
      key: this.sequence,
      text,
      ...(options.tone === undefined ? {} : { tone: options.tone }),
      ...(options.holdMs === undefined ? {} : { holdMs: options.holdMs }),
    })
  }

  /**
   * Retire the banner once its fade completed.
   * @param key - the sequence the finished banner carried.
   */
  dismiss(key: number): void {
    if (this.current?.key === key) this.publish(null)
  }
}

/** The plugin's single banner channel. */
export const bannerStore = new BannerStore()

/**
 * Which surfaces are mounted. Settings can only be opened from a shell that
 * also renders the sidebar footer, so the footer is the normal host for the
 * dialog; the flag exists so Settings can host it on a shell without a footer
 * seat instead of leaving the dialog ownerless.
 */
export const mountedHosts: { footer: boolean } = { footer: false }

/** Subscribe React to the dialog. */
export function useEditor(): EditorState {
  return useSyncExternalStore(editorStore.subscribe, editorStore.getSnapshot, editorStore.getSnapshot)
}

/** Subscribe React to the banner. */
export function useBanner(): BannerState | null {
  return useSyncExternalStore(bannerStore.subscribe, bannerStore.getSnapshot, bannerStore.getSnapshot)
}
