/**
 * Browser data layer for the target picker.
 *
 * Subscribes once to the client session list and workspace list, keeps their
 * snapshots in module state (so non-React code — the editor store's submit —
 * can resolve a target path too), and exposes the pure tree builder's input.
 *
 * `subagentCatalog` / `agentTeam` are NOT persisted projections in
 * 0.2.0-rc.2, so a session's children are unknown until
 * `sessions.refreshProjections(sessionId)` has run. The picker calls
 * {@link ensureProjections} when a session (or an agent branch) is expanded
 * and the component re-renders when the store republishes.
 *
 * @module dsh-shortcut/client/catalog
 */

import { useMemo, useSyncExternalStore } from 'react'
import type { ShortcutTarget } from '../types.ts'
import { buildPickerTree } from './picker-tree.ts'
import type {
  PickerCatalogEntry, PickerProjection, PickerSessionSource, PickerTeamMember, PickerWorkspaceNode, PickerWorkspaceSource,
} from './picker-tree.ts'

/** Minimal observable source both stores expose. */
interface Observable<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** Effect-owning context slice for the subscription lifecycle. */
interface EffectContextLike {
  effect(callback: () => void | (() => void), label?: string): void
}

/** One session summary as this module reads it (defensive structural typing). */
interface SessionRowLike {
  id?: unknown
  displayTitle?: unknown
  title?: unknown
  origin?: unknown
  blank?: unknown
}

/** Projection snapshot as the store carries it. */
interface ProjectionSnapshotLike {
  state?: unknown
  values?: unknown
}

/** The sessions list state as this module reads it. */
interface SessionListLike {
  byId?: unknown
  projectionsBySession?: unknown
}

/** The workspace snapshot as this module reads it. */
interface WorkspaceSnapshotLike {
  items?: unknown
  archivedSessionIds?: unknown
}

/** One workspace row as this module reads it. */
interface WorkspaceRowLike {
  workspaceId?: unknown
  title?: unknown
  path?: unknown
  sessionIds?: unknown
}

/** Holder for the lazy service getters installed by apply(). */
let getSessions: (() => unknown) | undefined
let getWorkspaces: (() => unknown) | undefined
/** Latest snapshots, shared by hooks and the editor store. */
let sessionsState: unknown
let workspacesState: unknown
/** Bumped on every committed snapshot change. */
let revision = 0
const listeners = new Set<() => void>()
/** Session ids whose projection read this plugin already asked for. */
const requested = new Map<string, Promise<void>>()
/** Sessions whose projection read is in flight. */
const pending = new Set<string>()
let bound = false

/** Wake every reader. */
function notify(): void {
  revision += 1
  for (const listener of [...listeners]) listener()
}

/** Read a property without trusting a shape. */
function objectOf(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** Read the list observable from one service, defensively. */
function observableOf(service: unknown): Observable<unknown> | undefined {
  const list = objectOf(objectOf(service)?.list)
  if (list === undefined) return undefined
  if (typeof list.getSnapshot !== 'function' || typeof list.subscribe !== 'function') return undefined
  return list as unknown as Observable<unknown>
}

/** Subscribe to both stores, retrying until the services are mounted. */
function bind(): void {
  if (bound) return
  const sessions = getSessions?.()
  const workspaces = getWorkspaces?.()
  const sessionList = observableOf(sessions)
  const workspaceList = observableOf(workspaces)
  if (sessionList === undefined || workspaceList === undefined) return
  bound = true
  sessionsState = sessionList.getSnapshot()
  workspacesState = workspaceList.getSnapshot()
  sessionList.subscribe(() => {
    sessionsState = sessionList.getSnapshot()
    notify()
  })
  workspaceList.subscribe(() => {
    workspacesState = workspaceList.getSnapshot()
    notify()
  })
  notify()
}

/**
 * Install the data layer on the plugin context.
 * @param ctx - client context, for the effect-owned subscriptions.
 * @param sessions - getter resolving the client sessions service.
 * @param workspaces - getter resolving the client workspaces service.
 */
export function startCatalog(
  ctx: EffectContextLike,
  sessions: () => unknown,
  workspaces: () => unknown,
): void {
  getSessions = sessions
  getWorkspaces = workspaces
  ctx.effect(() => {
    bind()
    const timer = setInterval(bind, 500)
    return () => { clearInterval(timer) }
  }, 'dsh-shortcut: catalog subscriptions')
}

/** Subscribe a React reader to catalog changes. */
export function useCatalogRevision(): number {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    () => revision,
    () => revision,
  )
}

/** The raw session-list state, for title lookups. */
export function sessionListState(): SessionListLike {
  return (objectOf(sessionsState) ?? {}) as SessionListLike
}

/** One session row by id. */
export function sessionRow(id: string): SessionRowLike | undefined {
  const byId = objectOf(sessionListState().byId)
  const row = objectOf(byId?.[id])
  if (row === undefined) return undefined
  return {
    id,
    ...(typeof row.displayTitle === 'string' ? { displayTitle: row.displayTitle } : {}),
    ...(typeof row.title === 'string' ? { title: row.title } : {}),
    ...(row.origin === 'subagent' ? { origin: 'subagent' } : {}),
    ...(typeof row.blank === 'boolean' ? { blank: row.blank } : {}),
  }
}

/** Display title of one session, with a short-id fallback. */
export function sessionTitleOf(id: string): string {
  const row = sessionRow(id)
  if (row !== undefined && typeof row.displayTitle === 'string' && row.displayTitle.length > 0) return row.displayTitle
  if (row !== undefined && typeof row.title === 'string' && row.title.length > 0) return row.title
  return id.slice(0, 8)
}

/** Workspace rows, defensively read. */
function workspaceRows(): WorkspaceRowLike[] {
  const snapshot = objectOf(workspacesState) as WorkspaceSnapshotLike | undefined
  const items = snapshot?.items
  if (!Array.isArray(items)) return []
  return items.filter((item): item is WorkspaceRowLike => objectOf(item) !== undefined)
}

/** Archived session ids as a set. */
function archivedSet(): ReadonlySet<string> {
  const snapshot = objectOf(workspacesState) as WorkspaceSnapshotLike | undefined
  const ids = snapshot?.archivedSessionIds
  if (!Array.isArray(ids)) return new Set()
  return new Set(ids.filter((id): id is string => typeof id === 'string'))
}

/** Build the pure builder's workspace input. */
function workspaceSources(): PickerWorkspaceSource[] {
  return workspaceRows().flatMap((row) => {
    const workspaceId = typeof row.workspaceId === 'string' ? row.workspaceId : undefined
    if (workspaceId === undefined) return []
    const sessionIds = Array.isArray(row.sessionIds)
      ? row.sessionIds.filter((id): id is string => typeof id === 'string')
      : []
    const title = typeof row.title === 'string' && row.title.length > 0
      ? row.title
      : typeof row.path === 'string' && row.path.length > 0 ? row.path.split(/[\\/]/).pop() ?? row.path : workspaceId
    return [{
      id: workspaceId,
      title,
      path: typeof row.path === 'string' ? row.path : '',
      sessionIds,
    }]
  })
}

/** Build the pure builder's session input. */
function sessionSources(): Record<string, PickerSessionSource | undefined> {
  const byId = objectOf(sessionListState().byId) ?? {}
  const out: Record<string, PickerSessionSource | undefined> = {}
  for (const [id, value] of Object.entries(byId)) {
    const row = objectOf(value)
    if (row === undefined) continue
    const displayTitle = typeof row.displayTitle === 'string' && row.displayTitle.length > 0
      ? row.displayTitle
      : typeof row.title === 'string' && row.title.length > 0 ? row.title : id.slice(0, 8)
    out[id] = {
      id,
      displayTitle,
      ...(row.origin === 'subagent' ? { origin: 'subagent' as const } : {}),
      ...(typeof row.blank === 'boolean' ? { blank: row.blank } : {}),
    }
  }
  return out
}

/** Build the pure builder's projection input from the session-list state. */
function projectionSources(): Record<string, PickerProjection | undefined> {
  const raw = objectOf(sessionListState().projectionsBySession) ?? {}
  const out: Record<string, PickerProjection | undefined> = {}
  for (const [id, value] of Object.entries(raw)) {
    const snapshot = objectOf(value) as ProjectionSnapshotLike | undefined
    if (snapshot === undefined) continue
    const state = snapshot.state === 'ready' || snapshot.state === 'loading' || snapshot.state === 'error'
      ? snapshot.state
      : 'idle'
    const values = objectOf(snapshot.values) ?? {}
    const catalogRaw = values.subagentCatalog
    const catalog: PickerCatalogEntry[] | undefined = Array.isArray(catalogRaw)
      ? catalogRaw.flatMap((entry) => {
        const row = objectOf(entry)
        const entryId = typeof row?.id === 'string' ? row.id : undefined
        if (entryId === undefined) return []
        const mode = row?.mode === 'one-shot' || row?.mode === 'continuable' || row?.mode === 'unknown'
          ? row.mode
          : 'unknown'
        return [{
          id: entryId,
          mode,
          ...(typeof row?.label === 'string' ? { label: row.label } : {}),
        }]
      })
      : undefined
    const teamRaw = objectOf(values.agentTeam)
    const teamMembers: PickerTeamMember[] | undefined = Array.isArray(teamRaw?.members)
      ? teamRaw.members.flatMap((member) => {
        const row = objectOf(member)
        const memberId = typeof row?.id === 'string' ? row.id : undefined
        const name = typeof row?.name === 'string' ? row.name : undefined
        if (memberId === undefined || name === undefined) return []
        const role = row?.role === 'lead' ? 'lead' : 'teammate'
        const phase = row?.phase === 'provisioning' || row?.phase === 'active' || row?.phase === 'failed'
          ? row.phase
          : 'active'
        return [{
          id: memberId,
          name,
          role,
          phase,
          ...(typeof row?.error === 'string' ? { error: row.error } : {}),
        }]
      })
      : undefined
    // A projection that exists by itself proves the read landed; `pending`
    // marks a requested-but-unsettled read as 'loading'.
    out[id] = {
      state: pending.has(id) ? 'loading' : state,
      ...(catalog === undefined ? {} : { catalog }),
      ...(teamMembers === undefined ? {} : { teamMembers }),
    }
  }
  return out
}

/** Projection reads allowed in flight at once; expanding a session must not fire dozens. */
const READ_CONCURRENCY = 3
/** Queued projection reads, in request order. */
const readQueue: Array<{ id: string; settle: () => void }> = []
/** Reads currently running. */
let activeReads = 0

/** Run one queued read and settle its shared promise. */
async function runRead(job: { id: string; settle: () => void }): Promise<void> {
  const service = objectOf(getSessions?.())
  const refresh = service?.refreshProjections
  pending.add(job.id)
  notify()
  try {
    if (typeof refresh === 'function') await (refresh as (id: string) => Promise<void>).call(service, job.id)
  } catch {
    // A failed read keeps the projection 'error'; the row falls back to a leaf.
  } finally {
    pending.delete(job.id)
    notify()
    job.settle()
  }
}

/** Start queued reads while there is room. */
function pumpReads(): void {
  while (activeReads < READ_CONCURRENCY && readQueue.length > 0) {
    const job = readQueue.shift()
    if (job === undefined) return
    activeReads += 1
    void runRead(job).finally(() => {
      activeReads -= 1
      pumpReads()
    })
  }
}

/**
 * Ask the host for one session's projections (once per connection, bounded
 * concurrency). A subagent's own children are only known after this read, so
 * the picker requests it for every visible child row and draws an expand
 * chevron only once the answer says the row really is a branch.
 * @param sessionId - session whose subagent catalog / team roster is needed.
 * @returns completion of the read (shared with concurrent callers).
 */
export function ensureProjections(sessionId: string): Promise<void> {
  const existing = requested.get(sessionId)
  if (existing !== undefined) return existing
  const service = objectOf(getSessions?.())
  if (typeof service?.refreshProjections !== 'function') return Promise.resolve()
  let settle!: () => void
  const promise = new Promise<void>((resolve) => { settle = resolve })
  requested.set(sessionId, promise)
  readQueue.push({ id: sessionId, settle })
  pumpReads()
  return promise
}

/** Whether one session's projection read has already been requested. */
export function projectionsRequested(sessionId: string): boolean {
  return requested.has(sessionId)
}

/**
 * Build the picker tree from the subscribed catalog state.
 * @param ungroupedLabel - localized heading for unaccounted sessions.
 * @returns the workspace tree.
 */
export function usePickerTree(ungroupedLabel: string): PickerWorkspaceNode[] {
  useCatalogRevision()
  return useMemo(
    () => buildPickerTree({
      workspaces: workspaceSources(),
      sessions: sessionSources(),
      projections: projectionSources(),
      archived: archivedSet(),
      ungroupedLabel,
    }),
    // The revision covers both store snapshots; the label is a plain string.
    [ungroupedLabel, revision],
  )
}

/** Whether the stores have produced their first snapshot yet. */
export function useCatalogReady(): boolean {
  useCatalogRevision()
  return objectOf(sessionsState) !== undefined
}

/**
 * Resolve the display path for one target.
 *
 * A main-agent target has no leaf segment: the session row IS that target, so
 * the path is `<workspace> / <session>`. Child targets append the leaf.
 * @param target - stored target descriptor.
 * @param sessionId - the target's owning top-level session.
 * @param t - plugin translator, for the fallback main-agent label.
 * @returns the display path, preferring live titles over saved fallbacks.
 */
export function resolveTargetPath(target: ShortcutTarget, sessionId: string, t: (key: 'picker.mainAgent') => string): string {
  const workspace = workspaceRows().find(row => Array.isArray(row.sessionIds) && row.sessionIds.includes(sessionId))
  const workspaceTitle = typeof workspace?.title === 'string' && workspace.title.length > 0
    ? workspace.title
    : target.workspaceTitle
  const sessionTitle = (() => {
    const row = sessionRow(sessionId)
    if (row !== undefined && typeof row.displayTitle === 'string' && row.displayTitle.length > 0) return row.displayTitle
    return target.sessionTitle
  })()
  const leaf = target.kind === 'main'
    ? undefined
    : target.leafLabel !== undefined && target.leafLabel.length > 0
      ? target.leafLabel
      : target.childSessionId?.slice(0, 8) ?? t('picker.mainAgent')
  // A saved path is the fallback when the live session/workspace row is gone
  // (archived or deleted) — better than a path with a hole in it.
  if (target.path !== undefined && target.path.length > 0 && (workspaceTitle === undefined || sessionTitle === undefined)) {
    return target.path
  }
  return [workspaceTitle, sessionTitle, leaf].filter((part): part is string => part !== undefined && part.length > 0).join(' / ')
}

/**
 * React binding of {@link resolveTargetPath}: follows title changes live.
 * @param target - stored target descriptor.
 * @param t - plugin translator.
 * @returns the display path.
 */
export function useTargetPath(target: ShortcutTarget, sessionId: string, t: (key: 'picker.mainAgent') => string): string {
  useCatalogRevision()
  return resolveTargetPath(target, sessionId, t)
}

/**
 * One target's short label, for a one-line toast.
 * @param target - stored target descriptor.
 * @param sessionId - the target's owning top-level session.
 * @param t - plugin translator.
 * @returns the leaf label (session title for the main agent).
 */
export function targetShortLabel(
  target: ShortcutTarget,
  sessionId: string,
  t: (key: 'picker.mainAgent') => string,
): string {
  const sessionTitle = (() => {
    const row = sessionRow(sessionId)
    if (row !== undefined && typeof row.displayTitle === 'string' && row.displayTitle.length > 0) return row.displayTitle
    return target.sessionTitle
  })()
  if (target.kind === 'main') return sessionTitle ?? t('picker.mainAgent')
  return target.leafLabel !== undefined && target.leafLabel.length > 0 ? target.leafLabel : targetShortId(target)
}

/** Short id fragment for a child target. */
function targetShortId(target: ShortcutTarget): string {
  const child = target.childSessionId
  return child === undefined ? '' : child.slice(0, 8)
}
