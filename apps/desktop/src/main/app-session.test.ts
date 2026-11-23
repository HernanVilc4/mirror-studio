import { describe, it, expect, afterEach } from 'vitest'
import { AppSession, type UiEvent } from './app-session'
import type { InputDriver } from './input'
import type { ServerMessage } from '@mirror-studio/protocol'

const IT = 1000
const sessions: AppSession[] = []
afterEach(() => { sessions.splice(0).forEach((s) => s.dispose()) })

function driver(supported = true) {
  const calls: string[] = []
  const d: InputDriver = {
    supported,
    mouseMove: (x, y) => calls.push(`move ${x},${y}`),
    mouseButton: (b, down) => calls.push(`btn ${b} ${down ? 'down' : 'up'}`),
    wheel: () => {}, text: () => {},
    key: (vk, _e, down) => calls.push(`key ${vk} ${down ? 'down' : 'up'}`),
    dispose: () => {}
  }
  return { d, calls }
}
function make(supported = true) {
  const { d, calls } = driver(supported)
  const events: UiEvent[] = []
  const banner: ({ id: string; name: string } | null)[] = []
  const s = new AppSession(d, (e) => events.push(e), IT, (by) => banner.push(by))
  sessions.push(s)
  const msgs = () => events.filter((e): e is Extract<UiEvent, { t: 'message' }> => e.t === 'message').map((e) => e.m)
  const of = <T extends ServerMessage['t']>(t: T) => msgs().filter((m) => m.t === t) as Extract<ServerMessage, { t: T }>[]
  return { s, calls, events, msgs, of, banner }
}
const until = async (pred: () => boolean) => { for (let i = 0; i < 200 && !pred(); i++) await new Promise((r) => setTimeout(r, 10)); return pred() }

async function lab(opts: { guestSupported?: boolean } = {}) {
  const prof = make(true)   // creator and controller
  const luis = make(opts.guestSupported ?? true) // student whose PC gets controlled
  const { code, port } = await prof.s.host('Clase', 'Prof', 0, '127.0.0.1')
  await luis.s.join('127.0.0.1', port, code, 'Luis')
  await until(() => luis.of('welcome').length === 1)
  return { prof, luis, code, port }
}
async function grant(prof: ReturnType<typeof make>, luis: ReturnType<typeof make>) {
  prof.s.send({ t: 'control-request', target: luis.s.id })
  await until(() => luis.of('control-asked').length === 1)
  luis.s.send({ t: 'control-respond', controller: prof.s.id, accept: true })
  await until(() => luis.of('control-started').length === 1 && prof.of('control-started').length === 1)
}

describe('meeting end to end between two sessions', () => {
  it('hosts, joins, and both see the roster', async () => {
    const { prof, luis } = await lab()
    await until(() => prof.of('state').some((m) => m.state.participants.length === 2))
    expect(luis.of('welcome')[0].state.participants.map((p) => p.role).sort()).toEqual(['creator', 'participant'])
  })

  it('refuses a second meeting in the same session, and a wrong code', async () => {
    const a = make()
    const { code, port } = await a.s.host('A', 'A', 0, '127.0.0.1')
    await expect(a.s.host('B', 'A', 0, '127.0.0.1')).rejects.toThrow('Ya estás')
    const b = make()
    await expect(b.s.join('127.0.0.1', port, 'AAAAAAAA', 'B')).rejects.toThrow('Código incorrecto')
    expect(code).toHaveLength(8)
  })

  it('a failed join leaves no trace: no "closed" event, and the user can try again', async () => {
    const a = make()
    const { code, port } = await a.s.host('A', 'A', 0, '127.0.0.1')
    const b = make()
    await expect(b.s.join('127.0.0.1', port, 'AAAAAAAA', 'B')).rejects.toThrow('Código incorrecto')
    await new Promise((r) => setTimeout(r, 100))
    expect(b.events.filter((e) => e.t === 'closed')).toEqual([]) // the UI must keep showing the error
    expect(b.s.active).toBe(false)
    await b.s.join('127.0.0.1', port, code, 'B') // the retry works
    await until(() => b.of('welcome').length === 1)
  })

  it('reports a busy port in plain language', async () => {
    const a = make(), b = make()
    const { port } = await a.s.host('A', 'A', 0, '127.0.0.1')
    await expect(b.s.host('B', 'B', port, '127.0.0.1')).rejects.toThrow(/ya está en uso/)
  })
})

describe('PC control lifecycle', () => {
  it('injects input only after consent, from the controller only', async () => {
    const { prof, luis } = await lab()
    prof.s.send({ t: 'control-input', target: luis.s.id, input: { t: 'mouse-move', x: 0.3, y: 0.4 } })
    await new Promise((r) => setTimeout(r, 50))
    expect(luis.calls).toEqual([]) // no consent yet
    await grant(prof, luis)
    prof.s.send({ t: 'control-input', target: luis.s.id, input: { t: 'mouse-move', x: 0.3, y: 0.4 } })
    await until(() => luis.calls.length > 0)
    expect(luis.calls).toEqual(['move 0.3,0.4'])
    expect(luis.s.controlledBy).toBe(prof.s.id)
  })

  it('the controlled user revokes: input stops and held keys are released', async () => {
    const { prof, luis } = await lab(); await grant(prof, luis)
    prof.s.send({ t: 'control-input', target: luis.s.id, input: { t: 'key', code: 'ControlLeft', down: true } })
    prof.s.send({ t: 'control-input', target: luis.s.id, input: { t: 'mouse-button', button: 'left', down: true } })
    await until(() => luis.calls.length === 2)
    luis.s.send({ t: 'control-revoke', other: prof.s.id })
    await until(() => luis.s.controlledBy === null)
    expect(luis.calls).toContain('key 162 up')
    expect(luis.calls).toContain('btn left up')
    luis.calls.length = 0
    prof.s.send({ t: 'control-input', target: luis.s.id, input: { t: 'mouse-move', x: 0.9, y: 0.9 } })
    await new Promise((r) => setTimeout(r, 50))
    expect(luis.calls).toEqual([])
  })

  it('releases held keys when the cable is pulled (connection dropped without goodbye)', async () => {
    const { prof, luis } = await lab(); await grant(prof, luis)
    prof.s.send({ t: 'control-input', target: luis.s.id, input: { t: 'key', code: 'ShiftLeft', down: true } })
    await until(() => luis.calls.length === 1)
    ;(luis.s as any).client.ws.terminate()
    await until(() => luis.events.some((e) => e.t === 'closed'))
    expect(luis.calls).toContain('key 160 up')
    expect(luis.s.controlledBy).toBeNull()
  })

  it('releases held keys when the host ends the meeting', async () => {
    const { prof, luis } = await lab(); await grant(prof, luis)
    prof.s.send({ t: 'control-input', target: luis.s.id, input: { t: 'key', code: 'AltLeft', down: true } })
    await until(() => luis.calls.length === 1)
    prof.s.leave()
    await until(() => luis.events.some((e) => e.t === 'closed'))
    expect(luis.calls).toContain('key 164 up')
  })

  it('releases when the controller disconnects', async () => {
    const { prof, luis } = await lab()
    // Reverse roles: the guest becomes the one holding keys on the host's PC.
    prof.s.send({ t: 'set-role', target: luis.s.id, role: 'teacher' })
    await until(() => luis.of('notice').length === 1)
    luis.s.send({ t: 'control-request', target: prof.s.id })
    await until(() => prof.of('control-asked').length === 1)
    prof.s.send({ t: 'control-respond', controller: luis.s.id, accept: true })
    await until(() => prof.of('control-started').length === 1)
    luis.s.send({ t: 'control-input', target: prof.s.id, input: { t: 'key', code: 'KeyZ', down: true } })
    await until(() => prof.calls.length === 1)
    ;(luis.s as any).client.ws.terminate()
    await until(() => prof.calls.includes('key 90 up'))
    expect(prof.s.controlledBy).toBeNull()
  })

  it('shows the persistent indicator while controlled and clears it however control ends', async () => {
    let { prof, luis } = await lab(); await grant(prof, luis)
    expect(luis.banner).toEqual([{ id: prof.s.id, name: 'Prof' }])
    luis.s.send({ t: 'control-revoke', other: prof.s.id })
    await until(() => luis.banner.length === 2)
    expect(luis.banner[1]).toBeNull()

    ;({ prof, luis } = await (async () => { sessions.splice(0).forEach((s) => s.dispose()); return lab() })())
    await grant(prof, luis)
    ;(luis.s as any).client.ws.terminate()
    await until(() => luis.banner.length === 2)
    expect(luis.banner[1]).toBeNull()
  })

  it('a PC that cannot inject input never accepts control', async () => {
    const { prof, luis } = await lab({ guestSupported: false })
    prof.s.send({ t: 'control-request', target: luis.s.id })
    await until(() => luis.of('control-asked').length === 1)
    luis.s.send({ t: 'control-respond', controller: prof.s.id, accept: true })
    await until(() => prof.of('control-ended').length === 1)
    expect(prof.of('control-ended')[0].reason).toBe('Rechazado')
    expect(luis.of('notice').some((n) => n.text.includes('no admite control'))).toBe(true)
    expect(prof.of('control-started')).toHaveLength(0)
  })
})
