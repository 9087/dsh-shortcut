/** The DOM bridge: placement, idempotency, self-healing, capture and teardown. */
import { afterEach, describe, expect, it } from 'vitest'
import { attachBubbleCapture } from '../src/client/bubble-capture.ts'
import { unpublishSeat } from '../src/client/session-bridge.ts'

// jsdom only ships requestAnimationFrame when it was created "visual"; the
// bridge schedules its scans on it, so give the test environment one.
const globals = globalThis as unknown as {
  requestAnimationFrame?: (callback: (time: number) => void) => number
  cancelAnimationFrame?: (handle: number) => void
}
if (typeof globals.requestAnimationFrame !== 'function') {
  globals.requestAnimationFrame = callback => setTimeout(() => { callback(Date.now()) }, 0) as unknown as number
  globals.cancelAnimationFrame = handle => { clearTimeout(handle as unknown as ReturnType<typeof setTimeout>) }
}

/** The plugin's own translations, for the injected label. */
const t = ((key: string) => key === 'bubble.add' ? '加入快捷方式' : key) as never

/** One user bubble whose action row holds only the stock copy control. */
const BUBBLE = `
  <div data-chat-flow-kind="user" data-chat-node-key="node-1">
    <div data-slot="conversation.chat.node" style="display:contents">
      <div>
        <div class="bubble">hi</div>
        <div class="row" data-clock="start">
          <span>12:00</span>
          <button class="action-class" type="button" aria-label="copy">copy</button>
        </div>
      </div>
    </div>
  </div>`

/** Poll until `check` is true, or fail with the last DOM for debugging. */
async function until(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`condition not met; body:\n${document.body.innerHTML}`)
}

const disposers: Array<() => void> = []

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  unpublishSeat(undefined)
  document.body.innerHTML = ''
})

/** Mount the button fixture and attach the bridge. */
function mount(): { adds: Array<{ sessionId?: string | undefined; text: string }>; dispose: () => void } {
  document.body.innerHTML = BUBBLE
  const adds: Array<{ sessionId?: string | undefined; text: string }> = []
  const dispose = attachBubbleCapture({ t, onCapture: capture => adds.push(capture) })
  disposers.push(dispose)
  return { adds, dispose }
}

/** The injected control in the only action row. */
function injected(): HTMLButtonElement | null {
  return document.querySelector('[data-dsh-shortcut-add]')
}

/** The stock copy control. */
function copy(): HTMLButtonElement | null {
  return document.querySelector('[data-clock="start"] button:not([data-dsh-shortcut-add])')
}

describe('attachBubbleCapture', () => {
  it('injects exactly one button, immediately left of copy, styled by the copy control', async () => {
    mount()
    await until(() => injected() !== null)
    const button = injected()
    const stock = copy()
    expect(button).not.toBeNull()
    expect(stock).not.toBeNull()
    expect(document.querySelectorAll('[data-dsh-shortcut-add]')).toHaveLength(1)
    expect(button!.nextElementSibling).toBe(stock)
    expect(button!.className).toBe(stock!.className)
    expect(button!.getAttribute('aria-label')).toBe('加入快捷方式')
    expect(button!.title).toBe('加入快捷方式')
  })

  it('delivers the bubble text when the injected control is pressed', async () => {
    const { adds } = mount()
    await until(() => injected() !== null)
    injected()!.click()
    await until(() => adds.length === 1)
    expect(adds[0]).toEqual({ sessionId: undefined, text: 'hi' })
  })

  it('stays idempotent across unrelated DOM mutations', async () => {
    mount()
    await until(() => injected() !== null)
    for (let index = 0; index < 3; index++) {
      const extra = document.createElement('div')
      document.body.appendChild(extra)
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    expect(document.querySelectorAll('[data-dsh-shortcut-add]')).toHaveLength(1)
  })

  it('re-injects the control after React removes it', async () => {
    mount()
    await until(() => injected() !== null)
    injected()!.remove()
    const extra = document.createElement('div')
    document.body.appendChild(extra)
    await until(() => injected() !== null)
    expect(injected()!.nextElementSibling).toBe(copy())
  })

  it('skips optimistic bubbles that carry no durable node key', async () => {
    document.body.innerHTML = BUBBLE.replace(' data-chat-node-key="node-1"', '')
    const dispose = attachBubbleCapture({ t, onCapture: () => {} })
    disposers.push(dispose)
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(injected()).toBeNull()
  })

  it('tears down the observer, the listener and every injected control', async () => {
    const { adds, dispose } = mount()
    await until(() => injected() !== null)
    dispose()
    disposers.length = 0
    expect(injected()).toBeNull()
    // A click after teardown reaches nobody.
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(adds).toHaveLength(0)
  })
})
