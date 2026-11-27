import { describe, it, expect, afterEach } from 'vitest'
import WebSocket from 'ws'
import { MeetingHost, type Conn } from './meeting'
import { MeetingServer, MeetingClient, sendMediaOver, MEDIA_BACKLOG } from './meeting-net'
import { generateCode, type SecureChannel } from '@mirror-studio/protocol/src/node'
import type { ServerMessage } from '@mirror-studio/protocol'

const IT = 1000
const cleanups: (() => void)[] = []
afterEach(() => { cleanups.splice(0).forEach((f) => f()) })

class Local implements Conn {
  send(_m: ServerMessage) {}
  close() {}
}
async function setup() {
  const code = generateCode()
  const meeting = new MeetingHost('Clase')
  meeting.join('Ana', new Local())
  const srv = new MeetingServer(meeting, code, 'PC-LAB-1', IT)
  const port = await srv.start(0, '127.0.0.1')
  cleanups.push(() => srv.stop())
  const c = new MeetingClient()
  const msgs: ServerMessage[] = []
  c.on('message', (m) => msgs.push(m))
  await c.connect('127.0.0.1', port, code, 'Beto', IT)
  cleanups.push(() => c.close())
  const until = async (pred: () => boolean) => { for (let i = 0; i < 200 && !pred(); i++) await new Promise((r) => setTimeout(r, 10)); return pred() }
  await until(() => msgs.some((m) => m.t === 'welcome'))
  const id = (msgs.find((m) => m.t === 'welcome') as Extract<ServerMessage, { t: 'welcome' }>).you
  return { meeting, c, msgs, until, id }
}
const frame = (size: number, key: boolean, fill = 7) => { const f = new Uint8Array(size).fill(fill); f[1] = key ? 1 : 0; return f }

describe('TCP video relay over the encrypted meeting socket', () => {
  it('carries a large key frame both ways, split into pieces and put back together', async () => {
    const { meeting, c, msgs, until, id } = await setup()
    const fromHost: { stream: number; frame: Uint8Array }[] = []
    c.on('media', (stream: number, f: Uint8Array) => fromHost.push({ stream, frame: f }))
    const toHost: { from: string; stream: number; frame: Uint8Array }[] = []
    meeting.on('media', (from: string, stream: number, f: Uint8Array) => toHost.push({ from, stream, frame: f }))

    const big = frame(300_000, true) // a 1440p key frame is in this range: 7 pieces of 48 KB
    expect(meeting.sendMedia(id, 1, big)).toBe(true)
    expect(await until(() => fromHost.length === 1)).toBe(true)
    expect(fromHost[0].stream).toBe(1)
    expect(Buffer.from(fromHost[0].frame).equals(Buffer.from(big))).toBe(true)

    expect(c.sendMedia(3, frame(1000, true, 9))).toBe(true)
    expect(await until(() => toHost.length === 1)).toBe(true)
    expect(toHost[0]).toMatchObject({ from: id, stream: 3 })
    expect(toHost[0].frame.length).toBe(1000)

    // Control messages keep working on the same socket while video flows.
    c.send({ t: 'present-start' })
    expect(await until(() => msgs.some((m) => m.t === 'state' && m.state.presenter === id))).toBe(true)
  })

  it('a participant may only send its own screen', async () => {
    const { meeting, c, until } = await setup()
    const toHost: number[] = []
    meeting.on('media', (_f: string, stream: number) => toHost.push(stream))
    c.sendMedia(1, frame(100, true)); c.sendMedia(2, frame(100, true)); c.sendMedia(3, frame(100, true))
    expect(await until(() => toHost.length >= 1)).toBe(true)
    await new Promise((r) => setTimeout(r, 50))
    expect(toHost).toEqual([3])
  })

  it('media-mode travels both ways', async () => {
    const { meeting, c, msgs, until, id } = await setup()
    const modes: string[] = []
    meeting.on('media-mode', (from: string) => modes.push(from))
    c.send({ t: 'media-mode', relay: true, reason: 'no-connect' })
    meeting.sendMediaMode(id, 'failed')
    expect(await until(() => modes.length === 1 && msgs.some((m) => m.t === 'media-mode'))).toBe(true)
    expect(modes[0]).toBe(id)
  })
})

describe('relay back-pressure: late frames are dropped, not queued', () => {
  it('drops while the socket is backed up, then skips deltas until the next key frame', () => {
    const sent: Uint8Array[] = []
    const ws = { readyState: WebSocket.OPEN, bufferedAmount: 0, send: (b: Uint8Array) => sent.push(b) }
    const sock = ws as unknown as WebSocket
    const ch = { sealBytes: (b: Uint8Array) => Buffer.from(b) } as unknown as SecureChannel
    const f = (key: boolean) => frame(32, key)
    const wait = new Set<number>()
    expect(sendMediaOver(sock, ch, 1, 0, f(true), wait)).toBe(true)
    expect(sendMediaOver(sock, ch, 1, 1, f(false), wait)).toBe(true)
    ws.bufferedAmount = MEDIA_BACKLOG + 1
    expect(sendMediaOver(sock, ch, 1, 2, f(false), wait)).toBe(false)
    ws.bufferedAmount = 0
    expect(sendMediaOver(sock, ch, 1, 3, f(false), wait)).toBe(false) // its reference frame was dropped
    expect(sendMediaOver(sock, ch, 2, 3, f(false), wait)).toBe(true) // other streams are not affected
    expect(sendMediaOver(sock, ch, 1, 4, f(true), wait)).toBe(true) // the key frame repairs it
    expect(sendMediaOver(sock, ch, 1, 5, f(false), wait)).toBe(true)
    expect(sent.length).toBe(5)
  })
})
