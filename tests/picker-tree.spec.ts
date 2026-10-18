/** The pure workspace → session → child-agent tree behind the target picker. */
import { describe, expect, it } from 'vitest'
import { buildPickerTree, flattenTree, shortId } from '../src/client/picker-tree.ts'
import type { PickerInput, PickerProjection, PickerWorkspaceSource } from '../src/client/picker-tree.ts'

/** One workspace row. */
function workspace(id: string, title: string, sessionIds: string[]): PickerWorkspaceSource {
  return { id, title, path: `C:\\work\\${title}`, sessionIds }
}

/** A ready projection. */
function ready(catalog: PickerProjection['catalog'] = [], teamMembers: PickerProjection['teamMembers'] = []): PickerProjection {
  return { state: 'ready', catalog, teamMembers }
}

/** Two workspaces: project-a with sessions s1/s2, project-b with s3. */
function base(overrides: Partial<PickerInput> = {}): PickerInput {
  return {
    workspaces: [workspace('w1', 'project-a', ['s1', 's2']), workspace('w2', 'project-b', ['s3'])],
    sessions: {
      s1: { id: 's1', displayTitle: 'fix login' },
      s2: { id: 's2', displayTitle: 'write docs' },
      s3: { id: 's3', displayTitle: 'other work' },
    },
    projections: {},
    archived: new Set(),
    ungroupedLabel: '未分组',
    ...overrides,
  }
}

describe('buildPickerTree', () => {
  it('groups sessions by workspace; the session row itself is the main-agent target (no extra row)', () => {
    const tree = buildPickerTree(base({
      projections: { s1: ready(), s2: ready(), s3: ready() },
    }))
    expect(tree.map(node => node.title)).toEqual(['project-a', 'project-b'])
    expect(tree[0]?.sessions.map(session => session.title)).toEqual(['fix login', 'write docs'])
    // A main-only session has no child rows and no expand chevron.
    expect(tree[0]?.sessions[0]).toMatchObject({
      id: 's1', children: [], childrenUnknown: false, expandable: false, childrenState: 'ready',
    })
  })

  it('reports unknown / loading / error children states for a session', () => {
    const unknown = buildPickerTree(base())
    expect(unknown[0]?.sessions[0]).toMatchObject({ childrenUnknown: true, expandable: false, childrenState: 'unknown' })
    expect(buildPickerTree(base({ projections: { s1: { state: 'loading' } } }))[0]?.sessions[0]?.childrenState).toBe('loading')
    expect(buildPickerTree(base({ projections: { s1: { state: 'error' } } }))[0]?.sessions[0]?.childrenState).toBe('error')
  })

  it('adds continuable subagents as selectable leaf children, labelled by their work description', () => {
    const tree = buildPickerTree(base({
      projections: { s1: ready([{ id: 'c1', mode: 'continuable', label: '探索代码库' }]), s2: ready(), s3: ready() },
    }))
    const session = tree[0]?.sessions[0]
    expect(session?.children).toHaveLength(1)
    expect(session?.children[0]).toMatchObject({
      id: 'c1', kind: 'subagent', label: '探索代码库', selectable: true,
      ancestors: ['s1'],
    })
    expect(session?.children[0]?.disabledReason).toBeUndefined()
    // Its own projections are not loaded yet: children unknown, and an unknown
    // row must not draw an expand chevron.
    expect(session?.children[0]).toMatchObject({ childrenUnknown: true, expandable: false })
    expect(session).toMatchObject({ expandable: true, childrenUnknown: false })
  })

  it('draws no chevron for a leaf child once its own catalog is known-empty', () => {
    const tree = buildPickerTree(base({
      projections: {
        s1: ready([{ id: 'c1', mode: 'continuable', label: 'leaf work' }]),
        c1: ready(),
        s2: ready(),
        s3: ready(),
      },
    }))
    expect(tree[0]?.sessions[0]?.children[0]).toMatchObject({
      id: 'c1', childrenUnknown: false, expandable: false, selectable: true,
    })
  })

  it('disables one-shot and unknown-mode subagents with a reason', () => {
    const tree = buildPickerTree(base({
      projections: {
        s1: ready([
          { id: 'c1', mode: 'one-shot', label: '一次性任务' },
          { id: 'c2', mode: 'unknown' },
        ]),
        s2: ready(),
        s3: ready(),
      },
    }))
    const children = tree[0]?.sessions[0]?.children ?? []
    expect(children[0]).toMatchObject({ id: 'c1', disabledReason: 'one-shot', selectable: false, detail: 'one-shot' })
    expect(children[1]).toMatchObject({ id: 'c2', disabledReason: 'unknown-mode', selectable: false, label: shortId('c2') })
  })

  it('uses the team member name (not the catalog description) and keeps the description as a note', () => {
    const tree = buildPickerTree(base({
      projections: {
        s1: ready(
          [{ id: 'm1', mode: 'continuable', label: '负责检索资料' }],
          [{ id: 'm1', name: 'researcher', role: 'teammate', phase: 'active' }],
        ),
        s2: ready(),
        s3: ready(),
      },
    }))
    const children = tree[0]?.sessions[0]?.children ?? []
    expect(children[0]).toMatchObject({
      id: 'm1',
      kind: 'member',
      label: 'researcher',
      note: '负责检索资料',
      detail: 'team-member',
      selectable: true,
    })
    // The lead member row is not rendered as a child agent.
    expect(children.some(agent => agent.kind === 'member' && agent.label === 'lead')).toBe(false)
  })

  it('marks non-active teammates as disabled', () => {
    const tree = buildPickerTree(base({
      projections: {
        s1: ready([], [
          { id: 'm1', name: 'writer', role: 'teammate', phase: 'provisioning' },
          { id: 'm2', name: 'failed-one', role: 'teammate', phase: 'failed' },
        ]),
        s2: ready(),
        s3: ready(),
      },
    }))
    const children = tree[0]?.sessions[0]?.children ?? []
    expect(children[0]).toMatchObject({ label: 'writer', disabledReason: 'provisioning', selectable: false })
    expect(children[1]).toMatchObject({ label: 'failed-one', disabledReason: 'failed', selectable: false })
  })

  it('recurses into a child session whose catalog is known', () => {
    const tree = buildPickerTree(base({
      projections: {
        s1: ready([{ id: 'c1', mode: 'continuable', label: '规划' }]),
        c1: ready([{ id: 'g1', mode: 'continuable', label: '实现' }]),
        s2: ready(),
        s3: ready(),
      },
    }))
    const child = tree[0]?.sessions[0]?.children[0]
    expect(child).toMatchObject({ id: 'c1', selectable: false, expandable: true, childrenUnknown: false })
    // A grandchild's delivery parent is its direct parent session (c1), not s1;
    // its stored chain is what lets the editor reopen at this nested target.
    expect(child?.children[0]).toMatchObject({
      id: 'g1', kind: 'subagent', label: '实现', selectable: true, sessionId: 'c1',
      ancestors: ['s1', 'c1'],
    })
  })

  it('hides archived, blank and child rows from the workspace list', () => {
    const tree = buildPickerTree(base({
      sessions: {
        s1: { id: 's1', displayTitle: 'archived one' },
        s2: { id: 's2', displayTitle: 'blank one', blank: true },
        s3: { id: 's3', displayTitle: 'child', origin: 'subagent' },
      },
      archived: new Set(['s1']),
    }))
    expect(tree).toEqual([])
  })

  it('gives sessions no workspace accounts an ungrouped bucket', () => {
    const tree = buildPickerTree(base({
      sessions: {
        s1: { id: 's1', displayTitle: 'in workspace' },
        loose: { id: 'loose', displayTitle: 'loose session' },
      },
      projections: { s1: ready(), loose: ready() },
    }))
    expect(tree.map(node => node.title)).toEqual(['project-a', '未分组'])
    expect(tree[1]?.sessions[0]?.id).toBe('loose')
  })
})

describe('flattenTree', () => {
  it('emits a session row as the selectable main-agent target, children only when expanded', () => {
    const tree = buildPickerTree(base({
      projections: { s1: ready([{ id: 'c1', mode: 'continuable', label: '子' }]), s2: ready(), s3: ready() },
    }))
    // Both workspace rows only.
    expect(flattenTree(tree, new Set())).toHaveLength(2)
    // Expanding a workspace shows its session rows (no main-agent row).
    expect(flattenTree(tree, new Set(['workspace:w1']))).toHaveLength(4)
    const rows = flattenTree(tree, new Set(['workspace:w1', 'session:s1']))
    expect(rows.map(row => row.kind)).toEqual(['workspace', 'session', 'agent', 'session', 'workspace'])
    expect(rows[1]).toMatchObject({ key: 'session:s1', depth: 1 })
    expect(rows[2]).toMatchObject({ key: 'agent:s1:c1', depth: 2 })
  })

  it('only emits a branching child\'s own children when that child is expanded', () => {
    const branched = buildPickerTree(base({
      projections: {
        s1: ready([{ id: 'c1', mode: 'continuable', label: '规划' }]),
        c1: ready([{ id: 'g1', mode: 'continuable', label: '实现' }]),
        s2: ready(),
        s3: ready(),
      },
    }))
    const collapsed = flattenTree(branched, new Set(['workspace:w1', 'session:s1']))
    expect(collapsed).toHaveLength(5)
    expect(collapsed.some(row => row.key === 'agent:c1:g1')).toBe(false)
    const expanded = flattenTree(branched, new Set(['workspace:w1', 'session:s1', 'agent:s1:c1']))
    expect(expanded).toHaveLength(6)
    expect(expanded.find(row => row.key === 'agent:c1:g1')).toMatchObject({ depth: 3 })
  })
})
