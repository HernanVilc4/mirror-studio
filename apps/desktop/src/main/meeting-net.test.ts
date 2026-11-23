import { describe, it, expect, afterEach } from 'vitest'
import WebSocket from 'ws'
import { MeetingHost, type Conn } from './meeting'
import { MeetingServer, MeetingClient, probeInfo, MAX_FAILURES } from './meeting-net'
import { generateCode } from '@mirror-studio/protocol/src/node'
import type { ServerMessage } from '@mirror-studio/protocol'

const IT = 1000
const cleanups: (() => void)[] = []
afterEach(() => { cleanups.splice(0).forEach((f) => f()) })

class Local implements Conn {
  got: ServerMessage[] = []
  send(m: ServerMessage) { this.got.push(m) }
  close() {}
}

async function host() {
  const code = generateCode()
  const meeting = new MeetingHost('Clase de Redes')
  const local = new Local()
  const hostId = meeting.join('Ana', local)!
  const srv = new MeetingServer(meeting, code, 'PC-LAB-1', IT)
  const port = await srv.start(0, '127.0.0.1')
  cleanups.push(() => srv.stop())
  return { code, meeting, local, hostId, srv, port }
}
async function join(port: number, code: string, name: string) {
  const c = new MeetingClient()
  const msgs: ServerMessage[] = []
  c.on('message', (m) => msgs.push(m))
  await c.connect('127.0.0.1', port, code, name, IT)
  cleanups.push(() => c.close())
  const until = async (pred: () => boolean) => { for (let i = 0; i < 100 && !pred(); i++) await new Promise((r) => setTimeout(r, 10)); return pred() }
  return { c, msgs, until, of: <T extends ServerMessage['t']>(t: T) => msgs.filter((m) => m.t === t) as Extract<ServerMessage, { t: T }>[] }
}

describe('joining over the network', () => {
  it('joins with the right code and gets the roster', async () => {
    const h = await host()
    const bob = await join(h.port, h.code, 'Bob')
    expect(await bob.until(() => bob.of('welcome').length === 1)).toBe(true)
    const names = bob.of('welcome')[0].state.participants.map((p) => p.name).sort()
    expect(names).toEqual(['Ana', 'Bob'])
    expect(h.meeting.size).toBe(2)
  })

  it('rejects a wrong code with a clear message', async () => {
    const h = await host()
    await expect(join(h.port, 'AAAAAAAA', 'Eve')).rejects.toThrow('Código incorrecto')
    expect(h.meeting.size).toBe(1)
  })

  it('accepts the code however it is typed (lowercase, dash, spaces)', async () => {
    const h = await host()
    const typed = ` ${h.code.slice(0, 4).toLowerCase()}-${h.code.slice(4).toLowerCase()} `
    await join(h.port, typed, 'Bob')
  })

  it('blocks an address after repeated wrong codes, even with the right one', async () => {
    const h = await host()
    for (let i = 0; i < MAX_FAILURES; i++) await expect(join(h.port, 'AAAAAAAA', 'Eve')).rejects.toThrow('Código incorrecto')
    await expect(join(h.port, h.code, 'Bob')).rejects.toThrow('Demasiados intentos')
  })

  it('a client refuses a host that does not know the code (impostor)', async () => {
    const fake = await host() // the "impostor" runs its own meeting with its own code
    await expect(join(fake.port, generateCode(), 'Bob')).rejects.toThrow()
  })

  it('reports the meeting name and head count without a code', async () => {
    const h = await host()
    expect(await probeInfo('127.0.0.1', h.port)).toEqual({ t: 'info-reply', v: 2, name: 'Clase de Redes', host: 'PC-LAB-1', participants: 1 })
  })

  it('refuses when the meeting is full', async () => {
    const h = await host()
    const { MAX_PARTICIPANTS } = await import('@mirror-studio/protocol')
    for (let i = 1; i < MAX_PARTICIPANTS; i++) h.meeting.join(`p${i}`, new Local())
    const late = new MeetingClient(); const msgs: ServerMessage[] = []
    late.on('message', (m) => msgs.push(m))
    await late.connect('127.0.0.1', h.port, h.code, 'Late', IT)
    await new Promise((r) => setTimeout(r, 100))
    expect(msgs.find((m) => m.t === 'closed')).toMatchObject({ reason: expect.stringContaining('llena') })
  })
})

describe('what a network observer sees', () => {
  it('the code never appears in the bytes on the wire, and frames are not readable', async () => {
    const h = await host()
    const frames: string[] = []
    // Wrap the real socket class to record every frame in both directions.
    const orig = WebSocket.prototype.send
    WebSocket.prototype.send = function (this: WebSocket, data: any, ...rest: any[]) { frames.push(Buffer.from(data).toString('latin1')); return (orig as any).call(this, data, ...rest) } as any
    cleanups.push(() => { WebSocket.prototype.send = orig })
    const bob = await join(h.port, h.code, 'Bob')
    await bob.until(() => bob.of('welcome').length === 1)
    bob.c.send({ t: 'present-start' })
    await new Promise((r) => setTimeout(r, 100))
    const wire = frames.join('|')
    expect(frames.length).toBeGreaterThan(3)
    expect(wire).not.toContain(h.code)
    expect(wire).not.toContain('present-start') // post-handshake traffic is encrypted
  })

  it('drops the connection on a tampered or replayed encrypted frame', async () => {
    const h = await host()
    const frames: Buffer[] = []
    const orig = WebSocket.prototype.send
    WebSocket.prototype.send = function (this: WebSocket, data: any, ...rest: any[]) { if (Buffer.isBuffer(data)) frames.push(Buffer.from(data)); return (orig as any).call(this, data, ...rest) } as any
    cleanups.push(() => { WebSocket.prototype.send = orig })
    const bob = await join(h.port, h.code, 'Bob')
    await bob.until(() => bob.of('welcome').length === 1)
    bob.c.send({ t: 'present-start' })
    await new Promise((r) => setTimeout(r, 50))
    const replay = frames.at(-1)!
    ;(bob.c as any).ws.send(replay) // same counter again
    await new Promise((r) => setTimeout(r, 100))
    expect(h.meeting.state().participants.find((p) => p.name === 'Bob')).toBeUndefined() // kicked off by the host
  })

  it('closes a raw socket that skips the handshake', async () => {
    const h = await host()
    const ws = new WebSocket(`ws://127.0.0.1:${h.port}`)
    await new Promise((r) => ws.once('open', r))
    ws.send(JSON.stringify({ t: 'present-start' }))
    const code = await new Promise<number>((r) => ws.once('close', (c) => r(c)))
    expect([4400, 4401]).toContain(code)
    expect(h.meeting.size).toBe(1)
  })
})

describe('meeting lifecycle over the network', () => {
  it('ends for everyone when the host closes', async () => {
    const h = await host()
    const bob = await join(h.port, h.code, 'Bob')
    await bob.until(() => bob.of('welcome').length === 1)
    const closed = new Promise((r) => bob.c.once('closed', r))
    h.meeting.leave(h.hostId)
    await closed
    expect(bob.of('closed')[0].reason).toContain('anfitrión')
  })

  it('removes a participant who drops the connection and revokes their control', async () => {
    const h = await host()
    const bob = await join(h.port, h.code, 'Bob')
    await bob.until(() => bob.of('welcome').length === 1)
    const bobId = bob.of('welcome')[0].you
    // The creator (local) asks to control Bob; Bob accepts.
    h.meeting.handle(h.hostId, { t: 'control-request', target: bobId })
    await bob.until(() => bob.of('control-asked').length === 1)
    bob.c.send({ t: 'control-respond', controller: h.hostId, accept: true })
    await bob.until(() => bob.of('control-started').length === 1)
    h.meeting.handle(h.hostId, { t: 'control-input', target: bobId, input: { t: 'key', code: 'KeyA', down: true } })
    await bob.until(() => bob.of('control-input').length === 1)
    expect(bob.of('control-input')[0].input).toEqual({ t: 'key', code: 'KeyA', down: true })
    ;(bob.c as any).ws.terminate() // cable pulled
    await new Promise((r) => setTimeout(r, 100))
    expect(h.meeting.state().controls).toEqual([])
    expect(h.meeting.state().participants).toHaveLength(1)
  })

  it('a participant cannot make themselves admin over the wire', async () => {
    const h = await host()
    const bob = await join(h.port, h.code, 'Bob')
    await bob.until(() => bob.of('welcome').length === 1)
    const bobId = bob.of('welcome')[0].you
    bob.c.send({ t: 'set-role', target: bobId, role: 'admin' })
    await bob.until(() => bob.of('notice').length === 1)
    expect(h.meeting.state().participants.find((p) => p.id === bobId)!.role).toBe('participant')
  })
})
