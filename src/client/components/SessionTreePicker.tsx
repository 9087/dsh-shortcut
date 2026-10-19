/**
 * The inline target picker: workspace → session → child agent.
 *
 * There is no dropdown: the dialog shows one read-only full-path line followed
 * by the tree itself, always visible. A workspace row only groups (native
 * folder icon, not selectable); a session row IS its main-agent target; an
 * expand arrow appears only when a session or subagent really has children.
 * Subagent children are loaded on demand (`refreshProjections`), because DSH
 * does not persist those projections — so an unloaded projection is "children
 * unknown", and rows are prefetched in the background (bounded by the
 * catalog's read queue) so a chevron is drawn only for real branches.
 *
 * @module dsh-shortcut/client/components/SessionTreePicker
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  IconChevronRightOutlineRegular, IconFolderCloseRegular, IconFolderOpenRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { ensureProjections, useCatalogReady, usePickerTree } from '../catalog.ts'
import type { EditorTarget } from '../editor.ts'
import type { Translate } from '../locale.ts'
import { flattenTree } from '../picker-tree.ts'
import type { AgentNode, FlatRow, PickerSessionNode } from '../picker-tree.ts'
import css from '../styles.module.css'
import type { ReactNode } from 'react'

/** What is currently selected in the dialog. */
export interface TreeSelection {
  sessionId: string
  target: EditorTarget
}

/** Props for the picker. */
export interface SessionTreePickerProps {
  t: Translate
  /** Current selection, or undefined when nothing is selected yet. */
  selection?: TreeSelection | undefined
  /** Called when one target row is picked. */
  onSelect: (selection: TreeSelection) => void
  /**
   * Show the tree as CONTEXT rather than a control: the selected row is still revealed, but
   * nothing can be picked, expanded or searched. Used while a shortcut sends to any session,
   * where the stored target does not decide the delivery.
   */
  disabled?: boolean
  /**
   * Replace the read-only path line's text. A locked tree whose stored target no longer
   * decides anything should not keep naming that target.
   */
  pathOverride?: string | undefined
}

/** One detail token rendered as a small tag. */
function detailLabel(t: Translate, detail: AgentNode['detail']): string | undefined {
  switch (detail) {
    case 'team-member': return t('picker.tagMember')
    case 'one-shot': return t('picker.tagOneShot')
    case 'unknown-mode': return t('picker.tagUnknownMode')
    case 'provisioning': return t('picker.tagProvisioning')
    case 'failed': return t('picker.tagFailed')
    default: return undefined
  }
}

/** Why one agent row is disabled. */
function disabledLabel(t: Translate, agent: AgentNode): string | undefined {
  switch (agent.disabledReason) {
    case 'one-shot': return t('picker.disabledOneShot')
    case 'unknown-mode': return t('picker.disabledUnknownMode')
    case 'provisioning': return t('picker.disabledProvisioning')
    case 'failed': return t('picker.disabledFailed')
    default: return undefined
  }
}

/** Case-insensitive substring test that tolerates empty needles. */
function matches(haystack: string, needle: string): boolean {
  return needle.length === 0 || haystack.toLocaleLowerCase().includes(needle)
}

/** Keep agent nodes matching the query or having a matching descendant. */
function filterAgents(agents: readonly AgentNode[], needle: string): AgentNode[] {
  return agents.flatMap((agent) => {
    const self = matches(`${agent.label} ${agent.note ?? ''}`, needle)
    const children = filterAgents(agent.children, needle)
    if (!self && children.length === 0) return []
    return [{ ...agent, children: self ? agent.children : children }]
  })
}

/** Keep sessions matching the query, or whose child agents match it. */
function filterSessions(sessions: readonly PickerSessionNode[], needle: string): PickerSessionNode[] {
  return sessions.flatMap((session) => {
    const self = matches(session.title, needle)
    const children = filterAgents(session.children, needle)
    if (!self && children.length === 0) return []
    return [{ ...session, children: self ? session.children : children }]
  })
}

/** Resolve a target's display path from the loaded tree. */
function pathOf(
  tree: ReturnType<typeof usePickerTree>,
  selection: TreeSelection | undefined,
  placeholder: string,
): string {
  if (selection === undefined) return placeholder
  const workspace = tree.find(item => item.sessions.some(session => session.id === selection.sessionId))
  const session = workspace?.sessions.find(item => item.id === selection.sessionId)
  const leaf = selection.target.kind === 'main'
    ? undefined
    : selection.target.leafLabel ?? selection.target.childSessionId?.slice(0, 8)
  return [workspace?.title, session?.title, leaf]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join(' / ')
}

/** The inline picker component. */
export function SessionTreePicker({
  t, selection, onSelect, disabled = false, pathOverride,
}: SessionTreePickerProps): ReactNode {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const tree = usePickerTree(t('picker.ungrouped'))
  const ready = useCatalogReady()
  const listId = useId()
  const listRef = useRef<HTMLDivElement | null>(null)
  /** Selection key already auto-revealed, so a later user collapse is not undone. */
  const revealedRef = useRef<string | undefined>(undefined)
  /** The ONE selection that still needs its row scrolled into view (reopen only). */
  const revealScrollRef = useRef<string | undefined>(undefined)

  const needle = query.trim().toLocaleLowerCase()
  const visible = useMemo(() => (needle.length === 0
    ? tree
    : tree.flatMap(workspace => {
      const self = matches(workspace.title, needle)
      const sessions = filterSessions(workspace.sessions, needle)
      if (!self && sessions.length === 0) return []
      return [{ ...workspace, sessions: self ? workspace.sessions : sessions }]
    })), [tree, needle])
  const rows = useMemo(() => flattenTree(visible, expanded), [visible, expanded])
  const path = pathOf(tree, selection, t('picker.placeholder'))
  const activeKey = selection === undefined
    ? undefined
    : selection.target.kind === 'main'
      ? `session:${selection.sessionId}`
      : `agent:${selection.sessionId}:${selection.target.childSessionId ?? selection.sessionId}`

  // A selected target must be visible when the dialog opens: expand its
  // workspace, every ancestor session/agent in the stored chain, and ask for the
  // projections needed to resolve that chain (a subagent's row may not exist
  // yet). Runs once per selection so the reader can still collapse things.
  useEffect(() => {
    if (selection === undefined || activeKey === undefined) return
    if (revealedRef.current === activeKey) return
    const target = selection.target
    const chain = target.kind === 'main'
      ? [selection.sessionId]
      : target.ancestors !== undefined && target.ancestors.length > 0
        ? [...target.ancestors, target.childSessionId ?? selection.sessionId]
        : [selection.sessionId]
    const root = chain[0]
    const workspace = tree.find(item => item.sessions.some(session => session.id === root))
    if (workspace === undefined) {
      // The list has not landed yet (or a legacy target has no chain to a
      // top-level session); request the known parent and retry on the next tree.
      void ensureProjections(selection.sessionId)
      return
    }
    const keys = new Set<string>([`workspace:${workspace.id}`, `session:${root}`])
    for (let index = 1; index < chain.length; index += 1) {
      keys.add(`agent:${chain[index - 1]}:${chain[index]}`)
    }
    setExpanded((current) => {
      let changed = false
      const next = new Set(current)
      for (const key of keys) {
        if (!next.has(key)) {
          next.add(key)
          changed = true
        }
      }
      return changed ? next : current
    })
    for (const id of chain) void ensureProjections(id)
    revealedRef.current = activeKey
    // Entering the dialog with a stored target is the only case that scrolls:
    // the row may be off-screen after the expansion above.
    revealScrollRef.current = activeKey
  }, [activeKey, selection, tree])

  // Scroll ONLY for the reveal above. A row the reader pressed is already where
  // they looked, so picking it must never move the list.
  useEffect(() => {
    if (activeKey === undefined || revealScrollRef.current !== activeKey) return
    const row = listRef.current?.querySelector('[data-dsh-shortcut-selected]')
    if (row === null || row === undefined) return
    row.scrollIntoView({ block: 'center' })
    revealScrollRef.current = undefined
  }, [activeKey, rows])

  // Search expands every surviving container so matches are visible.
  useEffect(() => {
    if (needle.length === 0) return
    const next = new Set<string>()
    for (const workspace of visible) {
      next.add(`workspace:${workspace.id}`)
      for (const session of workspace.sessions) {
        next.add(`session:${session.id}`)
        for (const agent of session.children) next.add(`agent:${agent.sessionId}:${agent.id}`)
      }
    }
    setExpanded(next)
  }, [needle, visible])

  // Every rendered session/agent row starts as "children unknown". Ask for those
  // projections in the background (bounded by the catalog's read queue) so a row
  // gets an expand chevron only when it really has children.
  useEffect(() => {
    for (const row of rows) {
      if (row.kind === 'session' && row.session !== undefined && row.session.childrenUnknown) {
        void ensureProjections(row.session.id)
        continue
      }
      const agent = row.agent
      if (agent !== undefined && agent.childrenUnknown) void ensureProjections(agent.id)
    }
  }, [rows])

  const selectionKey = selection === undefined
    ? undefined
    : selection.target.kind === 'main'
      ? `session:${selection.sessionId}`
      : `agent:${selection.sessionId}:${selection.target.childSessionId ?? selection.sessionId}`

  const toggle = (key: string): void => {
    // A locked tree still reveals its selected chain (that happens in an effect), but a
    // press must not change what is on screen: this tree is context, not a control.
    if (disabled) return
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  /** Toggle one session's children (the session row itself selects the main agent). */
  const toggleSession = (session: PickerSessionNode): void => {
    toggle(`session:${session.id}`)
  }

  /** Pick one session's main agent as the target. */
  const pickSession = (session: PickerSessionNode): void => {
    if (disabled) return
    // Mark the picked key as already revealed so the reopen-reveal effect does
    // not run again (and never scrolls) for a row the reader just pressed.
    revealedRef.current = `session:${session.id}`
    onSelect({ sessionId: session.id, target: { kind: 'main' } })
  }

  const toggleAgent = (agent: AgentNode): void => {
    toggle(`agent:${agent.sessionId}:${agent.id}`)
  }

  const pickAgent = (agent: AgentNode): void => {
    if (disabled || !agent.selectable) return
    // Same as the session row: a user pick never triggers the reopen scroll.
    revealedRef.current = `agent:${agent.sessionId}:${agent.id}`
    onSelect({
      sessionId: agent.sessionId,
      target: {
        kind: agent.kind,
        childSessionId: agent.id,
        leafLabel: agent.label,
        ancestors: [...agent.ancestors],
      },
    })
  }

  const renderRow = (row: FlatRow): ReactNode => {
    const indent = 8 + row.depth * 16
    if (row.kind === 'workspace' && row.workspace !== undefined) {
      const workspace = row.workspace
      const expandedNow = expanded.has(row.key)
      return (
        <div key={row.key} role="treeitem" aria-expanded={expandedNow}>
          <button
            type="button"
            className={css.treeRow}
            style={{ paddingLeft: indent }}
            data-dsh-shortcut-tree-workspace={workspace.id}
            onClick={() => { toggle(row.key) }}
          >
            <span className={expandedNow ? `${css.treeChevron} ${css.treeChevronOpen}` : css.treeChevron}>
              <IconChevronRightOutlineRegular size={12} />
            </span>
            {/* The folder icon is the native sidebar's grouping affordance: it
                marks a row that only groups — a workspace cannot be a target. */}
            <span className={css.treeGroupIcon} data-dsh-shortcut-group-icon="">
              {expandedNow ? <IconFolderOpenRegular size={14} /> : <IconFolderCloseRegular size={14} />}
            </span>
            <span className={css.treeWorkspaceLabel}>{workspace.title}</span>
            <span className={css.treeCount}>{workspace.sessions.length}</span>
          </button>
        </div>
      )
    }
    if (row.kind === 'session' && row.session !== undefined) {
      const session = row.session
      const expandedNow = expanded.has(row.key)
      const selected = selectionKey === row.key
      return (
        <div
          key={row.key}
          className={[css.treeSessionRow, selected ? css.treeRowSelected : ''].filter(Boolean).join(' ')}
          style={{ paddingLeft: indent }}
          role="treeitem"
          aria-selected={selected}
          aria-expanded={session.expandable ? expandedNow : undefined}
          {...(selected ? { 'data-dsh-shortcut-selected': '' } : {})}
        >
          {session.expandable
            ? (
                <button
                  type="button"
                  className={css.treeChevronButton}
                  data-dsh-shortcut-tree-expand={session.id}
                  aria-label={expandedNow ? t('picker.collapse') : t('picker.expand')}
                  onClick={() => { toggleSession(session) }}
                >
                  <span className={expandedNow ? `${css.treeChevron} ${css.treeChevronOpen}` : css.treeChevron}>
                    <IconChevronRightOutlineRegular size={12} />
                  </span>
                </button>
              )
            : <span className={css.treeChevronSpacer} />}
          <button
            type="button"
            className={css.treeSessionSelect}
            data-dsh-shortcut-tree-session={session.id}
            onClick={() => { pickSession(session) }}
          >
            <span className={css.treeLabel}>{session.title}</span>
          </button>
        </div>
      )
    }
    const agent = row.agent
    if (agent === undefined) return null
    const expandedNow = expanded.has(row.key)
    const isSelected = selectionKey === row.key
    const canExpand = agent.expandable
    const detail = detailLabel(t, agent.detail)
    const reason = disabledLabel(t, agent)
    return (
      <div
        key={row.key}
        role="treeitem"
        aria-selected={isSelected}
        aria-expanded={canExpand ? expandedNow : undefined}
        {...(isSelected ? { 'data-dsh-shortcut-selected': '' } : {})}
      >
        <button
          type="button"
          className={[
            css.treeAgentRow,
            isSelected ? css.treeRowSelected : '',
            agent.selectable ? '' : css.treeRowDisabled,
          ].filter(Boolean).join(' ')}
          style={{ paddingLeft: indent }}
          data-dsh-shortcut-tree-agent={agent.id}
          data-dsh-shortcut-tree-kind={agent.kind}
          {...(agent.selectable ? {} : { 'aria-disabled': true, title: reason })}
          onClick={() => {
            if (canExpand) toggleAgent(agent)
            else pickAgent(agent)
          }}
        >
          <span className={canExpand ? (expandedNow ? `${css.treeChevron} ${css.treeChevronOpen}` : css.treeChevron) : css.treeChevronEmpty}>
            {canExpand ? <IconChevronRightOutlineRegular size={12} /> : null}
          </span>
          <span className={css.treeAgentText}>
            <span className={css.treeLabel}>{agent.label}</span>
            {agent.note !== undefined && <span className={css.treeNote}>{agent.note}</span>}
            {reason !== undefined && <span className={css.treeNote}>{reason}</span>}
          </span>
          {detail !== undefined && <span className={css.treeTag}>{detail}</span>}
        </button>
      </div>
    )
  }

  const shownPath = pathOverride ?? path
  return (
    <div
      className={disabled ? `${css.treeInline} ${css.treeLocked}` : css.treeInline}
      data-dsh-shortcut-picker=""
      {...(disabled ? { 'data-dsh-shortcut-picker-locked': '', 'aria-disabled': true } : {})}
    >
      {/* Read-only: the full path of the current target — or, for a locked tree, what
          decides the delivery instead. Pressing it does nothing. */}
      <div
        className={selection === undefined && pathOverride === undefined
          ? `${css.treePath} ${css.treePathEmpty}`
          : css.treePath}
        data-dsh-shortcut-target=""
        title={shownPath}
        aria-label={t('picker.selectedAria')}
        aria-readonly="true"
      >
        {shownPath}
      </div>
      <div className={css.treeSearchRow}>
        <input
          className={css.treeSearch}
          value={query}
          placeholder={t('picker.search')}
          data-dsh-shortcut-tree-search=""
          disabled={disabled}
          onChange={(event) => { setQuery(event.currentTarget.value) }}
        />
      </div>
      <div className={css.treeList} id={listId} role="tree" aria-label={t('picker.treeLabel')} ref={listRef}>
        {!ready && <p className={css.treeNotice}>{t('picker.loading')}</p>}
        {ready && rows.length === 0 && <p className={css.treeNotice}>{t('picker.noMatch')}</p>}
        {rows.map(renderRow)}
        {rows.some(row => row.kind === 'session' && expanded.has(row.key)
          && row.session !== undefined && row.session.childrenState === 'loading') && (
          <p className={css.treeNotice}>{t('picker.loadingChildren')}</p>
        )}
        {rows.some(row => row.kind === 'session' && expanded.has(row.key)
          && row.session !== undefined && row.session.childrenState === 'error') && (
          <p className={css.treeNotice}>{t('picker.loadFailed')}</p>
        )}
      </div>
    </div>
  )
}
