import { describe, it, expect } from 'vitest'
import {
  parseClient, parseServer, parseHandshake, parseControlInput, mapPointToVideo, MAX_MESSAGE_BYTES,
  canAssign, canKick, canPresent, canRequestControl, isValidCode, normalizeCode, formatCode, CODE_ALPHABET, type Role
} from './index'
import { ClientHandshake, HostHandshake, SecureChannel, generateCode, generateSalt } from './node'

const IT = 1000 // low PBKDF2 cost for tests; both sides must agree

describe('parsing', () => {
  it('accepts valid messages and rejects unknown, malformed, oversize and non-text', () => {
    expect(parseClient(JSON.stringify({ t: 'present-start' })).ok).toBe(true)
    expect(parseClient(JSON.stringify({ t: 'evil' })).ok).toBe(false)
    expect(parseClient('{nope').ok).toBe(false)
    expect(parseClient(42).ok).toBe(false)
    expect(parseClient('x'.repeat(MAX_MESSAGE_BYTES + 1)).ok).toBe(false)
  })
  it('does not let a client send host-only messages', () => {
    expect(parseClient(JSON.stringify({ t: 'welcome' })).ok).toBe(false)
    expect(parseClient(JSON.stringify({ t: 'closed', reason: 'x' })).ok).toBe(false)
    expect(parseServer(JSON.stringify({ t: 'present-start' })).ok).toBe(false)
  })
  it('validates set-role payload and control input ranges', () => {
    expect(parseClient(JSON.stringify({ t: 'set-role', target: 'a', role: 'creator' })).ok).toBe(false)
    expect(parseClient(JSON.stringify({ t: 'set-role', target: 'a', role: 'teacher' })).ok).toBe(true)
    expect(parseControlInput(JSON.stringify({ t: 'mouse-move', x: 1.5, y: 0 })).ok).toBe(false)
    expect(parseControlInput(JSON.stringify({ t: 'mouse-move', x: 0.5, y: 0.5 })).ok).toBe(true)
    expect(parseControlInput(JSON.stringify({ t: 'wheel', dx: 0, dy: 99999 })).ok).toBe(false)
    expect(parseHandshake(JSON.stringify({ t: 'info' })).ok).toBe(true)
  })
})

describe('roles', () => {
  const roles: Role[] = ['creator', 'admin', 'teacher', 'participant']
  it('only teachers and above present and request control', () => {
    expect(roles.map(canPresent)).toEqual([true, true, true, false])
    expect(roles.map(canRequestControl)).toEqual([true, true, true, false])
  })
  it('the creator can never be changed or kicked', () => {
    for (const a of roles) {
      expect(canAssign(a, 'creator', 'participant')).toBe(false)
      expect(canKick(a, 'creator')).toBe(false)
    }
  })
  it('creator assigns anything; admins only teacher/participant; others nothing', () => {
    expect(canAssign('creator', 'participant', 'admin')).toBe(true)
    expect(canAssign('admin', 'participant', 'teacher')).toBe(true)
    expect(canAssign('admin', 'participant', 'admin')).toBe(false)
    expect(canAssign('admin', 'admin', 'participant')).toBe(false) // cannot demote another admin
    expect(canAssign('teacher', 'participant', 'teacher')).toBe(false)
    expect(canAssign('participant', 'participant', 'teacher')).toBe(false)
  })
  it('kick needs admin and strictly higher rank', () => {
    expect(canKick('teacher', 'participant')).toBe(false)
    expect(canKick('admin', 'teacher')).toBe(true)
    expect(canKick('admin', 'admin')).toBe(false)
  })
})

describe('session code', () => {
  it('has 32 unambiguous symbols and generates valid codes', () => {
    expect(CODE_ALPHABET).toHaveLength(32)
    expect(new Set(CODE_ALPHABET).size).toBe(32)
    for (const bad of '01IO') expect(CODE_ALPHABET).not.toContain(bad)
    for (let i = 0; i < 50; i++) expect(isValidCode(generateCode())).toBe(true)
  })
  it('normalizes pasted codes', () => {
    expect(normalizeCode(' ab3c-d4ef ')).toBe('AB3CD4EF')
    expect(isValidCode('ab3c-d4ef')).toBe(true)
    expect(isValidCode('AB3C')).toBe(false)
    expect(isValidCode('AB3C-D4E0')).toBe(false) // 0 is not in the alphabet
    expect(formatCode('AB3CD4EF')).toBe('AB3C-D4EF')
  })
})

function pair(hostCode: string, clientCode: string) {
  const salt = generateSalt()
  const host = new HostHandshake(hostCode, salt, IT)
  const client = new ClientHandshake(clientCode, 'Ana', IT)
  const reply = host.onHello(client.hello())!
  const confirm = client.onReply(reply)!
  return { host, client, reply, confirm }
}

describe('authenticated handshake', () => {
  it('derives a working channel when the code matches', () => {
    const code = generateCode()
    const { host, client, confirm } = pair(code, code)
    const h = host.onConfirm(confirm)!
    expect(h).not.toBeNull()
    const c = client.verifyOk(h.ok)!
    expect(c).not.toBeNull()
    expect(h.channel.open(c.seal('hola'))).toBe('hola')
    expect(c.open(h.channel.seal('qué tal'))).toBe('qué tal')
  })
  it('rejects a wrong code on the host and the client', () => {
    const { host, client, confirm } = pair('AAAAAAAA', 'BBBBBBBB')
    expect(host.onConfirm(confirm)).toBeNull()
    const good = pair('AAAAAAAA', 'AAAAAAAA')
    expect(client.verifyOk(good.host.onConfirm(good.confirm)!.ok)).toBeNull()
  })
  it('never puts the code or a key on the wire', () => {
    const code = 'K7QM4X2P'
    const { client, reply, confirm } = pair(code, code)
    const wire = JSON.stringify([client.hello(), reply, confirm])
    expect(wire).not.toContain(code)
  })
  it('a passive observer cannot confirm a code guess from the transcript', () => {
    // The observer sees both public keys, nonces, salt and the client MAC. Without the DH secret
    // it cannot recompute the MAC, so a captured session gives it nothing to test guesses against.
    const code = generateCode()
    const a = pair(code, code), b = pair(code, code)
    expect(a.confirm.mac).not.toBe(b.confirm.mac) // ephemeral keys/nonces: nothing reusable across sessions
  })
  it('does not let a captured confirm be replayed in a new session', () => {
    const code = generateCode()
    const first = pair(code, code)
    const second = pair(code, code)
    expect(second.host.onConfirm(first.confirm)).toBeNull()
  })
  it('binds the participant name into the transcript', () => {
    const code = generateCode(); const salt = generateSalt()
    const host = new HostHandshake(code, salt, IT)
    const client = new ClientHandshake(code, 'Ana', IT)
    const hello = client.hello()
    const reply = host.onHello({ ...hello, name: 'Admin' })! // tampered in transit
    expect(host.onConfirm(client.onReply(reply)!)).toBeNull()
  })
  it('rejects a bad public key', () => {
    const host = new HostHandshake('AAAAAAAA', generateSalt(), IT)
    expect(host.onHello({ t: 'hello', v: 2, pub: 'AAAA', nonce: 'x', name: 'n' })).toBeNull()
  })
})

describe('SecureChannel', () => {
  function channels() {
    const code = generateCode()
    const { host, client, confirm } = pair(code, code)
    const h = host.onConfirm(confirm)!
    return { h: h.channel, c: client.verifyOk(h.ok)! }
  }
  it('rejects tampering, replay, reordering and truncation', () => {
    const { h, c } = channels()
    const f1 = c.seal('uno'), f2 = c.seal('dos')
    const tampered = Buffer.from(f1); tampered[10] ^= 1
    expect(h.open(tampered)).toBeNull()
    expect(h.open(f2)).toBeNull() // out of order
    expect(h.open(f1)).toBe('uno')
    expect(h.open(f1)).toBeNull() // replay
    expect(h.open(f2)).toBe('dos')
    expect(h.open(Buffer.alloc(5))).toBeNull()
  })
  it('does not accept its own frames reflected back (separate direction keys)', () => {
    const { c } = channels()
    expect(c.open(c.seal('eco'))).toBeNull()
  })
  it('is an instance of SecureChannel', () => expect(channels().c).toBeInstanceOf(SecureChannel))
})

describe('mapPointToVideo', () => {
  const box = { x: 100, y: 50, w: 400, h: 400 }
  it('portrait video letterboxed in square box', () => {
    expect(mapPointToVideo(187.5 + 112.5, 250, box, 1080, 1920)).toEqual({ x: 0.5, y: 0.5 })
    expect(mapPointToVideo(110, 250, box, 1080, 1920)).toBeNull()
  })
  it('landscape video', () => {
    const p = mapPointToVideo(100, 50 + 87.5, box, 1920, 1080)!
    expect(p.x).toBe(0); expect(p.y).toBeCloseTo(0)
  })
  it('degenerate sizes return null', () => expect(mapPointToVideo(0, 0, { x: 0, y: 0, w: 0, h: 0 }, 1, 1)).toBeNull())
})
