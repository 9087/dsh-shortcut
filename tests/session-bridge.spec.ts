/** The chat-view bridge: snapshot parsing, text derivation, DOM fallback. */
import { afterEach, describe, expect, it } from 'vitest'
import {
  publishedSessionId, publishedText, publishSeat, scrapeBubbleText, unpublishSeat,
} from '../src/client/session-bridge.ts'

/** One fake chat node. */
interface Node {
  key: string
  kind: string
  data?: unknown
}

/** Build a chat snapshot shaped like the shell's: ordered keys plus a keyed store. */
function snapshotOf(nodes: Node[]): unknown {
  const byKey = new Map(nodes.map(node => [node.key, node]))
  return {
    order: nodes.map(node => node.key),
    nodes: {
      get: (key: string) => byKey.get(key),
      values: () => [...byKey.values()],
    },
  }
}

/** A user message node. */
function userNode(key: string, content: unknown[]): Node {
  return { key, kind: 'user', data: { content } }
}

afterEach(() => {
  unpublishSeat(publishedSnapshot())
  document.body.innerHTML = ''
})

/** The snapshot last published, for cleanup. */
let lastSnapshot: unknown
function publishedSnapshot(): unknown {
  return lastSnapshot
}

describe('publishSeat', () => {
  it('publishes the session id and derives user-message text by node key', () => {
    lastSnapshot = snapshotOf([
      userNode('k1', [{ type: 'text', text: '重启服务' }]),
      userNode('k2', [{ type: 'text', text: 'part one' }, { type: 'text', text: 'part two' }]),
      { key: 'a1', kind: 'assistant', data: { content: [{ type: 'text', text: 'ignored' }] } },
    ])
    publishSeat('session-a', lastSnapshot)
    expect(publishedSessionId()).toBe('session-a')
    expect(publishedText('k1')).toBe('重启服务')
    expect(publishedText('k2')).toBe('part one\npart two')
    expect(publishedText('a1')).toBeUndefined()
    expect(publishedText('missing')).toBeUndefined()
  })

  it('ignores nodes without a key or with non-text content', () => {
    lastSnapshot = snapshotOf([
      { key: 'image', kind: 'user', data: { content: [{ type: 'image' }] } },
    ])
    publishSeat('s', lastSnapshot)
    expect(publishedText('image')).toBeUndefined()
  })

  it('ignores a repeated publish of the same snapshot', () => {
    lastSnapshot = snapshotOf([userNode('k1', [{ type: 'text', text: 'hello' }])])
    publishSeat('s', lastSnapshot)
    publishSeat('s', lastSnapshot)
    expect(publishedText('k1')).toBe('hello')
  })

  it('clears the facts when the publishing seat unmounts', () => {
    lastSnapshot = snapshotOf([userNode('k1', [{ type: 'text', text: 'hello' }])])
    publishSeat('s', lastSnapshot)
    unpublishSeat(lastSnapshot)
    expect(publishedSessionId()).toBeUndefined()
    expect(publishedText('k1')).toBeUndefined()
  })

  it('does not let an old seat clear a newer publish', () => {
    const older = snapshotOf([userNode('k1', [{ type: 'text', text: 'older' }])])
    const newer = snapshotOf([userNode('k2', [{ type: 'text', text: 'newer' }])])
    publishSeat('s1', older)
    publishSeat('s2', newer)
    unpublishSeat(older)
    expect(publishedSessionId()).toBe('s2')
    expect(publishedText('k2')).toBe('newer')
  })
})

describe('scrapeBubbleText', () => {
  it('reads the bubble text and drops the action row', () => {
    document.body.innerHTML = `
      <div data-chat-flow-kind="user">
        <div><div class="bubble">hello <span>world</span></div></div>
        <div data-clock="start"><span>12:00</span><button type="button">copy</button></div>
      </div>`
    const flow = document.querySelector('[data-chat-flow-kind="user"]')
    expect(flow).not.toBeNull()
    expect(scrapeBubbleText(flow as Element)).toBe('hello world')
  })

  it('returns an empty string for an unknown shape', () => {
    document.body.innerHTML = '<div><button>copy</button></div>'
    expect(scrapeBubbleText(document.body)).toBe('')
  })
})
