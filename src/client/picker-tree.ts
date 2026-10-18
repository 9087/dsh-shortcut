/**
 * Pure workspace → session → agent tree for the shortcut target picker.
 *
 * Two hard rules from DSH 0.2.0-rc.2 shape this module:
 *
 * - sessions are grouped by workspace ONLY through `WorkspaceView.sessionIds`
 *   (a SessionSummary has no workspace id), and subagent/teammate child
 *   sessions are never accounted to a workspace;
 * - a session's agents come from that session's `subagentCatalog` projection
 *   (direct children, with the delegation description as label) plus its
 *   `agentTeam` projection (teammate names). Neither projection is persisted,
 *   so an unloaded projection means "children unknown", not "no children".
 *
 * Only agent nodes are selectable; workspace and session nodes are containers.
 * A subagent that has its own children is a branch (not a leaf) and therefore
 * not selectable, matching "只有叶子节点才能选中".
 *
 * @module dsh-shortcut/client/picker-tree
 */

import type { ShortcutTargetKind } from '../types.ts'

/** One workspace row, as the tree consumes it. */
export interface PickerWorkspaceSource {
  id: string
  title: string
  path: string
  sessionIds: readonly string[]
}

/** One session row, as the tree consumes it. */
export interface PickerSessionSource {
  id: string
  displayTitle: string
  origin?: 'subagent' | undefined
  blank?: boolean | undefined
}

/** One catalog child row (DSH subagent catalog projection entry). */
export interface PickerCatalogEntry {
  id: string
  mode: 'one-shot' | 'continuable' | 'unknown'
  label?: string | undefined
}

/** One agent-team roster row (member name lives here, not in the catalog). */
export interface PickerTeamMember {
  id: string
  name: string
  role: 'lead' | 'teammate'
  phase: 'provisioning' | 'active' | 'failed'
  error?: string | undefined
}

/** One session's loaded projection facts. */
export interface PickerProjection {
  state: 'idle' | 'loading' | 'ready' | 'error'
  catalog?: readonly PickerCatalogEntry[] | undefined
  teamMembers?: readonly PickerTeamMember[] | undefined
}

/** Everything the pure builder reads. */
export interface PickerInput {
  workspaces: readonly PickerWorkspaceSource[]
  sessions: Readonly<Record<string, PickerSessionSource | undefined>>
  projections: Readonly<Record<string, PickerProjection | undefined>>
  archived: ReadonlySet<string>
  /** Localized heading for sessions no workspace accounts (e.g. "未分组"). */
  ungroupedLabel: string
  /** Defensive cap on catalog recursion. */
  maxDepth?: number | undefined
}

/** A secondary fact about one agent row. */
export type AgentDetail = 'one-shot' | 'unknown-mode' | 'provisioning' | 'failed' | 'team-member'

/** Why one agent row cannot be selected. */
export type AgentDisabledReason = 'one-shot' | 'unknown-mode' | 'provisioning' | 'failed'

/** One selectable agent row (or a branch of agent rows). */
export interface AgentNode {
  /** Main: the session id. Otherwise the child session id. */
  id: string
  /** Owning top-level session (what authorizes delivery). */
  sessionId: string
  kind: ShortcutTargetKind
  label: string
  /** Session-id chain from the top-level session down to this row's direct parent (inclusive). */
  ancestors: string[]
  /** Secondary line: the subagent's work description / member detail. */
  note?: string | undefined
  detail?: AgentDetail | undefined
  disabledReason?: AgentDisabledReason | undefined
  children: AgentNode[]
  /** This row's own child catalog has not been loaded yet (so it MAY be a branch). */
  childrenUnknown: boolean
  /** Known children exist, so this row is a branch the reader can expand. */
  expandable: boolean
  /** Leaf + deliverable; workspace/session rows never are. */
  selectable: boolean
}

/**
 * One session row in the tree. The row itself IS the session's main-agent
 * target (no separate "main agent" child row); expanding it reveals the
 * session's subagents and team members.
 */
export interface PickerSessionNode {
  id: string
  title: string
  /** Child agents only: subagents and team members. */
  children: AgentNode[]
  /** The session's own catalog has not been loaded yet (so it MAY have children). */
  childrenUnknown: boolean
  /** Known child agents exist, so this row draws an expand chevron. */
  expandable: boolean
  /** 'unknown' = projections never requested; the others map the store state. */
  childrenState: 'unknown' | 'loading' | 'error' | 'ready'
}

/** One workspace row in the tree. */
export interface PickerWorkspaceNode {
  id: string
  title: string
  path: string
  sessions: PickerSessionNode[]
}

/** A short id fragment, for children whose label DSH never assigned. */
export function shortId(id: string): string {
  return id.length > 10 ? id.slice(0, 8) : id
}

/** Whether a projection's catalog is known (loaded, or failed and known-empty). */
function catalogKnown(projection: PickerProjection | undefined): boolean {
  return projection !== undefined && (projection.state === 'ready' || projection.state === 'error')
}

/** Children state of one session node. */
function childrenStateOf(projection: PickerProjection | undefined): PickerSessionNode['childrenState'] {
  if (projection === undefined || projection.state === 'idle') return 'unknown'
  if (projection.state === 'loading') return 'loading'
  if (projection.state === 'error') return 'error'
  return 'ready'
}

/**
 * Build the child-agent rows of one session (its subagents and teammates),
 * recursively. The session's own (main) agent is handled by its caller.
 * @param input - tree input.
 * @param sessionId - owner session whose projection holds the children.
 * @param depth - recursion depth.
 * @param chain - session ids from the top-level session down to `sessionId`.
 * @returns child agent rows, roster order first, then catalog order.
 */
function childrenOf(input: PickerInput, sessionId: string, depth: number, chain: readonly string[]): AgentNode[] {
  const projection = input.projections[sessionId]
  if (depth > (input.maxDepth ?? 8) || !catalogKnown(projection)) return []
  const catalog = projection?.catalog ?? []
  const noteOf = (id: string): string | undefined => {
    const label = catalog.find(entry => entry.id === id)?.label?.trim()
    return label === undefined || label.length === 0 ? undefined : label
  }
  const teamMembers = (projection?.teamMembers ?? []).filter(member => member.role === 'teammate')
  const memberIds = new Set(teamMembers.map(member => member.id))
  const out: AgentNode[] = []
  for (const member of teamMembers) {
    const nested = childrenOf(input, member.id, depth + 1, [...chain, member.id])
    const disabledReason: AgentDisabledReason | undefined = member.phase === 'provisioning'
      ? 'provisioning'
      : member.phase === 'failed' ? 'failed' : undefined
    out.push({
      id: member.id,
      sessionId,
      kind: 'member',
      label: member.name,
      ancestors: [...chain],
      ...(noteOf(member.id) === undefined ? {} : { note: noteOf(member.id) }),
      ...(disabledReason === undefined ? { detail: 'team-member' } : { detail: disabledReason }),
      ...(disabledReason === undefined ? {} : { disabledReason }),
      children: nested,
      // The chevron is drawn ONLY for a known non-empty branch: an unloaded
      // projection is unknown, not a branch, and must not turn a leaf into a
      // row that looks expandable until the reader clicks it.
      childrenUnknown: !catalogKnown(input.projections[member.id]),
      expandable: nested.length > 0,
      selectable: disabledReason === undefined && nested.length === 0,
    })
  }
  for (const entry of catalog) {
    if (memberIds.has(entry.id)) continue
    const nested = childrenOf(input, entry.id, depth + 1, [...chain, entry.id])
    const disabledReason: AgentDisabledReason | undefined = entry.mode === 'one-shot'
      ? 'one-shot'
      : entry.mode === 'unknown' ? 'unknown-mode' : undefined
    const label = entry.label?.trim()
    const detail: AgentDetail | undefined = disabledReason === undefined ? undefined : disabledReason
    out.push({
      id: entry.id,
      sessionId,
      kind: 'subagent',
      label: label === undefined || label.length === 0 ? shortId(entry.id) : label,
      ancestors: [...chain],
      ...(detail === undefined ? {} : { detail }),
      ...(disabledReason === undefined ? {} : { disabledReason }),
      children: nested,
      childrenUnknown: !catalogKnown(input.projections[entry.id]),
      expandable: nested.length > 0,
      selectable: disabledReason === undefined && nested.length === 0,
    })
  }
  return out
}

/** One session node, or undefined when the row is hidden from the picker. */
function sessionNodeOf(input: PickerInput, sessionId: string): PickerSessionNode | undefined {
  const row = input.sessions[sessionId]
  if (row === undefined) return undefined
  if (row.origin === 'subagent') return undefined
  if (row.blank === true) return undefined
  if (input.archived.has(sessionId)) return undefined
  const projection = input.projections[sessionId]
  const children = catalogKnown(projection) ? childrenOf(input, sessionId, 0, [sessionId]) : []
  return {
    id: sessionId,
    title: row.displayTitle,
    children,
    childrenUnknown: !catalogKnown(projection),
    expandable: children.length > 0,
    childrenState: childrenStateOf(projection),
  }
}

/**
 * Build the whole picker tree.
 * @param input - workspaces, sessions, projections and labels.
 * @returns workspace nodes in registry order, empty workspaces skipped.
 */
export function buildPickerTree(input: PickerInput): PickerWorkspaceNode[] {
  const grouped = new Set<string>()
  const nodes: PickerWorkspaceNode[] = []
  for (const workspace of input.workspaces) {
    const sessions: PickerSessionNode[] = []
    for (const sessionId of workspace.sessionIds) {
      grouped.add(sessionId)
      const node = sessionNodeOf(input, sessionId)
      if (node !== undefined) sessions.push(node)
    }
    if (sessions.length === 0) continue
    nodes.push({ id: workspace.id, title: workspace.title, path: workspace.path, sessions })
  }
  // Sessions no workspace accounts (e.g. a session created from a directory
  // that was never registered) still deserve a home in the picker.
  const leftovers: PickerSessionNode[] = []
  for (const sessionId of Object.keys(input.sessions)) {
    if (grouped.has(sessionId)) continue
    const node = sessionNodeOf(input, sessionId)
    if (node !== undefined) leftovers.push(node)
  }
  if (leftovers.length > 0) {
    nodes.push({ id: '__ungrouped', title: input.ungroupedLabel, path: '', sessions: leftovers })
  }
  return nodes
}

/** One flattened row of the tree, as the component renders it. */
export interface FlatRow {
  key: string
  depth: number
  kind: 'workspace' | 'session' | 'agent'
  workspace?: PickerWorkspaceNode | undefined
  session?: PickerSessionNode | undefined
  agent?: AgentNode | undefined
}

/**
 * Flatten visible nodes for rendering. Containers are emitted whether expanded
 * or not (the chevron lives on the row); children only when their ancestor is
 * in the expanded set.
 * @param nodes - built tree.
 * @param expanded - expanded container keys (`workspace:<id>`, `session:<id>`, `agent:<session>:<id>`).
 * @returns rows in visual order.
 */
export function flattenTree(nodes: readonly PickerWorkspaceNode[], expanded: ReadonlySet<string>): FlatRow[] {
  const rows: FlatRow[] = []
  const pushAgents = (agents: readonly AgentNode[], depth: number): void => {
    for (const agent of agents) {
      const key = `agent:${agent.sessionId}:${agent.id}`
      rows.push({ key, depth, kind: 'agent', agent })
      if (agent.children.length > 0 && expanded.has(key)) pushAgents(agent.children, depth + 1)
    }
  }
  for (const workspace of nodes) {
    const workspaceKey = `workspace:${workspace.id}`
    rows.push({ key: workspaceKey, depth: 0, kind: 'workspace', workspace })
    if (!expanded.has(workspaceKey)) continue
    for (const session of workspace.sessions) {
      const sessionKey = `session:${session.id}`
      rows.push({ key: sessionKey, depth: 1, kind: 'session', session })
      if (session.children.length === 0 || !expanded.has(sessionKey)) continue
      pushAgents(session.children, 2)
    }
  }
  return rows
}
