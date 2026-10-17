/**
 * Session titles, read from the client sessions service.
 *
 * The shortcut store keeps only a session id; a reader needs the title to tell
 * two sessions apart. The service is optional and may register after this
 * plugin's own apply, so it is resolved through a getter at read time rather
 * than captured once.
 *
 * @module dsh-shortcut/client/sessions
 */

import { useEffect, useState } from 'react'

/** Minimal observable snapshot shape the sessions list exposes. */
interface Observable<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** One row of the client session list, as far as a title is concerned. */
interface SessionRowLike {
  id?: unknown
  displayTitle?: unknown
  title?: unknown
}

/** The list state: ordered ids plus rows. */
interface SessionListStateLike {
  ids?: unknown
  byId?: unknown
}

/** A resolved row for pickers and lists. */
export interface SessionRow {
  id: string
  title: string
}

/** Holder for the lazy service getter installed by apply(). */
let getSessions: (() => unknown) | undefined

/**
 * Install the service getter.
 * @param getter - resolves the client sessions service, or undefined.
 */
export function attachSessions(getter: () => unknown): void {
  getSessions = getter
}

/** Resolve the list observable through the getter, defensively. */
function listObservable(): Observable<SessionListStateLike> | undefined {
  const service = getSessions?.()
  if (typeof service !== 'object' || service === null) return undefined
  const list = (service as { list?: unknown }).list
  if (typeof list !== 'object' || list === null) return undefined
  const candidate = list as Partial<Observable<SessionListStateLike>>
  if (typeof candidate.getSnapshot !== 'function' || typeof candidate.subscribe !== 'function') return undefined
  return candidate as Observable<SessionListStateLike>
}

/** Read one row's id and title. */
function rowOf(id: string, row: SessionRowLike | undefined): SessionRow {
  const titled = typeof row?.displayTitle === 'string' && row.displayTitle.length > 0
    ? row.displayTitle
    : typeof row?.title === 'string' && row.title.length > 0
      ? row.title
      : undefined
  return { id, title: titled ?? id.slice(0, 8) }
}

/** Project the list state into ordered rows. */
export function rowsOf(state: unknown): SessionRow[] {
  if (typeof state !== 'object' || state === null) return []
  const fields = state as SessionListStateLike
  const byId = typeof fields.byId === 'object' && fields.byId !== null
    ? fields.byId as Record<string, SessionRowLike | undefined>
    : {}
  const ids = Array.isArray(fields.ids) ? fields.ids.filter((id): id is string => typeof id === 'string') : Object.keys(byId)
  return ids.map(id => rowOf(id, byId[id]))
}

/**
 * Follow the client session list.
 * @returns the current rows (empty when the service is absent).
 */
export function useSessionRows(): SessionRow[] {
  const observable = listObservable()
  const [rows, setRows] = useState<SessionRow[]>(() => rowsOf(observable?.getSnapshot()))
  useEffect(() => {
    if (observable === undefined) {
      setRows([])
      return
    }
    setRows(rowsOf(observable.getSnapshot()))
    return observable.subscribe(() => { setRows(rowsOf(observable.getSnapshot())) })
  }, [observable])
  return rows
}

/**
 * Resolve one session's display title.
 * @param rows - the current session rows.
 * @param id - the session id to resolve.
 * @returns the title, or a short id fragment when the row is unknown.
 */
export function titleOf(rows: readonly SessionRow[], id: string): string {
  for (const row of rows) {
    if (row.id === id) return row.title
  }
  return id.slice(0, 8)
}
