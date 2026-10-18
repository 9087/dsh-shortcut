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
    },
  }
}

/** Read a non-empty string id out of a request. */
function idOf(payload: unknown): string | undefined {
  const id = objectOf(payload)?.id
  return typeof id === 'string' && id.length > 0 ? id : undefined
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
   * Deliver one record's text to its addressed agent.
   * @param id - record identity.
   * @param signal - caller cancellation for the admission round-trip.
   * @returns the accepted marker, or a classified failure.
   */
  const deliver = async (id: string, signal: AbortSignal): Promise<HandlerResult> => {
    const entry = await store.get(id)
    if (entry === undefined) return fail('not-found', `no shortcut with id ${id}`)
    const text = entry.text
    try {
      if (entry.target.kind === 'main') {
        const controller = ctx.get('sessionController') as SessionControllerSurface | undefined
        if (controller === undefined || typeof controller.prompt !== 'function') {
          return fail('send-failed', 'the host session service is unavailable')
        }
        await controller.prompt({
          requestId: randomUUID(),
          sessionId: entry.sessionId,
          mode: 'queue',
          content: [{ type: 'text', text }],
        }, signal)
      } else {
        const childSessionId = entry.target.childSessionId
        if (childSessionId === undefined || childSessionId.length === 0) {
          return fail('invalid-input', 'the target has no child session id')
        }
        const subagents = ctx.get('subagents') as SubagentRuntimeSurface | undefined
        if (subagents === undefined || typeof subagents.prompt !== 'function') {
          return fail('send-failed', 'the host subagent service is unavailable')
        }
        await subagents.prompt({
          requestId: randomUUID(),
          parentSessionId: entry.sessionId,
          childSessionId,
          mode: 'continuable',
          delivery: 'queue',
          content: [{ type: 'text', text }],
        }, signal)
      }
    } catch (error: unknown) {
      const failure = sendFailure(error)
      ctx.logger.warn(`dsh-shortcut: delivering "${entry.name}" (${entry.target.kind}) failed (${failure.code}): ${failure.message}`)
      return fail(failure.code, failure.message)
    }
    return value({
      accepted: true,
      entry: {
        id: entry.id,
        name: entry.name,
        sessionId: entry.sessionId,
        target: { ...entry.target },
        navigate: entry.navigate,
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
          return await deliver(id, signal)
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
