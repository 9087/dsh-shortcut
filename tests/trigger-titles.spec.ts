/** The trigger-card title bridge: only OUR cards are retitled, and React passes are re-patched. */
import { afterEach, describe, expect, it } from 'vitest'
import { attachTriggerTitles } from '../src/client/trigger-titles.ts'
import { publishedCardName, publishSeat, unpublishSeat } from '../src/client/session-bridge.ts'

// jsdom only ships requestAnimationFrame when it was created "visual"; the bridge schedules its
// passes on it, so give the test environment one.
const globals = globalThis as unknown as {
  requestAnimationFrame?: (callback: (time: number) => void) => number
  cancelAnimationFrame?: (handle: number) => void
}
if (typeof globals.requestAnimationFrame !== 'function') {
  globals.requestAnimationFrame = callback => setTimeout(() => { callback(Date.now()) }, 0) as unknown as number
  globals.cancelAnimationFrame = handle => { clearTimeout(handle as unknown as ReturnType<typeof setTimeout>) }
}

/** The plugin's own translations. */
const t = ((key: string) => key === 'card.title' ? '快捷方式' : key) as never

/** One wake card, shaped like the shell's: icon span, title span, time, chevron. */
function card(key: string, title: string): string {
  return `
    <div data-chat-flow-kind="turn-trigger" data-chat-node-key="${key}">
      <section data-turn-trigger>
        <button type="button" aria-expanded="false">
          <span class="icon"><svg></svg></span>
          <span class="title">${title}</span>
          <time>23:13</time>
          <svg class="chevron"></svg>
        </button>
      </section>
    </div>`
}

/** A chat snapshot carrying one node, in the shape the seat publishes. */
function snapshot(nodes: readonly Record<string, unknown>[]): unknown {
  // The real snapshot exposes ordered nodes through `order` + `nodes.get`, which is the reader
  // `nodesOf` falls back to: a bare Map's iterator is not an array, so it would not be read.
  const byKey = new Map(nodes.map(node => [String(node['key']), node]))
  return { order: [...byKey.keys()], nodes: { get: (key: string) => byKey.get(key) } }
}

/** Poll until `check` is true, or fail with the last DOM for debugging. */
async function until(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`condition not met; body:\n${document.body.innerHTML}`)
}

/** The title text of one card. */
function titleOf(key: string): string {
  return document.querySelector(`[data-chat-node-key="${key}"] .title`)?.textContent ?? ''
}

const disposers: Array<() => void> = []

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  unpublishSeat(undefined)
  document.body.innerHTML = ''
})

/** Mount one card and attach the bridge. */
function mount(html: string): void {
  document.body.innerHTML = html
  disposers.push(attachTriggerTitles({ t }))
}

describe('trigger card titles', () => {
  it('titles a delivered shortcut with the record it came from', async () => {
    mount(card('key-1', '收到执行请求'))
    publishSeat('session-1', snapshot([
      { kind: 'turn-trigger', key: 'key-1', data: { source: { kind: 'shortcut', shortcutName: '部署到测试环境' } } },
    ]))
    // The join the bridge depends on: the card's own node key → the record's name.
    expect(publishedCardName('key-1')).toBe('部署到测试环境')
    await until(() => titleOf('key-1') === '快捷方式 · 部署到测试环境')
    expect(document.querySelector('[data-chat-node-key="key-1"]')?.hasAttribute('data-dsh-shortcut-card')).toBe(true)
  })

  it('leaves every other wake source alone', async () => {
    // A scheduled reminder, a goal, a webhook: the shell's own titles must survive untouched.
    mount(card('card-schedule', '自动化任务') + card('card-webhook', '收到外部事件'))
    publishSeat('session-1', snapshot([
      { kind: 'turn-trigger', key: 'card-schedule', data: { source: { kind: 'schedule' } } },
      { kind: 'turn-trigger', key: 'card-webhook', data: { source: { kind: 'webhook', provider: 'github' } } },
    ]))
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(titleOf('card-schedule')).toBe('自动化任务')
    expect(titleOf('card-webhook')).toBe('收到外部事件')
  })

  it('re-applies after a React pass rewrites the header', async () => {
    mount(card('key-1', '收到执行请求'))
    publishSeat('session-1', snapshot([
      { kind: 'turn-trigger', key: 'key-1', data: { source: { kind: 'shortcut', shortcutName: '重启服务' } } },
    ]))
    await until(() => titleOf('key-1') === '快捷方式 · 重启服务')
    // Simulate the shell re-rendering its own title into the same node.
    const span = document.querySelector('[data-chat-node-key="key-1"] .title')
    if (span !== null) span.textContent = '收到执行请求'
    await until(() => titleOf('key-1') === '快捷方式 · 重启服务')
  })

  it('stops when disposed', async () => {
    mount(card('key-1', '收到执行请求'))
    for (const dispose of disposers.splice(0)) dispose()
    publishSeat('session-1', snapshot([
      { kind: 'turn-trigger', key: 'key-1', data: { source: { kind: 'shortcut', shortcutName: '重启服务' } } },
    ]))
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(titleOf('key-1')).toBe('收到执行请求')
  })
})
