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
 * What the fake model runtime should do for one mount.
 *
 * `answer` is the model's text reply as one streamed delta; `chunks` yields raw chunks instead
 * (to exercise the block-only and `finish`-error shapes); a mount without either has no model
 * runtime at all (the profile shape naming must survive); `fails` makes the provider throw.
 */
interface ModelOptions {
  answer?: string
  chunks?: readonly Record<string, unknown>[]
  fails?: boolean
  absent?: boolean
}

/** One recorded one-shot generation call. */
interface ModelCall {
  provider: string
  model: string
  system?: string
  messages: readonly { role: string; content: readonly { type: string; text: string }[] }[]
  maxTokens?: number
  reasoningEffort?: string
  stop?: readonly string[]
}

/** What the fake wake-up path should do for one mount. */
interface DeliveryOptions {
  /** Refuse `resolveAgent` with this error instead of answering a live agent. */
  resolveError?: { code: string; message: string }
  /** Report that persistence did not acknowledge the delivery. */
  flushFails?: boolean
  /** Publish the prompt through `prompt` instead of the wake-up path (an older host). */
  noWake?: boolean
}

/** One message published through the wake-up path. */
interface FollowupRecord {
  sessionId: string
  message: {
    id: string
    role: string
    content: readonly { type: string; text: string }[]
    source: Record<string, unknown>
  }
}

/**
 * Mount the plugin on a fake context and return a caller for its channel.
 *
 * The fake is deliberately thin: `apply` asks the context for the connection service (to
 * register the channel), per delivery for `sessionController` + `sessions`, and per naming
 * request for `llm` + `agentDefaultModel`. Everything else it touches is the logger.
 */
function mount(model: ModelOptions = {}, delivery: DeliveryOptions = {}): {
  call: (endpoint: string, payload: unknown) => Promise<HandlerResult>
  prompts: PromptRequest[]
  childPrompts: ChildPromptRequest[]
  followups: FollowupRecord[]
  flushed: string[]
  modelCalls: ModelCall[]
} {
  const prompts: PromptRequest[] = []
  const childPrompts: ChildPromptRequest[] = []
  const followups: FollowupRecord[] = []
  const flushed: string[] = []
  const modelCalls: ModelCall[] = []
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
        const controller: Record<string, unknown> = {
          prompt: async (request: PromptRequest) => {
            prompts.push(request)
            return { accepted: true }
          },
        }
        if (delivery.noWake !== true) {
          controller['resolveAgent'] = async (sessionId: string) => {
            if (delivery.resolveError !== undefined) return { error: delivery.resolveError }
            return {
              agent: {
                session: { id: sessionId },
                followup: (message: FollowupRecord['message']) => { followups.push({ sessionId, message }) },
              },
            }
          }
        }
        return controller
      }
      if (name === 'sessions') {
        return {
          flush: async (session: { id?: string }) => {
            flushed.push(session.id ?? '')
            return delivery.flushFails !== true
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
      if (name === 'llm' && model.absent !== true) {
        return {
          stream: (call: ModelCall) => {
            modelCalls.push(call)
            if (model.fails === true) throw new Error('provider refused')
            const chunks = model.chunks ?? [
              { type: 'text-delta', text: model.answer ?? '' },
              { type: 'finish', reason: { kind: 'stop' } },
            ]
            return (async function* () {
              for (const chunk of chunks) yield chunk
            })()
          },
        }
      }
      if (name === 'agentDefaultModel' && model.absent !== true) {
        return { currentSelection: () => ({ provider: 'fake-provider', model: 'fake-model' }) }
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
    followups,
    flushed,
    modelCalls,
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
    const { call, followups } = mount()
    const entry = await create(call, { name: 'bound' })
    const result = await call('send', { id: entry.id, currentSessionId: 'session-shown' })
    expect(result.ok).toBe(true)
    expect(followups.map(record => record.sessionId)).toEqual(['session-stored'])
    // The receipt names where it really went, so a client that navigates follows it there.
    expect((result.value as { entry: { sessionId: string } }).entry.sessionId).toBe('session-stored')
  })

  it('publishes the delivery on the live agent, tagged so the shell draws a trigger card', async () => {
    // The wake-up path is what makes the shell render a trigger card instead of a user bubble:
    // a message that wakes an idle agent is a `turn-trigger`, and its title comes from the tag.
    const { call, followups, flushed } = mount()
    const entry = await create(call, { name: '部署到测试环境' })
    await call('send', { id: entry.id })
    expect(followups).toHaveLength(1)
    const [record] = followups
    expect(record?.message.role).toBe('user')
    expect(record?.message.id.length ?? 0).toBeGreaterThan(0)
    // The record's name labels the message, and the prompt itself is delivered verbatim.
    expect(record?.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(record?.message.source).toEqual({
      kind: 'shortcut',
      shortcutId: entry.id,
      shortcutName: '部署到测试环境',
    })
    // The delivery is only accepted once persistence acknowledges it.
    expect(flushed).toEqual(['session-stored'])
  })

  it('sends an any-session record to the caller\'s shown session', async () => {
    const { call, followups } = mount()
    const entry = await create(call, { name: 'anywhere', anySession: true })
    const result = await call('send', { id: entry.id, currentSessionId: 'session-shown' })
    expect(result.ok).toBe(true)
    expect(followups.map(record => record.sessionId)).toEqual(['session-shown'])
    // Delivered to that session's own agent, not to whatever agent the record was saved at.
    expect((result.value as { entry: { sessionId: string; target: { kind: string } } }).entry)
      .toMatchObject({ sessionId: 'session-shown', target: { kind: 'main' } })
  })

  it('classifies a refusal to resolve the agent like any other delivery failure', async () => {
    const { call, followups } = mount({}, { resolveError: { code: 'session/not-found', message: 'no such session' } })
    const entry = await create(call, { name: 'bound' })
    const result = await call('send', { id: entry.id })
    expect(result.error?.code).toBe('session-not-found')
    expect(followups).toEqual([])
  })

  it('reports a delivery the host refuses to persist', async () => {
    const { call } = mount({}, { flushFails: true })
    const entry = await create(call, { name: 'bound' })
    const result = await call('send', { id: entry.id })
    expect(result.error?.code).toBe('send-failed')
  })

  it('still delivers through `prompt` on a host without the wake-up verb', async () => {
    // An older host cannot render the trigger card; it must still receive the message.
    const { call, prompts, followups } = mount({}, { noWake: true })
    const entry = await create(call, { name: 'bound' })
    const result = await call('send', { id: entry.id })
    expect(result.ok).toBe(true)
    expect(followups).toEqual([])
    expect(prompts[0]).toMatchObject({
      sessionId: 'session-stored',
      content: [{ type: 'text', text: 'hello' }],
    })
  })

  it('delivers to the CHILD when the open conversation is a subagent, not to its main agent', async () => {
    // The shell can open a subagent as its own conversation; that child is not reachable
    // through the session controller, so the delivery must take the subagent runtime.
    const { call, followups, childPrompts } = mount()
    const entry = await create(call, { name: 'anywhere', anySession: true })
    const result = await call('send', {
      id: entry.id,
      currentSessionId: 'session-child',
      currentParentSessionId: 'session-parent',
    })
    expect(result.ok).toBe(true)
    expect(followups).toEqual([])
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
    const { call, followups, childPrompts } = mount()
    const entry = await create(call, { name: 'bound' })
    const result = await call('send', {
      id: entry.id,
      currentSessionId: 'session-child',
      currentParentSessionId: 'session-parent',
    })
    expect(result.ok).toBe(true)
    expect(followups.map(record => record.sessionId)).toEqual(['session-stored'])
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

describe('host naming', () => {
  it('names from the model, then cleans and de-duplicates its answer', async () => {
    const { call } = mount({ answer: '"重启服务。"' })
    // A record already owns the clean form of the answer, so the name rule must still hold.
    await create(call, { name: '重启服务' })
    const result = await call('suggestName', { text: '重启服务：请重启 dev 服务' })
    expect(result.ok).toBe(true)
    expect(result.value).toEqual({ name: '重启服务 2', source: 'model' })
  })

  it('sends one bounded, non-thinking one-shot call on the default model', async () => {
    const { call, modelCalls } = mount({ answer: '重启 dev' })
    await call('suggestName', { text: '重启服务：请重启 dev 服务' })
    expect(modelCalls).toHaveLength(1)
    const [gen] = modelCalls
    expect(gen?.provider).toBe('fake-provider')
    expect(gen?.model).toBe('fake-model')
    // The prompt reaches the model verbatim, as a one-shot user input, under a system prompt.
    expect(gen?.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: '重启服务：请重启 dev 服务' }] }])
    expect(gen?.system?.length ?? 0).toBeGreaterThan(0)
    expect(gen?.maxTokens ?? 0).toBeLessThanOrEqual(512)
    // Thinking would spend that budget and can leave the answer with no visible text at all.
    expect(gen?.reasoningEffort).toBe('off')
    // The language is PINNED to the prompt's own, not left to the model's judgement.
    expect(gen?.system).toContain('"zh"')
  })

  it('refuses a title written in the instructions\' language instead of the prompt\'s', async () => {
    // A Chinese prompt answered in English is the exact drift the language rule guards.
    const { call } = mount({ answer: 'Restart the dev service' })
    const result = await call('suggestName', { text: '请帮我重启 dev 服务，然后确认健康检查通过' })
    expect(result.value).toMatchObject({ source: 'rule', note: 'the model answered in a different language' })
  })

  it('accepts a title that keeps the prompt\'s script even when it mixes in identifiers', async () => {
    const { call } = mount({ answer: '重启 dev 服务' })
    const result = await call('suggestName', { text: '请帮我重启 dev 服务' })
    expect(result.value).toEqual({ name: '重启 dev 服务', source: 'model' })
  })

  it('leaves a prompt without a CJK script alone', async () => {
    const { call, modelCalls } = mount({ answer: 'Trim release checklist' })
    const result = await call('suggestName', { text: 'tidy up the release checklist and drop the stale steps' })
    // No tag to pin: the instruction asks the model to mirror the prompt instead.
    expect(modelCalls[0]?.system).toContain('same language as the prompt')
    expect(result.value).toEqual({ name: 'Trim release checklist', source: 'model' })
  })

  it('never reads reasoning as the answer', async () => {
    const { call } = mount({
      chunks: [
        { type: 'reasoning-delta', text: 'The user wants a title. Let me consider 重启服务 here.' },
        { type: 'text-delta', text: '重启 dev' },
        { type: 'finish', reason: { kind: 'stop' } },
      ],
    })
    const result = await call('suggestName', { text: '重启服务：请重启 dev 服务' })
    expect(result.value).toEqual({ name: '重启 dev', source: 'model' })
  })

  it('reads a title the adapter puts in `delta.text` instead of `text`', async () => {
    const { call } = mount({
      chunks: [
        { type: 'text-delta', delta: { text: '重启 dev' } },
        { type: 'finish', reason: { kind: 'stop' } },
      ],
    })
    const result = await call('suggestName', { text: '重启服务：请重启 dev 服务' })
    expect(result.value).toEqual({ name: '重启 dev', source: 'model' })
  })

  it('falls back to the deterministic rule when the provider throws', async () => {
    const { call } = mount({ fails: true })
    const result = await call('suggestName', { text: '重启服务：请重启 dev 服务' })
    expect(result.ok).toBe(true)
    // No model answer, so the rule names it from the prompt itself.
    expect(result.value).toMatchObject({ source: 'rule' })
    expect((result.value as { name: string }).name).toContain('重启服务')
  })

  it('reads the text from a finished block when the adapter sends no deltas', async () => {
    // Some providers stream no text deltas: the whole answer arrives in `block-end`.
    const { call } = mount({
      chunks: [
        { type: 'block-start', index: 0, blockType: 'text' },
        { type: 'block-end', index: 0, block: { type: 'text', text: '重启 dev 服务' } },
        { type: 'finish', reason: { kind: 'stop' } },
      ],
    })
    const result = await call('suggestName', { text: '重启服务：请重启 dev 服务' })
    expect(result.value).toEqual({ name: '重启 dev 服务', source: 'model' })
  })

  it('reports why the model declined when the call ends with an ERROR finish', async () => {
    // The real failure shape: no exception is thrown, the stream ends with reason.kind 'error'.
    const { call } = mount({
      chunks: [
        { type: 'finish', reason: { kind: 'error', failure: { code: 'MISSING_CREDENTIAL', message: 'no API key for provider route "x"' } } },
      ],
    })
    const result = await call('suggestName', { text: '重启服务：请重启 dev 服务' })
    expect(result.value).toMatchObject({ source: 'rule', note: 'no API key for provider route "x"' })
  })

  it('reports that no model runtime is mounted at all', async () => {
    const { call } = mount({ absent: true })
    const result = await call('suggestName', { text: '重启服务' })
    expect(result.value).toMatchObject({ source: 'rule', note: 'the host has no model runtime' })
  })

  it('falls back to the rule when the host has no model runtime at all', async () => {
    // The fixture/profile shape that must still work: no `llm`, no default selection.
    const { call, modelCalls } = mount({ absent: true })
    const result = await call('suggestName', { text: '## 部署到测试环境\n第二步' })
    expect(modelCalls).toEqual([])
    // The note is how the dialog learns that the model never ran, so it stays visible.
    expect(result.value).toEqual({
      name: '部署到测试环境',
      source: 'rule',
      note: 'the host has no model runtime',
    })
  })

  it('refuses an empty prompt', async () => {
    const { call } = mount({ answer: 'x' })
    const result = await call('suggestName', { text: '   ' })
    expect(result.error?.code).toBe('invalid-input')
  })

  it('never de-duplicates against the record being edited', async () => {
    const { call } = mount({ answer: '重启服务' })
    const entry = await create(call, { name: '重启服务' })
    const result = await call('suggestName', { text: '重启服务', excludeId: entry.id })
    expect(result.value).toEqual({ name: '重启服务', source: 'model' })
  })
})
