import { describe, it, expect, vi, afterEach } from 'vitest'
import { MeetingHost, CONTROL_ASK_TTL_MS, CONTROL_RATE, type Conn } from './meeting'
import { MAX_PARTICIPANTS, type ServerMessage, type ClientMessage } from '@mirror-studio/protocol'

class Fake implements Conn {
  got: ServerMessage[] = []; closedWith?: string
  send(m: ServerMessage) { this.got.push(m) }
  close(r: string) { this.closedWith = r }
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
