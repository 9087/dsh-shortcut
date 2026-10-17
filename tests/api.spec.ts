/** The browser port: wire-shape parsing, coded failures, transport folding. */
import { describe, expect, it } from 'vitest'
import { ShortcutApi, ShortcutFailure } from '../src/client/api.ts'
import type { ClientRpc, RpcOutcome } from '../src/client/api.ts'
import { SHORTCUT_CHANNEL } from '../src/types.ts'

/** A port over a scripted caller; records what was sent. */
function fakeRpc(reply: (endpoint: string, payload: unknown) => RpcOutcome): { rpc: ClientRpc; calls: Array<{ channel: string; endpoint: string; payload: unknown }> } {
  const calls: Array<{ channel: string; endpoint: string; payload: unknown }> = []
  return {
    calls,
    rpc: {
      async call(channel, endpoint, payload) {
        calls.push({ channel, endpoint, payload })
        return reply(endpoint, payload)
      },
    },
  }
}

const ENTRY = {
  id: 'id-1',
  name: '重启服务',
  sessionId: 'session-a',
  text: '重启',
  createdAt: 10,
  updatedAt: 20,
}

describe('ShortcutApi', () => {
  it('calls the plugin channel with the endpoint and reads the list', async () => {
    const { rpc, calls } = fakeRpc(() => ({ ok: true, value: { entries: [ENTRY] } }))
    const api = new ShortcutApi(rpc)
    await expect(api.list()).resolves.toEqual([ENTRY])
    expect(calls).toEqual([{ channel: SHORTCUT_CHANNEL, endpoint: 'list', payload: {} }])
  })

  it('sends create/update/remove/send payloads', async () => {
    const { rpc, calls } = fakeRpc(endpoint => ({ ok: true, value: endpoint === 'list' || endpoint === 'remove' ? undefined : { entry: ENTRY } }))
    const api = new ShortcutApi(rpc)
    await expect(api.create({ name: 'n', sessionId: 's', text: 't' })).resolves.toEqual(ENTRY)
    await expect(api.update({ id: 'id-1', draft: { name: 'n', sessionId: 's', text: 't' } })).resolves.toEqual(ENTRY)
    await expect(api.remove('id-1')).resolves.toBeUndefined()
    await expect(api.send('id-1')).resolves.toEqual({ name: ENTRY.name, sessionId: ENTRY.sessionId })
    expect(calls.map(call => call.endpoint)).toEqual(['create', 'update', 'remove', 'send'])
    expect(calls[0]?.payload).toEqual({ draft: { name: 'n', sessionId: 's', text: 't' } })
    expect(calls[1]?.payload).toEqual({ edit: { id: 'id-1', draft: { name: 'n', sessionId: 's', text: 't' } } })
    expect(calls[2]?.payload).toEqual({ id: 'id-1' })
    expect(calls[3]?.payload).toEqual({ id: 'id-1' })
  })

  it('keeps the host\'s business failure code', async () => {
    const { rpc } = fakeRpc(() => ({ ok: false, error: { code: 'name-taken', message: 'taken', details: {} } }))
    const api = new ShortcutApi(rpc)
    const failure = await api.create({ name: 'n', sessionId: 's', text: 't' }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(ShortcutFailure)
    expect(failure).toMatchObject({ code: 'name-taken' })
  })

  it('folds a transport rejection into a coded failure', async () => {
    const rpc: ClientRpc = { call: async () => { throw new Error('socket closed') } }
    const api = new ShortcutApi(rpc)
    await expect(api.list()).rejects.toMatchObject({ code: 'store-unavailable' })
    await expect(api.send('id-1')).rejects.toMatchObject({ code: 'send-failed' })
  })

  it('refuses malformed records from the host', async () => {
    const { rpc } = fakeRpc(() => ({ ok: true, value: { entries: [{ id: 'x' }] } }))
    await expect(new ShortcutApi(rpc).list()).rejects.toMatchObject({ code: 'store-unavailable' })
  })

  it('treats a missing entries list as unreadable', async () => {
    const { rpc } = fakeRpc(() => ({ ok: true, value: {} }))
    await expect(new ShortcutApi(rpc).list()).rejects.toMatchObject({ code: 'store-unavailable' })
  })

  it('refuses a send receipt without the entry identity', async () => {
    const { rpc } = fakeRpc(() => ({ ok: true, value: { accepted: true } }))
    await expect(new ShortcutApi(rpc).send('id-1')).rejects.toMatchObject({ code: 'send-failed' })
  })
})
