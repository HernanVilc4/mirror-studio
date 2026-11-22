import { describe, it, expect, afterEach } from 'vitest'
import WebSocket from 'ws'
import { SignalingServer } from './signaling'
import { signSdp } from '@mirror-studio/protocol/src/node'

let srv: SignalingServer
afterEach(() => srv?.stop())

async function setup() {
  srv = new SignalingServer()
  const port = await srv.start(0, '127.0.0.1')
  const token = srv.newInvite()
  return { port, token }
}
const open = (port: number) => new Promise<WebSocket>((r) => { const w = new WebSocket(`ws://127.0.0.1:${port}`); w.once('open', () => r(w)) })
const next = (w: WebSocket) => new Promise<any>((r) => w.once('message', (d) => r(JSON.parse(d.toString()))))
const closed = (w: WebSocket) => new Promise<number>((r) => w.once('close', (c) => r(c)))
const hello = (token: string) => JSON.stringify({ t: 'hello', v: 1, token, deviceId: 'd', name: 'Pixel', model: 'P8' })

describe('SignalingServer', () => {
  it('pairs, requires approval, relays a signed offer', async () => {
    const { port, token } = await setup()
    const req = new Promise<any>((r) => srv.once('pairing-request', r))
    const offer = new Promise<[string, string]>((r) => srv.once('offer', (id, sdp) => r([id, sdp])))
    const ws = await open(port)
    ws.send(hello(token))
    expect((await next(ws)).status).toBe('pending')
    const { sessionId } = await req
    srv.approve(sessionId)
    expect((await next(ws)).status).toBe('approved')
    ws.send(JSON.stringify({ t: 'offer', sdp: 'v=0', sig: signSdp(token, 'v=0') }))
    expect(await offer).toEqual([sessionId, 'v=0'])
  })

  it('rejects reused token (single-use)', async () => {
    const { port, token } = await setup()
    const a = await open(port); a.send(hello(token)); await next(a)
    const b = await open(port); b.send(hello(token))
    expect((await next(b)).status).toBe('rejected')
  })

  it('closes on offer before approval, bad signature, and malformed frames', async () => {
    let { port, token } = await setup()
    let ws = await open(port); ws.send(hello(token)); await next(ws)
    ws.send(JSON.stringify({ t: 'offer', sdp: 'v=0', sig: signSdp(token, 'v=0') }))
    expect(await closed(ws)).toBe(4401)

    const req = new Promise<any>((r) => srv.once('pairing-request', r))
    token = srv.newInvite(); ws = await open(port); ws.send(hello(token)); await next(ws)
    srv.approve((await req).sessionId); await next(ws)
    ws.send(JSON.stringify({ t: 'offer', sdp: 'v=0', sig: signSdp('wrong', 'v=0') }))
    expect(await closed(ws)).toBe(4403)

    ws = await open(port); ws.send('not json')
    expect(await closed(ws)).toBe(4400)
  })

  it('reports closed and keeps other sessions alive', async () => {
    const { port, token } = await setup()
    const token2 = srv.newInvite()
    const reqs: any[] = []; srv.on('pairing-request', (r) => reqs.push(r))
    const a = await open(port); a.send(hello(token)); await next(a)
    const b = await open(port); b.send(hello(token2)); await next(b)
    const gone = new Promise((r) => srv.once('closed', r))
    a.close(); await gone
    srv.approve(reqs[1].sessionId)
    expect((await next(b)).status).toBe('approved')
  })

  it('allows QR-less pairing (approval still required) and can be disabled', async () => {
    await setup()
    const noToken = JSON.stringify({ t: 'hello', v: 1, deviceId: 'd', name: 'Pixel', model: 'P8' })
    const req = new Promise<any>((r) => srv.once('pairing-request', r))
    let ws = await open((srv as any).wss.address().port); ws.send(noToken)
    expect((await next(ws)).status).toBe('pending')
    const { sessionId } = await req
    ws.send(JSON.stringify({ t: 'offer', sdp: 'v=0', sig: signSdp('open', 'v=0') }))
    expect(await closed(ws)).toBe(4401) // not approved yet
    srv.openPairing = false
    ws = await open((srv as any).wss.address().port); ws.send(noToken)
    expect((await next(ws)).status).toBe('rejected')
    void sessionId
  })
})
