import { describe, it, expect, vi, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { MeetingHost, CONTROL_ASK_TTL_MS, CONTROL_RATE, FILE_BACKLOG, HAND_NOTICE_MS, LIMITS, type Conn, type JoinInfo, type Limit } from './meeting'
import {
  FILE_CHUNK, MAX_PARTICIPANTS, MAX_FILE_BYTES, MSG_HISTORY, PAIR_TOKEN_TTL_MS, encodeFileChunk, fileChunkCount, parseFileChunk,
  type ServerMessage, type ClientMessage
} from '@mirror-studio/protocol'

class Fake implements Conn {
  got: ServerMessage[] = []; closedWith?: string
  chunks: Uint8Array[] = []; queued = 0
  send(m: ServerMessage) { this.got.push(m) }
  close(r: string) { this.closedWith = r }
  sendFile(c: Uint8Array) { this.chunks.push(c) }
  backlog() { return this.queued }
  of<T extends ServerMessage['t']>(t: T) { return this.got.filter((m) => m.t === t) as Extract<ServerMessage, { t: T }>[] }
  last<T extends ServerMessage['t']>(t: T) { return this.of(t).at(-1) }
}

function room() {
  const m = new MeetingHost('Clase')
  const mk = (name: string) => { const c = new Fake(); const id = m.join(name, c)!; return { c, id } }
  const boss = mk('Ana')
  return { m, mk, boss }
}
const send = (m: MeetingHost, id: string, msg: ClientMessage) => m.handle(id, msg)
const role = (m: MeetingHost, id: string) => m.state().participants.find((p) => p.id === id)!.role

afterEach(() => vi.useRealTimers())

describe('joining', () => {
  it('first participant is the creator and host; others are participants', () => {
    const { m, mk, boss } = room()
    const bob = mk('Bob')
    expect(role(m, boss.id)).toBe('creator')
    expect(role(m, bob.id)).toBe('participant')
    expect(bob.c.last('welcome')!.you).toBe(bob.id)
  })
  it('refuses new participants over the limit and after closing', () => {
    const { m } = room()
    for (let i = 1; i < MAX_PARTICIPANTS; i++) expect(m.join(`p${i}`, new Fake())).not.toBeNull()
    expect(m.join('extra', new Fake())).toBeNull()
    m.close('fin')
    expect(m.join('late', new Fake())).toBeNull()
  })
  it('ends the meeting for everyone when the creator leaves', () => {
    const { m, mk, boss } = room()
    const bob = mk('Bob')
    const closed = vi.fn(); m.on('closed', closed)
    m.leave(boss.id)
    expect(m.isClosed).toBe(true)
    expect(bob.c.last('closed')).toBeTruthy()
    expect(bob.c.closedWith).toBeTruthy()
    expect(closed).toHaveBeenCalledOnce()
  })
})

describe('roles are validated by the host', () => {
  it('a participant cannot promote themselves or anyone', () => {
    const { m, mk } = room()
    const bob = mk('Bob'), eve = mk('Eve')
    send(m, bob.id, { t: 'set-role', target: bob.id, role: 'admin' })
    send(m, bob.id, { t: 'set-role', target: eve.id, role: 'teacher' })
    expect(role(m, bob.id)).toBe('participant')
    expect(role(m, eve.id)).toBe('participant')
    expect(bob.c.of('notice').length).toBe(2)
  })
  it('the creator assigns and removes roles; the creator role cannot be changed', () => {
    const { m, mk, boss } = room()
    const bob = mk('Bob')
    send(m, boss.id, { t: 'set-role', target: bob.id, role: 'teacher' })
    expect(role(m, bob.id)).toBe('teacher')
    send(m, boss.id, { t: 'set-role', target: bob.id, role: 'admin' })
    expect(role(m, bob.id)).toBe('admin')
    send(m, bob.id, { t: 'set-role', target: boss.id, role: 'participant' })
    expect(role(m, boss.id)).toBe('creator')
    send(m, boss.id, { t: 'set-role', target: bob.id, role: 'participant' })
    expect(role(m, bob.id)).toBe('participant')
  })
  it('an admin makes teachers but cannot make admins', () => {
    const { m, mk, boss } = room()
    const adm = mk('Adm'), eve = mk('Eve')
    send(m, boss.id, { t: 'set-role', target: adm.id, role: 'admin' })
    send(m, adm.id, { t: 'set-role', target: eve.id, role: 'admin' })
    expect(role(m, eve.id)).toBe('participant')
    send(m, adm.id, { t: 'set-role', target: eve.id, role: 'teacher' })
    expect(role(m, eve.id)).toBe('teacher')
  })
  it('kick respects rank', () => {
    const { m, mk, boss } = room()
    const t = mk('Teacher'), p = mk('P')
    send(m, boss.id, { t: 'set-role', target: t.id, role: 'teacher' })
    send(m, t.id, { t: 'kick', target: p.id }) // teachers cannot kick
    expect(m.state().participants.some((x) => x.id === p.id)).toBe(true)
    send(m, t.id, { t: 'kick', target: boss.id }) // nobody kicks the creator
    expect(m.state().participants.some((x) => x.id === boss.id)).toBe(true)
    send(m, boss.id, { t: 'kick', target: p.id })
    expect(m.state().participants.some((x) => x.id === p.id)).toBe(false)
    expect(p.c.last('closed')).toBeTruthy()
  })
})

describe('presenting', () => {
  it('anyone presents; a lower rank cannot take over', () => {
    const { m, mk, boss } = room()
    const p = mk('P'), t = mk('T')
    send(m, boss.id, { t: 'set-role', target: t.id, role: 'teacher' })
    send(m, p.id, { t: 'present-start' })
    expect(m.state().presenter).toBe(p.id) // a participant may present when the stage is free
    send(m, boss.id, { t: 'present-start' }) // and the creator may take over
    expect(m.state().presenter).toBe(boss.id)
    send(m, p.id, { t: 'present-start' }) // but not the other way round
    expect(m.state().presenter).toBe(boss.id)
    send(m, t.id, { t: 'present-start' }) // creator outranks teacher
    expect(m.state().presenter).toBe(boss.id)
    send(m, t.id, { t: 'present-stop' })
    expect(m.state().presenter).toBe(boss.id)
    send(m, boss.id, { t: 'present-stop' })
    expect(m.state().presenter).toBeNull()
  })
  it('keeps presenting after losing a role, stops when the presenter leaves', () => {
    const { m, mk, boss } = room()
    const t = mk('T')
    send(m, boss.id, { t: 'set-role', target: t.id, role: 'teacher' })
    send(m, t.id, { t: 'present-start' })
    send(m, boss.id, { t: 'set-role', target: t.id, role: 'participant' })
    expect(m.state().presenter).toBe(t.id)
    m.leave(t.id)
    expect(m.state().presenter).toBeNull()
  })
})

describe('PC control', () => {
  function setup() {
    const r = room()
    const teacher = r.mk('Prof'), luis = r.mk('Luis')
    send(r.m, r.boss.id, { t: 'set-role', target: teacher.id, role: 'teacher' })
    return { ...r, teacher, luis }
  }
  const grant = (s: ReturnType<typeof setup>) => {
    send(s.m, s.teacher.id, { t: 'control-request', target: s.luis.id })
    send(s.m, s.luis.id, { t: 'control-respond', controller: s.teacher.id, accept: true })
  }

  it('needs the target to accept; input before that is dropped', () => {
    const s = setup()
    send(s.m, s.teacher.id, { t: 'control-request', target: s.luis.id })
    expect(s.luis.c.last('control-asked')).toMatchObject({ controller: s.teacher.id, name: 'Prof' })
    send(s.m, s.teacher.id, { t: 'control-input', target: s.luis.id, input: { t: 'mouse-move', x: 0.5, y: 0.5 } })
    expect(s.luis.c.of('control-input')).toHaveLength(0)
    send(s.m, s.luis.id, { t: 'control-respond', controller: s.teacher.id, accept: true })
    expect(s.m.state().controls).toEqual([{ controller: s.teacher.id, target: s.luis.id }])
    send(s.m, s.teacher.id, { t: 'control-input', target: s.luis.id, input: { t: 'mouse-move', x: 0.5, y: 0.5 } })
    expect(s.luis.c.of('control-input')).toHaveLength(1)
    expect(s.luis.c.last('control-input')).toMatchObject({ from: s.teacher.id })
  })
  it('relays health only from the controlled PC to its controller, and a reset only the other way', () => {
    const s = setup()
    const eve = s.mk('Eve')
    const health = { code: 'blocked-admin', detail: 'Taskmgr', received: 3 } as const
    send(s.m, s.luis.id, { t: 'control-status', other: s.teacher.id, health }) // no grant yet: dropped
    send(s.m, s.teacher.id, { t: 'control-reset', target: s.luis.id })
    expect(s.teacher.c.of('control-status')).toHaveLength(0)
    expect(s.luis.c.of('control-reset')).toHaveLength(0)
    grant(s)
    send(s.m, s.luis.id, { t: 'control-status', other: s.teacher.id, health })
    expect(s.teacher.c.last('control-status')).toEqual({ t: 'control-status', from: s.luis.id, health })
    send(s.m, s.teacher.id, { t: 'control-reset', target: s.luis.id })
    expect(s.luis.c.last('control-reset')).toEqual({ t: 'control-reset', from: s.teacher.id })
    // Nobody else can fake either direction, and nobody else hears them.
    send(s.m, eve.id, { t: 'control-status', other: s.teacher.id, health: { code: 'ok', received: 0 } })
    send(s.m, eve.id, { t: 'control-reset', target: s.luis.id })
    send(s.m, s.teacher.id, { t: 'control-status', other: s.luis.id, health }) // wrong direction
    expect(s.teacher.c.of('control-status')).toHaveLength(1)
    expect(s.luis.c.of('control-reset')).toHaveLength(1)
    expect(s.luis.c.of('control-status')).toHaveLength(0)
    expect(eve.c.of('control-status')).toHaveLength(0)
    expect(s.boss.c.of('control-reset')).toHaveLength(0)
  })
  it('a participant cannot request control, nor grant it to themselves', () => {
    const s = setup()
    const eve = s.mk('Eve')
    send(s.m, eve.id, { t: 'control-request', target: s.luis.id })
    expect(s.luis.c.of('control-asked')).toHaveLength(0)
    send(s.m, eve.id, { t: 'control-respond', controller: eve.id, accept: true }) // forged response
    send(s.m, eve.id, { t: 'control-input', target: s.luis.id, input: { t: 'key', code: 'KeyA', down: true } })
    expect(s.m.state().controls).toEqual([])
    expect(s.luis.c.of('control-input')).toHaveLength(0)
  })
  it('a third party cannot answer on behalf of the target', () => {
    const s = setup()
    const eve = s.mk('Eve')
    send(s.m, s.teacher.id, { t: 'control-request', target: s.luis.id })
    send(s.m, eve.id, { t: 'control-respond', controller: s.teacher.id, accept: true })
    expect(s.m.state().controls).toEqual([])
  })
  it('rejection and timeout end the request', () => {
    vi.useFakeTimers()
    const s = setup()
    send(s.m, s.teacher.id, { t: 'control-request', target: s.luis.id })
    send(s.m, s.luis.id, { t: 'control-respond', controller: s.teacher.id, accept: false })
    expect(s.teacher.c.last('control-ended')).toMatchObject({ reason: 'Rechazado' })
    send(s.m, s.teacher.id, { t: 'control-request', target: s.luis.id })
    vi.advanceTimersByTime(CONTROL_ASK_TTL_MS + 1)
    send(s.m, s.luis.id, { t: 'control-respond', controller: s.teacher.id, accept: true }) // too late
    expect(s.m.state().controls).toEqual([])
  })
  it('the target can revoke at any time, and the target is told to release held keys', () => {
    const s = setup(); grant(s)
    const ended = vi.fn(); s.m.on('control-ended', ended)
    send(s.m, s.luis.id, { t: 'control-revoke', other: s.teacher.id })
    expect(s.m.state().controls).toEqual([])
    expect(ended).toHaveBeenCalledWith(s.teacher.id, s.luis.id)
    expect(s.luis.c.last('control-ended')).toBeTruthy()
    send(s.m, s.teacher.id, { t: 'control-input', target: s.luis.id, input: { t: 'mouse-move', x: 0.1, y: 0.1 } })
    expect(s.luis.c.of('control-input')).toHaveLength(0)
  })
  it('revokes when either side disconnects or the session ends', () => {
    let s = setup(); grant(s)
    let ended = vi.fn(); s.m.on('control-ended', ended)
    s.m.leave(s.luis.id)
    expect(s.m.state().controls).toEqual([])
    expect(ended).toHaveBeenCalledOnce()
    expect(s.teacher.c.last('control-ended')).toMatchObject({ target: s.luis.id }) // the other side is told

    s = setup(); grant(s); ended = vi.fn(); s.m.on('control-ended', ended)
    s.m.leave(s.teacher.id)
    expect(ended).toHaveBeenCalledOnce()

    s = setup(); grant(s); ended = vi.fn(); s.m.on('control-ended', ended)
    s.m.close('fin')
    expect(ended).toHaveBeenCalledOnce()
  })
  it('revokes when the controller loses the teacher role', () => {
    const s = setup(); grant(s)
    send(s.m, s.boss.id, { t: 'set-role', target: s.teacher.id, role: 'participant' })
    expect(s.m.state().controls).toEqual([])
  })
  it('allows one controller per target and one target per controller', () => {
    const s = setup(); grant(s)
    const t2 = s.mk('Prof2'), carla = s.mk('Carla')
    send(s.m, s.boss.id, { t: 'set-role', target: t2.id, role: 'teacher' })
    send(s.m, t2.id, { t: 'control-request', target: s.luis.id })
    expect(t2.c.last('notice')!.text).toContain('controlado')
    send(s.m, s.teacher.id, { t: 'control-request', target: carla.id })
    expect(carla.c.of('control-asked')).toHaveLength(0)
  })
  it('does not allow controlling yourself', () => {
    const s = setup()
    send(s.m, s.teacher.id, { t: 'control-request', target: s.teacher.id })
    expect(s.teacher.c.of('control-asked')).toHaveLength(0)
  })
  it('drops input beyond the rate limit', () => {
    vi.useFakeTimers()
    const s = setup(); grant(s)
    for (let i = 0; i < CONTROL_RATE + 200; i++) send(s.m, s.teacher.id, { t: 'control-input', target: s.luis.id, input: { t: 'mouse-move', x: 0.5, y: 0.5 } })
    expect(s.luis.c.of('control-input').length).toBeLessThanOrEqual(CONTROL_RATE)
    vi.advanceTimersByTime(1000)
    send(s.m, s.teacher.id, { t: 'control-input', target: s.luis.id, input: { t: 'mouse-move', x: 0.5, y: 0.5 } })
    expect(s.luis.c.of('control-input').length).toBeGreaterThan(CONTROL_RATE - 1)
  })
})

// ---- protocol v5 ------------------------------------------------------------------------------

const PHONE: JoinInfo = { device: 'phone', caps: ['camera', 'files'] }
const rooms: MeetingHost[] = []
afterEach(() => { rooms.splice(0).forEach((m) => m.close('fin')) }) // also deletes their temporary files
function classroom() {
  let t = 1_000_000
  const m = new MeetingHost('Clase', () => t)
  rooms.push(m)
  const mk = (name: string, info?: JoinInfo) => { const c = new Fake(); const id = m.join(name, c, info)!; return { c, id } }
  const boss = mk('Docente')
  const teacher = mk('Prof')
  m.handle(boss.id, { t: 'set-role', target: teacher.id, role: 'teacher' })
  const ana = mk('Ana'), luis = mk('Luis')
  return { m, mk, boss, teacher, ana, luis, tick: (ms: number) => { t += ms } }
}
type Room = ReturnType<typeof classroom>
const who = (m: MeetingHost, id: string) => m.state().participants.find((p) => p.id === id)!
const texts = ({ c }: { c: Fake }) => c.of('msg').map((x) => (x.body.kind === 'text' || x.body.kind === 'question' ? x.body.text : x.body.kind))
const until = async (pred: () => boolean) => { for (let i = 0; i < 300 && !pred(); i++) await new Promise((r) => setTimeout(r, 2)); return pred() }
function paired(r: Room, pc = r.ana) {
  const phone = r.mk('Galaxy', PHONE)
  send(r.m, pc.id, { t: 'pair-create' })
  send(r.m, phone.id, { t: 'pair-claim', token: pc.c.last('pair-token')!.token })
  return phone
}

describe('hello: device and caps', () => {
  it('stores the device in the participant; PCs by default', () => {
    const r = classroom()
    const phone = r.mk('Galaxy', PHONE)
    expect(who(r.m, phone.id)).toMatchObject({ device: 'phone', hand: null, pairedWith: null })
    expect(who(r.m, r.ana.id).device).toBe('pc')
  })
  it('never sends media-mode to a member without the relay cap', () => {
    const r = classroom()
    const phone = r.mk('Galaxy', PHONE)
    r.m.sendMediaMode(phone.id, 'failed')
    r.m.sendMediaMode(r.ana.id, 'failed')
    expect(phone.c.of('media-mode')).toHaveLength(0)
    expect(r.ana.c.of('media-mode')).toHaveLength(1)
  })
  it('ignores media-mode and relayed media from a member without the relay cap', () => {
    const r = classroom()
    const phone = r.mk('Galaxy', PHONE)
    const modes = vi.fn(), media = vi.fn()
    r.m.on('media-mode', modes); r.m.on('media', media)
    send(r.m, phone.id, { t: 'media-mode', relay: true })
    r.m.media(phone.id, 3, new Uint8Array(4))
    expect(modes).not.toHaveBeenCalled(); expect(media).not.toHaveBeenCalled()
    send(r.m, r.ana.id, { t: 'media-mode', relay: true })
    expect(modes).toHaveBeenCalledWith(r.ana.id)
  })
})

describe('rate limits (token buckets per member)', () => {
  const cases: [string, Limit, (r: Room) => { from: string; msg: () => ClientMessage; out: () => number }][] = [
    ['slide', 'slide', (r) => { const p = paired(r); return { from: p.id, msg: () => ({ t: 'slide', action: 'next' }), out: () => r.ana.c.of('slide').length } }],
    ['pointer', 'pointer', (r) => { send(r.m, r.ana.id, { t: 'present-start' }); const p = paired(r); return { from: p.id, msg: () => ({ t: 'pointer', x: 0.5, y: 0.5, on: true }), out: () => r.ana.c.of('pointer').length } }],
    ['ink', 'ink', (r) => { send(r.m, r.ana.id, { t: 'present-start' }); const p = paired(r); return { from: p.id, msg: () => ({ t: 'ink', stroke: 1, points: [[0, 0]], color: 'red', width: 1, tool: 'pen', done: false }), out: () => r.ana.c.of('ink').length } }],
    ['msg-send', 'msg', (r) => ({ from: r.ana.id, msg: () => ({ t: 'msg-send', to: 'all', body: { kind: 'text', text: 'hola' } }), out: () => r.luis.c.of('msg').length })],
    ['hand', 'hand', (r) => ({ from: r.ana.id, msg: () => ({ t: 'hand', up: true, text: '¿Puedo?' }), out: () => r.teacher.c.of('msg').length })],
    ['poll-vote', 'vote', (r) => {
      send(r.m, r.teacher.id, { t: 'poll-create', question: '¿?', options: ['a', 'b'], multi: false, anonymous: false, showResults: 'live' })
      const pollId = r.teacher.c.last('poll-state')!.pollId
      const base = r.teacher.c.of('poll-state').length
      let n = 0
      return { from: r.ana.id, msg: () => ({ t: 'poll-vote', pollId, choices: [n++ % 2] }), out: () => r.teacher.c.of('poll-state').length - base }
    }]
  ]
  for (const [name, kind, setup] of cases) {
    it(`${name}: ${LIMITS[kind].n} per ${LIMITS[kind].ms / 1000} s`, () => {
      const r = classroom()
      const s = setup(r)
      for (let i = 0; i < LIMITS[kind].n + 5; i++) send(r.m, s.from, s.msg())
      expect(s.out()).toBe(LIMITS[kind].n)
      r.tick(LIMITS[kind].ms)
      send(r.m, s.from, s.msg())
      expect(s.out()).toBe(LIMITS[kind].n + 1)
    })
  }
})

describe('pairing a phone with its PC', () => {
  it('a PC gets a single-use 16-byte base64url token valid 2 minutes; nobody else sees it', () => {
    const r = classroom()
    send(r.m, r.ana.id, { t: 'pair-create' })
    const tok = r.ana.c.last('pair-token')!
    expect(tok.token).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(Buffer.from(tok.token, 'base64url')).toHaveLength(16)
    expect(tok.expiresAt).toBe(1_000_000 + PAIR_TOKEN_TTL_MS)
    expect(r.luis.c.of('pair-token')).toHaveLength(0)
  })
  it('only a PC can create a token', () => {
    const r = classroom()
    const phone = r.mk('Galaxy', PHONE)
    send(r.m, phone.id, { t: 'pair-create' })
    expect(phone.c.of('pair-token')).toHaveLength(0)
    expect(phone.c.last('notice')!.text).toContain('Solo una PC')
  })
  it('a phone claims it and both get pairedWith', () => {
    const r = classroom()
    const phone = paired(r)
    expect(who(r.m, r.ana.id).pairedWith).toBe(phone.id)
    expect(who(r.m, phone.id).pairedWith).toBe(r.ana.id)
  })
  it('a PC cannot claim a token, and trying does not use it up', () => {
    const r = classroom()
    send(r.m, r.ana.id, { t: 'pair-create' })
    const token = r.ana.c.last('pair-token')!.token
    send(r.m, r.luis.id, { t: 'pair-claim', token })
    expect(who(r.m, r.luis.id).pairedWith).toBeNull()
    expect(r.luis.c.last('notice')!.text).toContain('Solo un teléfono')
    const phone = r.mk('Galaxy', PHONE)
    send(r.m, phone.id, { t: 'pair-claim', token })
    expect(who(r.m, phone.id).pairedWith).toBe(r.ana.id)
  })
  it('an expired token fails with "El QR de vinculación caducó"', () => {
    const r = classroom()
    send(r.m, r.ana.id, { t: 'pair-create' })
    const token = r.ana.c.last('pair-token')!.token
    r.tick(PAIR_TOKEN_TTL_MS)
    const phone = r.mk('Galaxy', PHONE)
    send(r.m, phone.id, { t: 'pair-claim', token })
    expect(who(r.m, phone.id).pairedWith).toBeNull()
    expect(phone.c.last('notice')!.text).toBe('El QR de vinculación caducó')
  })
  it('a token works only once', () => {
    const r = classroom()
    send(r.m, r.ana.id, { t: 'pair-create' })
    const token = r.ana.c.last('pair-token')!.token
    const p1 = r.mk('Galaxy', PHONE), p2 = r.mk('Pixel', PHONE)
    send(r.m, p1.id, { t: 'pair-claim', token })
    send(r.m, p1.id, { t: 'pair-end' })
    send(r.m, p2.id, { t: 'pair-claim', token })
    expect(who(r.m, p2.id).pairedWith).toBeNull()
    expect(p2.c.last('notice')!.text).toBe('El QR de vinculación caducó')
  })
  it('a PC has at most one phone', () => {
    const r = classroom()
    paired(r)
    send(r.m, r.ana.id, { t: 'pair-create' })
    expect(r.ana.c.of('pair-token')).toHaveLength(1)
    expect(r.ana.c.last('notice')!.text).toContain('ya tiene un teléfono')
  })
  it('a new token replaces the PC\'s previous one', () => {
    const r = classroom()
    send(r.m, r.ana.id, { t: 'pair-create' })
    const old = r.ana.c.last('pair-token')!.token
    send(r.m, r.ana.id, { t: 'pair-create' })
    const phone = r.mk('Galaxy', PHONE)
    send(r.m, phone.id, { t: 'pair-claim', token: old })
    expect(who(r.m, phone.id).pairedWith).toBeNull()
  })
  it('pair-end from either side and leaving unpair both', () => {
    const r = classroom()
    let phone = paired(r)
    send(r.m, r.ana.id, { t: 'pair-end' })
    expect(who(r.m, phone.id).pairedWith).toBeNull()
    expect(who(r.m, r.ana.id).pairedWith).toBeNull()
    phone = paired(r, r.luis)
    r.m.leave(phone.id)
    expect(who(r.m, r.luis.id).pairedWith).toBeNull()
    const p3 = paired(r, r.luis)
    r.m.leave(r.luis.id)
    expect(who(r.m, p3.id).pairedWith).toBeNull()
  })
})

describe('slides', () => {
  it('only a paired phone moves slides, and only on its own PC', () => {
    const r = classroom()
    const phone = paired(r)
    const stranger = r.mk('Pixel', PHONE)
    send(r.m, phone.id, { t: 'slide', action: 'next' })
    expect(r.ana.c.last('slide')).toEqual({ t: 'slide', from: phone.id, action: 'next' })
    send(r.m, stranger.id, { t: 'slide', action: 'prev' }) // unpaired phone
    send(r.m, r.luis.id, { t: 'slide', action: 'prev' }) // a PC
    send(r.m, r.boss.id, { t: 'slide', action: 'prev' }) // even the creator
    send(r.m, r.ana.id, { t: 'slide', action: 'prev' }) // the paired PC itself
    expect(r.ana.c.of('slide')).toHaveLength(1)
    for (const x of [r.boss, r.teacher, r.luis, stranger, phone]) expect(x.c.of('slide')).toHaveLength(0)
  })
  it('slide-state goes only from a PC to its paired phone', () => {
    const r = classroom()
    const phone = paired(r)
    send(r.m, r.luis.id, { t: 'slide-state', index: 1, total: 5 }) // not paired
    send(r.m, phone.id, { t: 'slide-state', index: 1, total: 5 }) // wrong direction
    send(r.m, r.ana.id, { t: 'slide-state', index: 2, total: 5, nextTitle: 'Derivadas' })
    expect(phone.c.of('slide-state')).toEqual([{ t: 'slide-state', from: r.ana.id, index: 2, total: 5, nextTitle: 'Derivadas' }])
    expect(r.ana.c.of('slide-state')).toHaveLength(0)
  })
})

describe('pointer and ink', () => {
  it('only the presenter or its paired phone, forwarded only to the presenting PC', () => {
    const r = classroom()
    const phone = paired(r)
    const pointer: ClientMessage = { t: 'pointer', x: 0.1, y: 0.2, on: true }
    send(r.m, phone.id, pointer) // nobody presents
    expect(r.ana.c.of('pointer')).toHaveLength(0)
    send(r.m, r.ana.id, { t: 'present-start', source: 'window' })
    send(r.m, phone.id, pointer)
    send(r.m, r.ana.id, pointer)
    send(r.m, r.luis.id, pointer)
    send(r.m, r.boss.id, pointer)
    expect(r.ana.c.of('pointer')).toEqual([{ t: 'pointer', from: phone.id, x: 0.1, y: 0.2, on: true }, { t: 'pointer', from: r.ana.id, x: 0.1, y: 0.2, on: true }])
    send(r.m, phone.id, { t: 'ink', stroke: 3, points: [[0.5, 0.5]], color: 'blue', width: 2, tool: 'highlighter', done: true })
    send(r.m, phone.id, { t: 'ink-undo' })
    send(r.m, phone.id, { t: 'ink-clear' })
    send(r.m, r.luis.id, { t: 'ink-clear' })
    expect(r.ana.c.last('ink')).toMatchObject({ from: phone.id, stroke: 3, color: 'blue', width: 2, tool: 'highlighter', done: true })
    expect(r.ana.c.of('ink-undo')).toEqual([{ t: 'ink-undo', from: phone.id }])
    expect(r.ana.c.of('ink-clear')).toEqual([{ t: 'ink-clear', from: phone.id }])
    for (const x of [r.boss, r.teacher, r.luis, phone]) expect(x.c.of('pointer').length + x.c.of('ink').length + x.c.of('ink-clear').length).toBe(0)
  })
  it('a phone paired with another PC cannot draw on the presenter', () => {
    const r = classroom()
    const phone = paired(r, r.luis)
    send(r.m, r.ana.id, { t: 'present-start' })
    send(r.m, phone.id, { t: 'pointer', x: 0, y: 0, on: true })
    expect(r.ana.c.of('pointer')).toHaveLength(0)
  })
  it('is ignored while a phone presents its camera', () => {
    const r = classroom()
    const phone = r.mk('Galaxy', PHONE)
    send(r.m, phone.id, { t: 'present-start', source: 'camera' })
    expect(r.m.state()).toMatchObject({ presenter: phone.id, presenterSource: 'camera' })
    send(r.m, phone.id, { t: 'pointer', x: 0, y: 0, on: true })
    send(r.m, phone.id, { t: 'ink-clear' })
    expect(phone.c.of('pointer')).toHaveLength(0)
    expect(phone.c.of('ink-clear')).toHaveLength(0)
  })
})

describe('presenting a camera', () => {
  it('present-start defaults to screen; camera needs the camera cap; stopping clears the source', () => {
    const r = classroom()
    send(r.m, r.ana.id, { t: 'present-start' })
    expect(r.m.state().presenterSource).toBe('screen')
    send(r.m, r.ana.id, { t: 'present-start', source: 'camera' }) // a PC without the camera cap
    expect(r.m.state().presenterSource).toBe('screen')
    expect(r.ana.c.last('notice')!.text).toContain('cámara')
    send(r.m, r.ana.id, { t: 'present-stop' })
    expect(r.m.state()).toMatchObject({ presenter: null, presenterSource: null })
  })
})

describe('chat permissions', () => {
  const text = (to: 'all' | 'teachers' | string[], t = 'hola'): ClientMessage => ({ t: 'msg-send', to, body: { kind: 'text', text: t } })
  it('the host assigns id, from and at; a message to all reaches everyone, sender included', () => {
    const r = classroom()
    send(r.m, r.ana.id, text('all'))
    const got = r.luis.c.last('msg')!
    expect(got).toMatchObject({ t: 'msg', from: r.ana.id, at: 1_000_000, to: 'all', body: { kind: 'text', text: 'hola' } })
    expect(got.id).toBeTruthy()
    for (const x of [r.boss, r.teacher, r.ana, r.luis]) expect(x.c.of('msg')).toHaveLength(1)
  })
  it('a participant writing to teachers reaches only teachers and above (and themselves)', () => {
    const r = classroom()
    send(r.m, r.ana.id, text('teachers'))
    expect(r.boss.c.of('msg')).toHaveLength(1)
    expect(r.teacher.c.of('msg')).toHaveLength(1)
    expect(r.ana.c.of('msg')).toHaveLength(1)
    expect(r.luis.c.of('msg')).toHaveLength(0)
  })
  it('chat "teachers": a participant cannot reach everyone; "off": not even teachers; teachers are not limited', () => {
    const r = classroom()
    send(r.m, r.teacher.id, { t: 'room-settings', chat: 'teachers', share: 'all', locked: false })
    expect(r.m.state().settings).toEqual({ chat: 'teachers', share: 'all', locked: false })
    send(r.m, r.ana.id, text('all', 'a todos'))
    send(r.m, r.ana.id, text('teachers', 'a docentes'))
    expect(texts(r.luis)).toEqual([])
    expect(texts(r.teacher)).toEqual(['a docentes'])
    send(r.m, r.teacher.id, { t: 'room-settings', chat: 'off', share: 'all', locked: false })
    send(r.m, r.ana.id, text('teachers', 'apagado'))
    expect(texts(r.teacher)).toEqual(['a docentes'])
    expect(r.ana.c.last('notice')!.text).toContain('desactivó el chat')
    send(r.m, r.teacher.id, text('all', 'docente'))
    expect(texts(r.luis)).toEqual(['docente'])
  })
  it('the chat setting also covers questions; share covers links and files', () => {
    const r = classroom()
    send(r.m, r.teacher.id, { t: 'room-settings', chat: 'off', share: 'teachers', locked: false })
    send(r.m, r.ana.id, { t: 'msg-send', to: 'teachers', body: { kind: 'question', text: '¿?' } })
    send(r.m, r.ana.id, { t: 'msg-send', to: 'all', body: { kind: 'link', url: 'https://a.org' } })
    expect(r.teacher.c.of('msg')).toHaveLength(0)
    send(r.m, r.ana.id, { t: 'msg-send', to: 'teachers', body: { kind: 'link', url: 'https://a.org' } })
    expect(r.teacher.c.last('msg')!.body).toEqual({ kind: 'link', url: 'https://a.org' })
    expect(r.luis.c.of('msg')).toHaveLength(0)
  })
  it('participants can ask questions to everyone; to chosen people only teachers can write', () => {
    const r = classroom()
    send(r.m, r.ana.id, { t: 'msg-send', to: 'all', body: { kind: 'question', text: '¿Alguien sabe?' } })
    expect(texts(r.luis)).toEqual(['¿Alguien sabe?'])
    send(r.m, r.ana.id, text([r.luis.id], 'privado'))
    expect(texts(r.luis)).toEqual(['¿Alguien sabe?'])
    send(r.m, r.teacher.id, text([r.luis.id], 'solo a Luis'))
    expect(texts(r.luis)).toEqual(['¿Alguien sabe?', 'solo a Luis'])
    expect(texts(r.ana)).toEqual(['¿Alguien sabe?'])
    expect(texts(r.teacher)).toEqual(['¿Alguien sabe?', 'solo a Luis'])
    expect(texts(r.boss)).toEqual(['¿Alguien sabe?'])
  })
  it('only teachers post polls', () => {
    const r = classroom()
    send(r.m, r.teacher.id, { t: 'poll-create', question: '¿?', options: ['a', 'b'], multi: false, anonymous: false, showResults: 'live' })
    const pollId = r.teacher.c.last('poll-state')!.pollId
    send(r.m, r.ana.id, { t: 'msg-send', to: 'all', body: { kind: 'poll', pollId } })
    expect(r.luis.c.of('msg').filter((x) => x.from === r.ana.id)).toHaveLength(0)
    send(r.m, r.teacher.id, { t: 'msg-send', to: 'all', body: { kind: 'poll', pollId } })
    expect(r.luis.c.of('msg').filter((x) => x.body.kind === 'poll')).toHaveLength(2) // the automatic one and the repost
  })
  it('links must be http or https', () => {
    const r = classroom()
    for (const url of ['javascript:alert(1)', 'file:///C:/Windows/win.ini', 'data:text/html,hi', 'no es un enlace']) {
      send(r.m, r.teacher.id, { t: 'msg-send', to: 'all', body: { kind: 'link', url } })
      r.tick(LIMITS.msg.ms)
    }
    expect(r.luis.c.of('msg')).toHaveLength(0)
    expect(r.teacher.c.last('notice')!.text).toContain('http')
    send(r.m, r.ana.id, { t: 'msg-send', to: 'all', body: { kind: 'link', url: 'http://example.org/x', title: 'X' } })
    expect(r.luis.c.of('msg')).toHaveLength(1)
  })
  it('a muted person cannot write until unmuted; only a higher rank mutes', () => {
    const r = classroom()
    send(r.m, r.luis.id, { t: 'mute-chat', target: r.ana.id, on: true })
    send(r.m, r.ana.id, text('all', 'uno'))
    expect(texts(r.luis)).toEqual(['uno'])
    send(r.m, r.teacher.id, { t: 'mute-chat', target: r.ana.id, on: true })
    expect(r.ana.c.last('notice')!.text).toContain('silenció')
    send(r.m, r.ana.id, text('all', 'dos'))
    expect(texts(r.luis)).toEqual(['uno'])
    send(r.m, r.teacher.id, { t: 'mute-chat', target: r.boss.id, on: true })
    send(r.m, r.boss.id, text('all', 'creador'))
    expect(texts(r.luis)).toEqual(['uno', 'creador'])
    send(r.m, r.teacher.id, { t: 'mute-chat', target: r.ana.id, on: false })
    send(r.m, r.ana.id, text('all', 'tres'))
    expect(texts(r.luis)).toEqual(['uno', 'creador', 'tres'])
  })
  it('only teachers change room settings', () => {
    const r = classroom()
    send(r.m, r.ana.id, { t: 'room-settings', chat: 'off', share: 'off', locked: true })
    expect(r.m.state().settings).toEqual({ chat: 'all', share: 'all', locked: false })
    expect(r.ana.c.last('notice')).toBeTruthy()
  })
  it('a locked room refuses new people; those inside stay', () => {
    const r = classroom()
    send(r.m, r.teacher.id, { t: 'room-settings', chat: 'all', share: 'all', locked: true })
    expect(r.m.locked).toBe(true)
    expect(r.m.join('Tarde', new Fake())).toBeNull()
    expect(r.m.size).toBe(4)
    send(r.m, r.teacher.id, { t: 'room-settings', chat: 'all', share: 'all', locked: false })
    expect(r.m.join('Tarde', new Fake())).not.toBeNull()
  })
})

describe('chat history and moderation', () => {
  const text = (t: string, to: 'all' | 'teachers' = 'all'): ClientMessage => ({ t: 'msg-send', to, body: { kind: 'text', text: t } })
  it('a late joiner gets msg-history right after welcome, only what they may see', () => {
    const r = classroom()
    send(r.m, r.ana.id, text('público'))
    send(r.m, r.ana.id, text('a docentes', 'teachers'))
    send(r.m, r.teacher.id, { t: 'msg-send', to: [r.luis.id], body: { kind: 'text', text: 'a Luis' } })
    const late = r.mk('Tarde')
    expect(late.c.got.map((x) => x.t).slice(0, 2)).toEqual(['welcome', 'msg-history'])
    expect(late.c.last('msg-history')!.items.map((x) => (x.body as { text: string }).text)).toEqual(['público'])
    expect(r.boss.c.of('msg')).toHaveLength(2) // the creator sees the one to teachers, not the one to Luis
  })
  it('keeps only the last 200, split into frames under the size cap', () => {
    const r = classroom()
    for (let i = 0; i < MSG_HISTORY + 20; i++) { send(r.m, r.teacher.id, text(`${i} ${'x'.repeat(900)}`)); r.tick(LIMITS.msg.ms) }
    const late = r.mk('Tarde')
    const frames = late.c.of('msg-history')
    expect(frames.length).toBeGreaterThan(1)
    for (const f of frames) expect(Buffer.byteLength(JSON.stringify(f))).toBeLessThan(64 * 1024)
    const items = frames.flatMap((f) => f.items)
    expect(items).toHaveLength(MSG_HISTORY)
    expect((items[0].body as { text: string }).text.startsWith('20 ')).toBe(true)
  })
  it('a participant deletes only their own; teachers delete anyone\'s', () => {
    const r = classroom()
    send(r.m, r.ana.id, text('de Ana'))
    send(r.m, r.luis.id, text('de Luis'))
    const [a, l] = r.boss.c.of('msg')
    send(r.m, r.ana.id, { t: 'msg-delete', id: l.id })
    expect(r.boss.c.of('msg-delete')).toHaveLength(0)
    send(r.m, r.ana.id, { t: 'msg-delete', id: a.id })
    expect(r.luis.c.last('msg-delete')).toEqual({ t: 'msg-delete', id: a.id, by: r.ana.id })
    send(r.m, r.teacher.id, { t: 'msg-delete', id: l.id })
    expect(r.ana.c.last('msg-delete')).toEqual({ t: 'msg-delete', id: l.id, by: r.teacher.id })
    expect(r.mk('Tarde').c.last('msg-history')!.items).toHaveLength(0)
  })
  it('teachers mark a question answered and show it to everyone, anonymously if they choose', () => {
    const r = classroom()
    send(r.m, r.ana.id, { t: 'msg-send', to: 'teachers', body: { kind: 'question', text: '¿Entra?' } })
    const q = r.teacher.c.last('msg')!
    send(r.m, r.luis.id, { t: 'msg-mark', id: q.id, answered: true })
    send(r.m, r.luis.id, { t: 'msg-show', id: q.id, anonymous: false })
    expect(r.luis.c.of('msg')).toHaveLength(0)
    send(r.m, r.teacher.id, { t: 'msg-mark', id: q.id, answered: true })
    expect(r.ana.c.last('msg')).toMatchObject({ id: q.id, answered: true })
    expect(r.luis.c.of('msg')).toHaveLength(0)
    send(r.m, r.teacher.id, { t: 'msg-show', id: q.id, anonymous: true })
    expect(r.luis.c.last('msg')).toMatchObject({ id: q.id, from: null, shown: true, answered: true })
    expect(r.teacher.c.last('msg')).toMatchObject({ id: q.id, from: r.ana.id, shown: true })
    expect(r.ana.c.last('msg')).toMatchObject({ id: q.id, from: r.ana.id, shown: true })
    expect(r.mk('Tarde').c.last('msg-history')!.items[0]).toMatchObject({ id: q.id, from: null, shown: true })
  })
})

describe('raised hands', () => {
  it('queue positions follow the order, and close up when a hand goes down', () => {
    const r = classroom()
    send(r.m, r.ana.id, { t: 'hand', up: true })
    send(r.m, r.luis.id, { t: 'hand', up: true })
    send(r.m, r.boss.id, { t: 'hand', up: true })
    expect([r.ana, r.luis, r.boss].map((x) => who(r.m, x.id).hand)).toEqual([1, 2, 3])
    send(r.m, r.ana.id, { t: 'hand', up: false })
    expect([r.ana, r.luis, r.boss].map((x) => who(r.m, x.id).hand)).toEqual([null, 1, 2])
    send(r.m, r.ana.id, { t: 'hand', up: true })
    expect(who(r.m, r.ana.id).hand).toBe(3)
  })
  it('anyone lowers their own; only teachers lower someone else\'s', () => {
    const r = classroom()
    send(r.m, r.ana.id, { t: 'hand', up: true })
    send(r.m, r.luis.id, { t: 'hand-lower', target: r.ana.id })
    expect(who(r.m, r.ana.id).hand).toBe(1)
    send(r.m, r.teacher.id, { t: 'hand-lower', target: r.ana.id })
    expect(who(r.m, r.ana.id).hand).toBeNull()
    send(r.m, r.luis.id, { t: 'hand', up: true })
    send(r.m, r.luis.id, { t: 'hand-lower', target: r.luis.id })
    expect(who(r.m, r.luis.id).hand).toBeNull()
  })
  it('goes down by itself when the person leaves', () => {
    const r = classroom()
    send(r.m, r.ana.id, { t: 'hand', up: true })
    send(r.m, r.luis.id, { t: 'hand', up: true })
    r.m.leave(r.ana.id)
    expect(who(r.m, r.luis.id).hand).toBe(1)
  })
  it('goes down when a teacher starts controlling that PC (also a hand raised from its phone)', () => {
    const r = classroom()
    const phone = paired(r)
    send(r.m, r.ana.id, { t: 'hand', up: true })
    send(r.m, phone.id, { t: 'hand', up: true })
    send(r.m, r.luis.id, { t: 'hand', up: true })
    send(r.m, r.teacher.id, { t: 'control-request', target: r.ana.id })
    expect(who(r.m, r.ana.id).hand).toBe(1) // asking is not helping yet
    send(r.m, r.ana.id, { t: 'control-respond', controller: r.teacher.id, accept: true })
    expect(who(r.m, r.ana.id).hand).toBeNull()
    expect(who(r.m, phone.id).hand).toBeNull()
    expect(who(r.m, r.luis.id).hand).toBe(1)
  })
  it('the question goes only to teachers, as a question msg from the student, never in the state', () => {
    const r = classroom()
    send(r.m, r.ana.id, { t: 'hand', up: true, text: '¿Puede repetir?' })
    expect(r.teacher.c.last('msg')).toMatchObject({ from: r.ana.id, to: 'teachers', body: { kind: 'question', text: '¿Puede repetir?' } })
    expect(r.boss.c.of('msg')).toHaveLength(1)
    expect(r.luis.c.of('msg')).toHaveLength(0)
    expect(JSON.stringify(r.luis.c.last('state'))).not.toContain('repetir')
  })
  it('teachers hear "X levantó la mano" at most once per 10 s per student', () => {
    const r = classroom()
    send(r.m, r.ana.id, { t: 'hand', up: true })
    send(r.m, r.ana.id, { t: 'hand', up: false })
    send(r.m, r.ana.id, { t: 'hand', up: true })
    const notices = () => r.teacher.c.of('notice').filter((n) => n.text === 'Ana levantó la mano').length
    expect(notices()).toBe(1)
    expect(r.boss.c.of('notice').filter((n) => n.text === 'Ana levantó la mano')).toHaveLength(1)
    expect(r.luis.c.of('notice')).toHaveLength(0)
    r.tick(HAND_NOTICE_MS)
    send(r.m, r.ana.id, { t: 'hand', up: false })
    send(r.m, r.ana.id, { t: 'hand', up: true })
    expect(notices()).toBe(2)
  })
})

describe('polls', () => {
  function poll(r: Room, extra: Partial<{ multi: boolean; anonymous: boolean; showResults: 'live' | 'on-close' }> = {}) {
    send(r.m, r.teacher.id, { t: 'poll-create', question: '¿Qué repasamos?', options: ['Límites', 'Derivadas', 'Integrales'], multi: false, anonymous: false, showResults: 'live', ...extra })
    return r.teacher.c.last('poll-state')!.pollId
  }
  it('only teachers create and close; creating also posts a poll msg to everyone', () => {
    const r = classroom()
    send(r.m, r.ana.id, { t: 'poll-create', question: '¿?', options: ['a', 'b'], multi: false, anonymous: false, showResults: 'live' })
    expect(r.luis.c.of('poll-state')).toHaveLength(0)
    const id = poll(r)
    expect(r.luis.c.last('msg')).toMatchObject({ from: r.teacher.id, to: 'all', body: { kind: 'poll', pollId: id } })
    send(r.m, r.ana.id, { t: 'poll-close', pollId: id })
    expect(r.luis.c.last('poll-state')!.closed).toBe(false)
    send(r.m, r.boss.id, { t: 'poll-close', pollId: id })
    expect(r.luis.c.last('poll-state')!.closed).toBe(true)
  })
  it('one vote per person, replaced while open, frozen once closed', () => {
    const r = classroom()
    const id = poll(r)
    send(r.m, r.ana.id, { t: 'poll-vote', pollId: id, choices: [0] })
    send(r.m, r.ana.id, { t: 'poll-vote', pollId: id, choices: [2] })
    expect(r.teacher.c.last('poll-state')).toMatchObject({ counts: [0, 0, 1], total: 1 })
    send(r.m, r.ana.id, { t: 'poll-vote', pollId: id, choices: [0, 1] }) // not a multi poll
    send(r.m, r.luis.id, { t: 'poll-vote', pollId: id, choices: [3] }) // no such option
    expect(r.teacher.c.last('poll-state')).toMatchObject({ counts: [0, 0, 1], total: 1 })
    send(r.m, r.teacher.id, { t: 'poll-close', pollId: id })
    send(r.m, r.ana.id, { t: 'poll-vote', pollId: id, choices: [1] })
    expect(r.teacher.c.last('poll-state')).toMatchObject({ counts: [0, 0, 1], total: 1, closed: true })
  })
  it('counts always reach the creator; the others get them live or once closed', () => {
    const r = classroom()
    const id = poll(r, { showResults: 'on-close' })
    send(r.m, r.ana.id, { t: 'poll-vote', pollId: id, choices: [1] })
    expect(r.teacher.c.last('poll-state')!.counts).toEqual([0, 1, 0])
    expect(r.luis.c.last('poll-state')!.counts).toBeUndefined()
    expect(r.boss.c.last('poll-state')!.counts).toBeUndefined() // not the poll's creator
    expect(r.luis.c.last('poll-state')!.total).toBe(1)
    send(r.m, r.teacher.id, { t: 'poll-close', pollId: id })
    expect(r.luis.c.last('poll-state')!.counts).toEqual([0, 1, 0])
    const live = poll(r)
    send(r.m, r.ana.id, { t: 'poll-vote', pollId: live, choices: [0] })
    expect(r.luis.c.of('poll-state').filter((p) => p.pollId === live).at(-1)!.counts).toEqual([1, 0, 0])
  })
  it('voters only to the creator, and only when not anonymous', () => {
    const r = classroom()
    const open = poll(r)
    send(r.m, r.ana.id, { t: 'poll-vote', pollId: open, choices: [1] })
    expect(r.teacher.c.last('poll-state')!.voters).toEqual([{ id: r.ana.id, choices: [1] }])
    expect(r.luis.c.last('poll-state')!.voters).toBeUndefined()
    expect(r.boss.c.last('poll-state')!.voters).toBeUndefined()
    const anon = poll(r, { anonymous: true })
    send(r.m, r.ana.id, { t: 'poll-vote', pollId: anon, choices: [1] })
    expect(r.teacher.c.last('poll-state')).toMatchObject({ pollId: anon, counts: [0, 1, 0] })
    expect(r.teacher.c.last('poll-state')!.voters).toBeUndefined()
  })
  it('a late joiner gets the polls after the history', () => {
    const r = classroom()
    const id = poll(r)
    const late = r.mk('Tarde')
    expect(late.c.got.map((x) => x.t).slice(0, 3)).toEqual(['welcome', 'msg-history', 'poll-state'])
    expect(late.c.last('poll-state')!.pollId).toBe(id)
  })
})

describe('files', () => {
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
  function upload(r: Room, x: { c: Fake; id: string }, name: string, data: Buffer, hash = sha(data)) {
    const before = x.c.of('file-accept').length
    send(r.m, x.id, { t: 'file-offer', name, size: data.length, sha256: hash, mime: 'application/pdf' })
    if (x.c.of('file-accept').length === before) return null
    const fileId = x.c.last('file-accept')!.fileId
    const count = fileChunkCount(data.length)
    for (let i = 0; i < count; i++) expect(r.m.fileChunk(x.id, encodeFileChunk(fileId, i, count, data.subarray(i * FILE_CHUNK, (i + 1) * FILE_CHUNK)))).toBe(true)
    return fileId
  }
  const share = (r: Room, x: { id: string }, fileId: number) => send(r.m, x.id, { t: 'msg-send', to: 'all', body: { kind: 'file', fileId } })
  function received(c: Fake, fileId: number) {
    const parts = c.chunks.map((b) => parseFileChunk(b)!).filter((p) => p.fileId === fileId)
    return Buffer.concat(parts.sort((a, b) => a.index - b.index).map((p) => p.payload))
  }
  const data = (n: number) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 7) & 0xff))

  it('upload, verify, share in the chat, download: the bytes and hash arrive intact', async () => {
    const r = classroom()
    const body = data(FILE_CHUNK * 2 + 123)
    const id = upload(r, r.ana, 'apuntes.pdf', body)!
    share(r, r.ana, id)
    expect(r.luis.c.last('msg')!.body).toEqual({ kind: 'file', fileId: id, name: 'apuntes.pdf', size: body.length, mime: 'application/pdf' })
    send(r.m, r.luis.id, { t: 'file-get', fileId: id })
    expect(r.luis.c.last('file-meta')).toEqual({ t: 'file-meta', fileId: id, name: 'apuntes.pdf', size: body.length, sha256: sha(body) })
    expect(await until(() => r.luis.c.chunks.length === 3)).toBe(true)
    expect(received(r.luis.c, id).equals(body)).toBe(true)
  })
  it('rejects blocked extensions, whatever the case or trailing dots', () => {
    const r = classroom()
    for (const name of ['virus.exe', 'Script.PS1', 'setup.msi.']) expect(upload(r, r.teacher, name, data(10))).toBeNull()
    expect(r.teacher.c.last('notice')!.text).toContain('tipo de archivo')
    r.tick(LIMITS.file.ms)
    expect(upload(r, r.teacher, 'notas.txt', data(10))).not.toBeNull()
  })
  it('rejects names with a path', () => {
    const r = classroom()
    expect(upload(r, r.ana, '..\\..\\x.txt', data(10))).toBeNull()
    expect(upload(r, r.ana, 'a/b.txt', data(10))).toBeNull()
    expect(r.ana.c.last('notice')!.text).toContain('Nombre')
  })
  it('a wrong SHA-256 throws the file away and it cannot be shared', () => {
    const r = classroom()
    const id = upload(r, r.ana, 'a.pdf', data(1000), sha(data(999)))!
    expect(r.ana.c.last('notice')!.text).toContain('SHA-256')
    share(r, r.ana, id)
    expect(r.luis.c.of('msg')).toHaveLength(0)
  })
  it('chunks out of order or of the wrong size cancel the upload; a malformed frame is a protocol error', () => {
    const r = classroom()
    const body = data(FILE_CHUNK + 10)
    send(r.m, r.ana.id, { t: 'file-offer', name: 'a.pdf', size: body.length, sha256: sha(body), mime: 'application/pdf' })
    const fileId = r.ana.c.last('file-accept')!.fileId
    r.m.fileChunk(r.ana.id, encodeFileChunk(fileId, 1, 2, body.subarray(FILE_CHUNK)))
    expect(r.ana.c.last('notice')!.text).toContain('incompleto')
    expect(r.m.fileChunk(r.ana.id, new Uint8Array([2, 0, 0]))).toBe(false)
  })
  it('only the uploader can send chunks for a file', () => {
    const r = classroom()
    const body = data(100)
    send(r.m, r.ana.id, { t: 'file-offer', name: 'a.pdf', size: body.length, sha256: sha(body), mime: 'application/pdf' })
    const fileId = r.ana.c.last('file-accept')!.fileId
    r.m.fileChunk(r.luis.id, encodeFileChunk(fileId, 0, 1, Buffer.alloc(100, 1)))
    r.m.fileChunk(r.ana.id, encodeFileChunk(fileId, 0, 1, body))
    share(r, r.ana, fileId)
    expect(r.luis.c.of('msg')).toHaveLength(1)
  })
  it('50 MB per file and 200 MB per meeting', () => {
    const r = classroom()
    send(r.m, r.ana.id, { t: 'file-offer', name: 'big.mp4', size: MAX_FILE_BYTES + 1, sha256: 'a'.repeat(64), mime: 'video/mp4' })
    expect(r.ana.c.of('file-accept')).toHaveLength(0)
    const people = [r.ana, r.luis, r.teacher, r.boss]
    for (const p of people) send(r.m, p.id, { t: 'file-offer', name: 'big.mp4', size: MAX_FILE_BYTES, sha256: 'a'.repeat(64), mime: 'video/mp4' })
    expect(people.map((p) => p.c.of('file-accept').length)).toEqual([1, 1, 1, 1])
    const extra = r.mk('Extra')
    send(r.m, extra.id, { t: 'file-offer', name: 'a.txt', size: 1, sha256: 'a'.repeat(64), mime: 'text/plain' })
    expect(extra.c.last('notice')!.text).toContain('200 MB')
    r.m.leave(r.luis.id) // an unfinished upload frees its space
    send(r.m, extra.id, { t: 'file-offer', name: 'a.txt', size: 1, sha256: 'a'.repeat(64), mime: 'text/plain' })
    expect(extra.c.of('file-accept')).toHaveLength(1)
    r.m.close('fin')
  })
  it('3 files per minute per person', () => {
    const r = classroom()
    for (let i = 0; i < 4; i++) upload(r, r.ana, `f${i}.txt`, data(5))
    expect(r.ana.c.of('file-accept')).toHaveLength(3)
    expect(r.ana.c.last('notice')!.text).toContain('3 archivos por minuto')
    r.tick(LIMITS.file.ms)
    expect(upload(r, r.ana, 'f5.txt', data(5))).not.toBeNull()
  })
  it('share "off" stops participants from uploading; teachers still can', () => {
    const r = classroom()
    send(r.m, r.teacher.id, { t: 'room-settings', chat: 'all', share: 'off', locked: false })
    expect(upload(r, r.ana, 'a.txt', data(5))).toBeNull()
    expect(upload(r, r.teacher, 'a.txt', data(5))).not.toBeNull()
  })
  it('a device without the files cap cannot upload', () => {
    const r = classroom()
    const old = r.mk('Viejo', { device: 'pc', caps: ['relay'] })
    expect(upload(r, old, 'a.txt', data(5))).toBeNull()
  })
  it('only someone who can see the message (or the uploader) can download', () => {
    const r = classroom()
    const id = upload(r, r.ana, 'a.pdf', data(10))!
    send(r.m, r.luis.id, { t: 'file-get', fileId: id }) // not shared yet
    expect(r.luis.c.of('file-meta')).toHaveLength(0)
    send(r.m, r.ana.id, { t: 'msg-send', to: 'teachers', body: { kind: 'file', fileId: id } })
    send(r.m, r.luis.id, { t: 'file-get', fileId: id })
    expect(r.luis.c.of('file-meta')).toHaveLength(0)
    send(r.m, r.teacher.id, { t: 'file-get', fileId: id })
    expect(r.teacher.c.of('file-meta')).toHaveLength(1)
    expect(r.m.localFile(r.boss.id, id)).toMatchObject({ name: 'a.pdf', size: 10 })
    expect(r.m.localFile(r.luis.id, id)).toBeNull()
    r.m.close('fin')
  })
  it('chunks wait while the receiver\'s socket holds 256 KB or more', async () => {
    const r = classroom()
    const body = data(FILE_CHUNK * 3)
    const id = upload(r, r.ana, 'a.pdf', body)!
    share(r, r.ana, id)
    r.luis.c.queued = FILE_BACKLOG
    send(r.m, r.luis.id, { t: 'file-get', fileId: id })
    await new Promise((res) => setTimeout(res, 60))
    expect(r.luis.c.chunks).toHaveLength(0)
    r.luis.c.queued = FILE_BACKLOG - 1
    expect(await until(() => r.luis.c.chunks.length === 3)).toBe(true)
    expect(received(r.luis.c, id).equals(body)).toBe(true)
  })
  it('at most 2 downloads at a time per receiver; the next one starts when one ends', async () => {
    const r = classroom()
    const ids = [0, 1, 2].map((i) => { const id = upload(r, r.teacher, `f${i}.pdf`, data(FILE_CHUNK * 2))!; share(r, r.teacher, id); return id })
    r.luis.c.queued = FILE_BACKLOG
    for (const id of ids) send(r.m, r.luis.id, { t: 'file-get', fileId: id })
    expect(r.luis.c.of('file-meta').map((f) => f.fileId)).toEqual(ids.slice(0, 2))
    r.luis.c.queued = 0
    expect(await until(() => r.luis.c.of('file-meta').length === 3 && r.luis.c.chunks.length === 6)).toBe(true)
    for (const id of ids) expect(received(r.luis.c, id).equals(data(FILE_CHUNK * 2))).toBe(true)
  })
  it('the temporary folder is deleted when the meeting ends', () => {
    const r = classroom()
    const id = upload(r, r.ana, 'a.pdf', data(10))!
    const path = r.m.localFile(r.ana.id, id)!.path
    expect(existsSync(path)).toBe(true)
    r.m.close('fin')
    expect(existsSync(dirname(path))).toBe(false)
  })
})
