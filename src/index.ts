/**
 * dsh-shortcut, host half.
 *
 * Owns two things the browser half cannot: the durable record store
 * (`<DSH_HOME>/shortcut/entries.json`) and delivery.
 *
 * Delivery has exactly two paths, because DSH has exactly two addressable
 * agent families:
 *
 * - the session's own agent goes through the host Session Controller
 *   (`ctx.sessionController.prompt`), which resumes cold sessions and persists
 *   the message;
 * - a subagent or agent-team teammate is a continuable direct child of that
 *   session, and goes through the host Subagent runtime
 *   (`ctx.subagents.prompt`), the same service the app itself uses for
 *   browser-authored subagent messages. A one-shot child cannot be addressed
 *   (the runtime answers `subagent/not-resumable`), and a child needs its
 *   parent session live (`subagent/parent-unavailable`), otherwise it cold-
 *   resumes when its parent is resident.
 *
 * The browser talks to this half over the plugin's own connection channel
 * (`/shortcut`); every endpoint answers either a value or a structured
 * `{ code, message }` failure the client localizes.
 *
 * @module dsh-shortcut
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { nameFromTitle, suggestName } from './share.ts'
import { defaultShortcutDir, ShortcutStore, StoreFailure } from './store.ts'
import { SHORTCUT_CHANNEL } from './types.ts'
import type { ShortcutDraft, ShortcutEdit, ShortcutErrorCode, ShortcutTarget } from './types.ts'

/** Stable Cordis plugin name. */
export const name = 'shortcut'

/**
 * Capability seams: the wire channel (`connection` + `webServer`, the latter
 * because channel registrations belong to an owner fiber that can resolve the
 * served host). The session and subagent business services are resolved lazily
 * from the context so a profile without the subagent runtime still boots and
 * keeps main-session shortcuts working.
 */
export const inject = ['connection', 'webServer']

/** One RPC failure, in the wire vocabulary the client already speaks. */
interface ChannelFailure {
  code: string
  message: string
  details: object
}

/** What one channel handler may answer. */
type HandlerResult =
  | { ok: true; value: unknown }
  | { ok: false; error: ChannelFailure }

/** Signature of a Connection RPC channel handler. */
type ChannelHandler = (
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
  peer: unknown,
) => Promise<HandlerResult>

/**
 * The slice of the Host connection service this plugin mounts its channel with.
 *
 * `rpc.handle` is the published surface, but it hardcodes the service's own
 * context as the registration owner and that context no longer injects
 * `webServer` in the 0.2 line, so it throws at boot. `register` takes the
 * owner explicitly, which is this plugin's own context — the one that does
 * inject `webServer`. Published types mark `register` private, hence this
 * local declaration; `rpc.handle` stays as the fallback for an older host.
 */
interface ConnectionServiceSurface {
  readonly rpc: {
    handle: (
      channel: string,
      handler: ChannelHandler,
      options?: { readonly authority: 'trusted-host' | 'loopback' },
    ) => () => Promise<void>
  }
  register?: (
    owner: Context,
    channel: string,
    handler: ChannelHandler,
    options?: { readonly authority: 'trusted-host' | 'loopback' },
  ) => () => Promise<void>
}

/** One prompt submission to a session's own agent, narrowed to the fields used here. */
interface PromptRequestLike {
  readonly requestId: string
  readonly sessionId: string
  readonly mode: 'queue'
  readonly content: readonly { readonly type: 'text'; readonly text: string }[]
}

/** The one verb this plugin uses from the host session business API. */
interface SessionControllerSurface {
  prompt(request: PromptRequestLike, signal: AbortSignal): Promise<{ accepted: true }>
}

/** One browser-authored message to a continuable direct child, as the subagent runtime takes it. */
interface SubagentPromptRequestLike {
  readonly requestId: string
  readonly parentSessionId: string
  readonly childSessionId: string
  readonly mode: 'continuable'
  readonly delivery: 'queue'
  readonly content: readonly { readonly type: 'text'; readonly text: string }[]
}

/** The one verb this plugin uses from the host subagent runtime. */
interface SubagentRuntimeSurface {
  prompt(request: SubagentPromptRequestLike, signal: AbortSignal): Promise<{ messageId: string }>
}

/** One chunk of a streamed model answer, narrowed to what naming reads. */
interface StreamChunkLike {
  readonly type: string
  readonly text?: string
  /** Present on `block-end`: the finished block, which may carry text when no deltas came. */
  readonly block?: unknown
  /** Present on `finish`: how the call ended, errors included. */
  readonly reason?: unknown
  /** Alternate text carriers some adapters use instead of `text`. */
  readonly delta?: unknown
  readonly content?: unknown
}

/** A one-shot model call, as the host runtime takes it. */
interface GenerateOptionsLike {
  readonly provider: string
  readonly model: string
  readonly messages: readonly {
    readonly role: 'user'
    readonly content: readonly { readonly type: 'text'; readonly text: string }[]
  }[]
  readonly system?: string
  readonly temperature?: number
  readonly maxTokens?: number
  readonly stop?: readonly string[]
  /**
   * The adapter-owned reasoning effort. Naming asks for `'off'`: this host runs `high`, and a
   * thinking model spends a small token budget on deliberation and can answer with NO visible
   * text at all (the same reason the host's own session-title call turns it off).
   */
  readonly reasoningEffort?: string
  readonly signal?: AbortSignal
}

/** The one verb this plugin uses from the host model runtime. */
interface LlmRuntimeSurface {
  stream(options: GenerateOptionsLike): AsyncIterable<StreamChunkLike>
}

/** The host's default model selection, read as plain strings. */
interface DefaultModelSurface {
  currentSelection(): { provider: string; model: string }
}

/**
 * How long the naming call may take before the deterministic rule answers instead. A name is
 * a detail of filling in a dialog: the reader must not wait on a slow model for it.
 */
const NAME_CALL_TIMEOUT_MS = 12_000

/**
 * How many tokens the answer may take. Small, but not tight: a model that emits a stray line
 * before the title still has room to produce the title, and the cap keeps this call cheap.
 */
const NAME_MAX_TOKENS = 256

/**
 * The instruction a model gets when naming a prompt. Short on purpose: the answer is a label,
 * so one line, its own language, and no chrome (quotes, labels, trailing punctuation) — the
 * host cleans whatever comes back anyway.
 */
const NAME_SYSTEM_PROMPT = [
  'You name saved prompts for a shortcut menu.',
  'Reply with the title only: one line, no quotes, no explanation, no trailing punctuation.',
  'Keep the language of the prompt.',
  'Use at most 12 characters for Chinese/Japanese/Korean, and at most 6 words otherwise.',
].join(' ')

/**
 * Why a model naming attempt did not produce a name. `note` is shown to the reader as the
 * reason the button fell back, so "the model never ran" is never a silent mystery.
 */
interface NameAttempt {
  readonly answer: string
  readonly note?: string
}

/** The text a streamed block carries, when the adapter sends whole blocks instead of deltas. */
function blockTextOf(chunk: StreamChunkLike): string | undefined {
  const block = chunk.block
  if (typeof block !== 'object' || block === null) return undefined
  const record = block as { type?: unknown; text?: unknown }
  return record.type === 'text' && typeof record.text === 'string' ? record.text : undefined
}

/**
 * The VISIBLE text one chunk carries, whatever field this host's adapter put it in.
 *
 * Only visible text: `reasoning-delta` carries the same `text` field as `text-delta`, so a
 * reader that ignores the type concatenates the model's own thinking into the answer — with
 * effort `high` that deliberation is most of what the model produces, and it would be cleaned
 * into a "name" that is really a sentence of reasoning. The tolerated shapes (`delta.text`,
 * `content.text`, a bare string) cost nothing and save a silent empty answer on a host that
 * spells the chunk differently; this is the single place that reads them.
 * @param chunk - one stream chunk.
 * @returns its visible text, or '' when it carries none.
 */
function visibleTextOf(chunk: StreamChunkLike): string {
  if (chunk.type === 'reasoning-delta') return ''
  if (typeof chunk.text === 'string') return chunk.text
  const delta = chunk.delta as { text?: unknown } | undefined
  if (typeof delta === 'object' && delta !== null && typeof delta.text === 'string') return delta.text
  const content = chunk.content as { text?: unknown } | undefined
  if (typeof content === 'object' && content !== null && typeof content.text === 'string') return content.text
  return chunk.type === 'block-end' ? blockTextOf(chunk) ?? '' : ''
}

/** The failure message a `finish` chunk reports, when it reports one. */
function finishFailureOf(chunk: StreamChunkLike): string | undefined {
  const reason = chunk.reason
  if (typeof reason !== 'object' || reason === null) return undefined
  const record = reason as { kind?: unknown; failure?: unknown }
  if (record.kind !== 'error') return undefined
  const failure = record.failure
  if (typeof failure === 'object' && failure !== null) {
    const message = (failure as { message?: unknown }).message
    if (typeof message === 'string' && message.length > 0) return message
  }
  return 'the model call reported an error'
}

/**
 * Ask the host's default model for a name.
 *
 * Deliberately optional: a profile without a model runtime, without a configured model, or
 * with a failing provider must still get a name, so this answers the reason instead of
 * failing — the caller falls back to the deterministic rule and tells the reader why.
 * @param ctx - host context.
 * @param text - the prompt to name.
 * @param signal - caller cancellation.
 * @returns the model's answer and, when there is none, the note that explains it.
 */
async function modelNameOf(ctx: Context, text: string, signal: AbortSignal): Promise<NameAttempt> {
  const llm = ctx.get('llm') as LlmRuntimeSurface | undefined
  if (llm === undefined || typeof llm.stream !== 'function') {
    return { answer: '', note: 'the host has no model runtime' }
  }
  const selection = (ctx.get('agentDefaultModel') as DefaultModelSurface | undefined)?.currentSelection?.()
  if (selection === undefined || selection.provider.length === 0 || selection.model.length === 0) {
    return { answer: '', note: 'the host has no default model selected' }
  }
  // Bound the call: a slow or hung provider must not hold the dialog's button forever. The
  // deadline RACES the stream rather than only aborting it, because one adapter ignoring the
  // signal would otherwise keep the button spinning until the model itself gave up.
  const controller = new AbortController()
  let timedOut = false
  const stopExternal = (): void => { controller.abort() }
  if (signal.aborted) return { answer: '', note: 'cancelled' }
  signal.addEventListener('abort', stopExternal, { once: true })
  const deadline = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, NAME_CALL_TIMEOUT_MS)
  try {
    const consume = (async (): Promise<NameAttempt> => {
      let answer = ''
      for await (const chunk of llm.stream({
        provider: selection.provider,
        model: selection.model,
        system: NAME_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: [{ type: 'text', text }] }],
        temperature: 0.2,
        maxTokens: NAME_MAX_TOKENS,
        // A title is one line: reasoning would spend the budget and can leave no visible text.
        reasoningEffort: 'off',
        signal: controller.signal,
      })) {
        answer += visibleTextOf(chunk)
        // A failed call is a `finish` EVENT, not a thrown error: without this the caller would
        // read it as an empty answer and the reader would never learn the model was refused.
        const failure = chunk.type === 'finish' ? finishFailureOf(chunk) : undefined
        if (failure !== undefined) {
          ctx.logger.warn(`dsh-shortcut: naming with the model failed: ${failure}`)
          return { answer: '', note: failure }
        }
      }
      return answer.trim().length === 0
        ? { answer: '', note: 'the model returned no text' }
        : { answer }
    })()
    const stopped = new Promise<NameAttempt>((resolve) => {
      controller.signal.addEventListener('abort', () => {
        resolve({ answer: '', note: timedOut ? `no answer within ${String(NAME_CALL_TIMEOUT_MS / 1000)}s` : 'cancelled' })
      }, { once: true })
    })
    const attempt = await Promise.race([consume, stopped])
    if (attempt.answer.length > 0) {
      ctx.logger.info(`dsh-shortcut: named a prompt with ${selection.provider}/${selection.model} (${attempt.answer.trim().length} chars)`)
    }
    return attempt
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    ctx.logger.warn(`dsh-shortcut: naming with the model failed: ${message}`)
    return { answer: '', note: message }
  } finally {
    clearTimeout(deadline)
    signal.removeEventListener('abort', stopExternal)
  }
}

/** Build one failure result. */
function fail(code: ShortcutErrorCode, message: string): HandlerResult {
  return { ok: false, error: { code, message, details: {} } }
}

/** Wrap one successful value. */
function value(payload: unknown): HandlerResult {
  return { ok: true, value: payload }
}

/** Read an object payload, refusing arrays and non-objects. */
function objectOf(payload: unknown): Record<string, unknown> | undefined {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined
  return payload as Record<string, unknown>
}

/** Read a raw draft out of a create request (field types are the store's business). */
function draftOf(payload: unknown): ShortcutDraft | undefined {
  const draft = objectOf(objectOf(payload)?.draft)
  if (draft === undefined) return undefined
  return {
    name: draft.name as string,
    sessionId: draft.sessionId as string,
    target: draft.target as ShortcutTarget,
    text: draft.text as string,
    ...(typeof draft.navigate === 'boolean' ? { navigate: draft.navigate } : {}),
    ...(typeof draft.anySession === 'boolean' ? { anySession: draft.anySession } : {}),
  }
}

/** Read a raw edit out of an update request. */
function editOf(payload: unknown): ShortcutEdit | undefined {
  const edit = objectOf(objectOf(payload)?.edit)
  if (edit === undefined || typeof edit.id !== 'string') return undefined
  const draft = objectOf(edit.draft)
  if (draft === undefined) return undefined
  return {
    id: edit.id,
    draft: {
      name: draft.name as string,
      sessionId: draft.sessionId as string,
      target: draft.target as ShortcutTarget,
      text: draft.text as string,
      ...(typeof draft.navigate === 'boolean' ? { navigate: draft.navigate } : {}),
      ...(typeof draft.anySession === 'boolean' ? { anySession: draft.anySession } : {}),
    },
  }
}

/** Read a non-empty string id out of a request. */
function idOf(payload: unknown): string | undefined {
  const id = objectOf(payload)?.id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

/** Read the prompt (and optional record id) out of a naming request. */
function namingOf(payload: unknown): { text: string; excludeId?: string } | undefined {
  const body = objectOf(payload)
  const text = body?.text
  if (typeof text !== 'string' || text.trim().length === 0) return undefined
  const excludeId = body?.excludeId
  return typeof excludeId === 'string' && excludeId.length > 0 ? { text, excludeId } : { text }
}

/**
 * The conversation the caller has open, as the host needs it to deliver an any-session
 * record. `parentSessionId` is present only when that conversation is an addressable child
 * (a subagent or team member opened as its own conversation), because a child is reachable
 * through the subagent runtime and never through the session controller.
 */
interface ShownConversation {
  sessionId: string
  parentSessionId?: string
}

/**
 * Read the caller's open conversation out of a send request.
 * @param payload - the channel payload.
 * @returns the shown conversation, or undefined when the caller named none.
 */
function shownConversationOf(payload: unknown): ShownConversation | undefined {
  const body = objectOf(payload)
  const sessionId = body?.currentSessionId
  if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined
  const parent = body?.currentParentSessionId
  if (typeof parent === 'string' && parent.length > 0 && parent !== sessionId) {
    return { sessionId, parentSessionId: parent }
  }
  return { sessionId }
}

/**
 * Classify a failed delivery so the browser can say something useful.
 *
 * The session API's subagent-routing refusal is deliberately recognized here:
 * a legacy record (or a session id that was really a subagent) reaches it as
 * `session/agent-busy`, which would otherwise read as "the session is busy".
 * @param error - whatever the session or subagent API threw.
 * @returns the closed failure code plus the host detail.
 */
function sendFailure(error: unknown): { code: ShortcutErrorCode; message: string } {
  const carrier = error as { name?: unknown; code?: unknown; message?: unknown; details?: unknown } | null | undefined
  const errorName = typeof carrier?.name === 'string' ? carrier.name : ''
  const code = typeof carrier?.code === 'string' ? carrier.code : ''
  const message = typeof carrier?.message === 'string' ? carrier.message : String(error)
  const details = objectOf(carrier?.details)
  const reason = typeof details?.reason === 'string' ? details.reason : ''
  if (errorName === 'ApiSessionNotFound' || code === 'session/not-found') return { code: 'session-not-found', message }
  if (code.startsWith('subagent/')) {
    if (code === 'subagent/not-resumable') return { code: 'target-not-resumable', message }
    if (code === 'subagent/parent-unavailable') return { code: 'parent-unavailable', message }
    return { code: 'target-unavailable', message }
  }
  if (code === 'session/agent-busy') {
    const ownedBySubagent = /subagent/i.test(reason) || /subagent/i.test(message)
    return ownedBySubagent ? { code: 'target-unavailable', message } : { code: 'session-busy', message }
  }
  if (code === 'session/writer-held') return { code: 'session-busy', message }
  if (/archiv/i.test(message) || /archiv/i.test(errorName) || code.includes('archiv')) {
    return { code: 'session-archived', message }
  }
  return { code: 'send-failed', message }
}

/**
 * Mount the shortcut store and its RPC channel.
 * @param ctx - host context carrying the connection, session and subagent services.
 */
export function apply(ctx: Context): void {
  const store = new ShortcutStore(defaultShortcutDir())

  /**
   * Name one prompt: the default model first, the deterministic rule when it cannot answer.
   *
   * Both halves run the same uniqueness and length rules, so the answer is always a name the
   * dialog could save as-is — the model only decides WHAT it is called, never whether it is valid.
   * @param text - the prompt to name.
   * @param excludeId - the record being edited, so it never de-duplicates against itself.
   * @param signal - caller cancellation.
   * @returns the name plus which rule produced it.
   */
  const suggestNameFor = async (
    text: string,
    excludeId: string | undefined,
    signal: AbortSignal,
  ): Promise<{ name: string; source: 'model' | 'rule'; note?: string }> => {
    const entries = await store.list()
    const attempt = await modelNameOf(ctx, text, signal)
    const fromModel = nameFromTitle(attempt.answer, entries, excludeId)
    if (fromModel.length > 0) return { name: fromModel, source: 'model' }
    const fallback = { name: suggestName(text, entries, excludeId), source: 'rule' as const }
    return attempt.note === undefined ? fallback : { ...fallback, note: attempt.note }
  }

  /**
   * Deliver one record's text to its addressed agent.
   *
   * A record with `anySession` set is addressed by the CALLER, not by the store: it goes to
   * the conversation the caller has open — that conversation itself, so a subagent or team
   * member opened as its own conversation receives it too, not that session's main agent —
   * and a caller that named none is refused. The record deliberately does not fall back to
   * the session it was captured from, because that fallback is what the switch turns off.
   * @param id - record identity.
   * @param signal - caller cancellation for the admission round-trip.
   * @param current - the conversation the caller has open, when it named one.
   * @returns the accepted marker, or a classified failure.
   */
  const deliver = async (
    id: string,
    signal: AbortSignal,
    current: ShownConversation | undefined,
  ): Promise<HandlerResult> => {
    const entry = await store.get(id)
    if (entry === undefined) return fail('not-found', `no shortcut with id ${id}`)
    if (entry.anySession && current === undefined) {
      return fail('no-current-session', `"${entry.name}" is sendable to any session, but the caller showed none`)
    }
    /**
     * Where this delivery really goes. For an any-session record the caller's conversation
     * decides the shape too: a child (subagent/teammate) has to go through the subagent
     * runtime with its parent, everything else through the session controller.
     */
    const address: { sessionId: string; target: ShortcutTarget } = entry.anySession && current !== undefined
      ? current.parentSessionId === undefined
        ? { sessionId: current.sessionId, target: { kind: 'main' } }
        : { sessionId: current.parentSessionId, target: { kind: 'subagent', childSessionId: current.sessionId } }
      : { sessionId: entry.sessionId, target: entry.target }
    const { sessionId, target } = address
    const text = entry.text
    try {
      if (target.kind === 'main') {
        const controller = ctx.get('sessionController') as SessionControllerSurface | undefined
        if (controller === undefined || typeof controller.prompt !== 'function') {
          return fail('send-failed', 'the host session service is unavailable')
        }
        await controller.prompt({
          requestId: randomUUID(),
          sessionId,
          mode: 'queue',
          content: [{ type: 'text', text }],
        }, signal)
      } else {
        const childSessionId = target.childSessionId
        if (childSessionId === undefined || childSessionId.length === 0) {
          return fail('invalid-input', 'the target has no child session id')
        }
        const subagents = ctx.get('subagents') as SubagentRuntimeSurface | undefined
        if (subagents === undefined || typeof subagents.prompt !== 'function') {
          return fail('send-failed', 'the host subagent service is unavailable')
        }
        await subagents.prompt({
          requestId: randomUUID(),
          parentSessionId: sessionId,
          childSessionId,
          mode: 'continuable',
          delivery: 'queue',
          content: [{ type: 'text', text }],
        }, signal)
      }
    } catch (error: unknown) {
      const failure = sendFailure(error)
      ctx.logger.warn(`dsh-shortcut: delivering "${entry.name}" (${target.kind}) failed (${failure.code}): ${failure.message}`)
      return fail(failure.code, failure.message)
    }
    return value({
      accepted: true,
      entry: {
        id: entry.id,
        name: entry.name,
        // The receipt names the session that ACTUALLY received it, so a client that
        // navigates afterwards follows the any-session record to where it landed.
        sessionId,
        target: { ...target },
        navigate: entry.navigate,
        anySession: entry.anySession,
      },
    })
  }

  /** Dispatch one channel request. */
  const handle: ChannelHandler = async (endpoint, payload, signal) => {
    try {
      switch (endpoint) {
        case 'list':
          return value({ entries: await store.list() })
        case 'create': {
          const draft = draftOf(payload)
          if (draft === undefined) return fail('invalid-input', 'create needs a { name, sessionId, target, text } draft')
          return value({ entry: await store.create(draft) })
        }
        case 'update': {
          const edit = editOf(payload)
          if (edit === undefined) return fail('invalid-input', 'update needs a { id, draft } edit')
          return value({ entry: await store.update(edit) })
        }
        case 'remove': {
          const id = idOf(payload)
          if (id === undefined) return fail('invalid-input', 'remove needs an id')
          await store.remove(id)
          return value({ removed: true })
        }
        case 'send': {
          const id = idOf(payload)
          if (id === undefined) return fail('invalid-input', 'send needs an id')
          return await deliver(id, signal, shownConversationOf(payload))
        }
        case 'suggestName': {
          const naming = namingOf(payload)
          if (naming === undefined) return fail('invalid-input', 'suggestName needs a non-empty text')
          return value(await suggestNameFor(naming.text, naming.excludeId, signal))
        }
        default:
          return fail('invalid-input', `unknown endpoint ${JSON.stringify(endpoint)}`)
      }
    } catch (error: unknown) {
      if (error instanceof StoreFailure) return fail(error.code, error.message)
      const message = error instanceof Error ? error.message : String(error)
      ctx.logger.error(`dsh-shortcut: ${endpoint} failed: ${message}`)
      return fail(endpoint === 'send' ? 'send-failed' : 'store-unavailable', message)
    }
  }

  // Mount the channel. `register` is preferred so the registration owner is
  // this plugin's context (the one that injects `webServer`); `rpc.handle` is
  // the fallback for a build that does not expose `register`.
  ctx.effect(() => {
    const service = ctx.get('connection') as ConnectionServiceSurface | undefined
    if (service === undefined) throw new Error('dsh-shortcut: no connection service')
    return typeof service.register === 'function'
      ? service.register(ctx, SHORTCUT_CHANNEL, handle, { authority: 'trusted-host' })
      : service.rpc.handle(SHORTCUT_CHANNEL, handle, { authority: 'trusted-host' })
  }, 'dsh-shortcut: RPC channel')

  ctx.logger.info(`dsh-shortcut: shortcuts live in ${store.path}`)
}
