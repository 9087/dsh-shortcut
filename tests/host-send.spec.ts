/**
 * The host's delivery routing, driven through its own channel handler.
 *
 * `src/index.ts` is the half a browser cannot check: WHERE a record lands. Two rules matter
 * and neither is observable from the client, so they are asserted here against a fake
 * context:
 *
 * - a bound record always goes to its stored session, whatever the caller claims to be
 *   showing — the shown-session field is ignored, not trusted;
 * - an `anySession` record goes to the CALLER's session (always that session's main agent),
 *   and a caller that named none is refused with `no-current-session` instead of being
 *   redirected to the stored one, which is the behaviour the switch exists to turn off.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

/** One prompt as the host session controller received it. */
interface PromptRequest {
  requestId: string
  sessionId: string
  mode: string
  content: readonly { type: string; text: string }[]
}

/** One RPC result, in the shape the channel answers. */
interface HandlerResult {
  ok: boolean
  value?: unknown
  error?: { code: string; message: string }
}

/** The channel handler the plugin registers. */
type Handler = (endpoint: string, payload: unknown, signal: AbortSignal, peer: unknown) => Promise<HandlerResult>

/** One prompt as the host subagent runtime received it. */
interface ChildPromptRequest {
  requestId: string
  parentSessionId: string
  childSessionId: string
  mode: string
  delivery: string
  content: readonly { type: string; text: string }[]
}

/** One record as the channel returns it. */
interface EntryValue {
  id: string
  name: string
  sessionId: string
  anySession: boolean
  target: { kind: string }
}

const dirs: string[] = []
let previousHome: string | undefined

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-shortcut-host-'))
  dirs.push(dir)
  previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = dir
})

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
})

/**
 * Mount the plugin on a fake context and return a caller for its channel.
 *
 * The fake is deliberately thin: `apply` asks the context for the connection service (to
 * register the channel) and, per delivery, for `sessionController`. Everything else it
 * touches is the logger.
 */
function mount(): { call: (endpoint: string, payload: unknown) => Promise<HandlerResult>; prompts: PromptRequest[] } {
  const prompts: PromptRequest[] = []
  const childPrompts: ChildPromptRequest[] = []
  let handler: Handler | undefined
  const ctx = {
    /** The plugin owns its channel through an effect; running it mounts the handler. */
    effect(callback: () => void | (() => void)): void {
      callback()
    },
    get(name: string): unknown {
      if (name === 'connection') {
        return {
          register: (_owner: unknown, _channel: string, next: Handler) => {
            handler = next
            return async () => {}
          },
        }
      }
      if (name === 'sessionController') {
        return {
          prompt: async (request: PromptRequest) => {
            prompts.push(request)
            return { accepted: true }
          },
        }
      }
      if (name === 'subagents') {
        return {
          prompt: async (request: ChildPromptRequest) => {
            childPrompts.push(request)
            return { messageId: 'message-1' }
          },
        }
      }
      return undefined
    },
    logger: { info() {}, warn() {}, error() {} },
  }
  apply(ctx as never)
  if (handler === undefined) throw new Error('the plugin registered no channel handler')
  return {
    prompts,
    childPrompts,
    call: (endpoint, payload) => handler!(endpoint, payload, new AbortController().signal, {}),
  }
}

/** Create one record through the channel and return it. */
async function create(
  call: (endpoint: string, payload: unknown) => Promise<HandlerResult>,
  draft: Record<string, unknown>,
): Promise<EntryValue> {
  const result = await call('create', {
    draft: { name: 'n', sessionId: 'session-stored', target: { kind: 'main' }, text: 'hello', ...draft },
  })
  expect(result.ok).toBe(true)
  return (result.value as { entry: EntryValue }).entry
}

describe('host delivery routing', () => {
  it('stores the any-session switch, defaulting it off', async () => {
    const { call } = mount()
    const bound = await create(call, { name: 'bound' })
    const anywhere = await create(call, { name: 'anywhere', anySession: true })
    expect(bound.anySession).toBe(false)
    expect(anywhere.anySession).toBe(true)
  })

  it('sends a bound record to its stored session, ignoring the caller\'s shown session', async () => {
    const { call, prompts } = mount()
    const entry = await create(call, { name: 'bound' })
    const result = await call('send', { id: entry.id, currentSessionId: 'session-shown' })
    expect(result.ok).toBe(true)
    expect(prompts.map(request => request.sessionId)).toEqual(['session-stored'])
    // The receipt names where it really went, so a client that navigates follows it there.
    expect((result.value as { entry: { sessionId: string } }).entry.sessionId).toBe('session-stored')
  })

  it('sends an any-session record to the caller\'s shown session', async () => {
    const { call, prompts } = mount()
    const entry = await create(call, { name: 'anywhere', anySession: true })
    const result = await call('send', { id: entry.id, currentSessionId: 'session-shown' })
    expect(result.ok).toBe(true)
    expect(prompts.map(request => request.sessionId)).toEqual(['session-shown'])
    expect(prompts[0]?.content).toEqual([{ type: 'text', text: 'hello' }])
    // Delivered to that session's own agent, not to whatever agent the record was saved at.
    expect((result.value as { entry: { sessionId: string; target: { kind: string } } }).entry)
      .toMatchObject({ sessionId: 'session-shown', target: { kind: 'main' } })
  })

  it('delivers to the CHILD when the open conversation is a subagent, not to its main agent', async () => {
    // The shell can open a subagent as its own conversation; that child is not reachable
    // through the session controller, so the delivery must take the subagent runtime.
    const { call, prompts, childPrompts } = mount()
    const entry = await create(call, { name: 'anywhere', anySession: true })
    const result = await call('send', {
      id: entry.id,
      currentSessionId: 'session-child',
      currentParentSessionId: 'session-parent',
    })
    expect(result.ok).toBe(true)
    expect(prompts).toEqual([])
    expect(childPrompts).toHaveLength(1)
    expect(childPrompts[0]).toMatchObject({
      parentSessionId: 'session-parent',
      childSessionId: 'session-child',
      mode: 'continuable',
      delivery: 'queue',
      content: [{ type: 'text', text: 'hello' }],
    })
    // The receipt describes the child the same way a stored child target would, so a client
    // that navigates reopens the subagent rather than its parent's conversation.
    expect((result.value as { entry: { sessionId: string; target: { kind: string; childSessionId?: string } } }).entry)
      .toMatchObject({
        sessionId: 'session-parent',
        target: { kind: 'subagent', childSessionId: 'session-child' },
      })
  })

  it('still sends a BOUND record to its stored session when the open conversation is a child', async () => {
    // The parent field rides along on every send; a bound record must ignore it entirely.
    const { call, prompts, childPrompts } = mount()
    const entry = await create(call, { name: 'bound' })
    const result = await call('send', {
      id: entry.id,
      currentSessionId: 'session-child',
      currentParentSessionId: 'session-parent',
    })
    expect(result.ok).toBe(true)
    expect(prompts.map(request => request.sessionId)).toEqual(['session-stored'])
    expect(childPrompts).toEqual([])
  })

  it('refuses an any-session record when the caller showed no session', async () => {
    const { call, prompts } = mount()
    const entry = await create(call, { name: 'anywhere', anySession: true })
    const result = await call('send', { id: entry.id })
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('no-current-session')
    // Nothing was delivered anywhere: the stored session is NOT a fallback.
    expect(prompts).toEqual([])
  })

  it('answers not-found for an id that is not stored', async () => {
    const { call, prompts } = mount()
    const result = await call('send', { id: 'gone', currentSessionId: 'session-shown' })
    expect(result.error?.code).toBe('not-found')
    expect(prompts).toEqual([])
  })
})
