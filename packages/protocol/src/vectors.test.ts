import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createCipheriv, createHash, createHmac, hkdfSync, pbkdf2Sync } from 'node:crypto'
import { encodeFileChunk, parseClient, parseFileChunk, parseHandshake, parseServer, splitMedia } from './index'
import { ClientHandshake, HostHandshake, x25519, x25519Public } from './node'
import { buildVectors, type MessageVectors } from './vectors'

const dir = join(__dirname, '..', 'vectors')
const load = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'))
const parsers = { client: parseClient, server: parseServer, handshake: parseHandshake }
const unhex = (h: string) => new Uint8Array(Buffer.from(h, 'hex'))

describe('test vectors', () => {
  const built = buildVectors()

  it('the files on disk are what the generator writes (run npm run vectors)', () => {
    const onDisk = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    expect(onDisk).toEqual(Object.keys(built).sort())
    for (const [f, v] of Object.entries(built)) expect(load(f), f).toEqual(JSON.parse(JSON.stringify(v)))
  })

  for (const f of Object.keys(built).filter((x) => x !== 'handshake.json')) {
    it(`${f}: valid cases parse (with defaults), invalid ones do not`, () => {
      const v = load(f) as MessageVectors
      for (const c of v.valid) {
        const r = parsers[c.dir](JSON.stringify(c.message))
        expect(r.ok, `${f} / ${c.name}`).toBe(true)
        if (r.ok) expect(r.value, `${f} / ${c.name}`).toEqual(c.parsed ?? c.message)
      }
      for (const c of v.invalid) expect(parsers[c.dir](JSON.stringify(c.message)).ok, `${f} / ${c.name}`).toBe(false)
    })
  }

  it('file chunk frames encode and parse exactly', () => {
    const { frames } = load('files.json') as { frames: { valid: any[]; invalid: any[] } }
    for (const c of frames.valid) {
      expect(Buffer.from(encodeFileChunk(c.fileId, c.index, c.count, unhex(c.payloadHex))).toString('hex'), c.name).toBe(c.frameHex)
      const p = parseFileChunk(unhex(c.frameHex))!
      expect({ fileId: p.fileId, index: p.index, count: p.count, payloadHex: Buffer.from(p.payload).toString('hex') }, c.name)
        .toEqual({ fileId: c.fileId, index: c.index, count: c.count, payloadHex: c.payloadHex })
    }
    for (const c of frames.invalid) expect(parseFileChunk(unhex(c.frameHex)), c.name).toBeNull()
  })

  it('media pieces match', () => {
    const { frames } = load('media.json') as { frames: { valid: any[] } }
    for (const c of frames.valid) expect(splitMedia(c.stream, c.seq, unhex(c.frameHex)).map((p) => Buffer.from(p).toString('hex'))).toEqual(c.pieces)
  })

  it('handshake: every intermediate value, recomputed from the raw primitives', () => {
    const v = load('handshake.json')
    const { inputs: i, derived: d, messages: m } = v
    const salt = Buffer.from(i.saltB64, 'base64')
    const cpriv = Buffer.from(i.clientPrivateKey, 'hex'), hpriv = Buffer.from(i.hostPrivateKey, 'hex')
    expect(x25519Public(cpriv).toString('hex')).toBe(d.clientPublicKey)
    expect(x25519Public(hpriv).toString('hex')).toBe(d.hostPublicKey)
    expect(Buffer.from(m.hello.pub, 'base64').toString('hex')).toBe(d.clientPublicKey)
    expect(Buffer.from(m.helloReply.pub, 'base64').toString('hex')).toBe(d.hostPublicKey)
    expect(m.hello).toMatchObject({ t: 'hello', v: v.protocolVersion, nonce: i.clientNonceB64, name: i.name, device: i.device, caps: i.caps })
    expect(m.helloReply).toMatchObject({ t: 'hello-reply', nonce: i.hostNonceB64, salt: i.saltB64 })
    expect(parseHandshake(JSON.stringify(m.hello)).ok).toBe(true)
    expect(parseHandshake(JSON.stringify(m.helloReply)).ok).toBe(true)

    const codeKey = pbkdf2Sync(i.codeNormalized, salt, i.iterations, 32, 'sha256')
    expect(codeKey.toString('hex')).toBe(d.codeKey)
    const dh = x25519(cpriv, Buffer.from(d.hostPublicKey, 'hex'))!
    expect(dh.toString('hex')).toBe(d.dh)
    expect(x25519(hpriv, Buffer.from(d.clientPublicKey, 'hex'))!.toString('hex')).toBe(d.dh)
    expect(d.transcriptInput).toBe(JSON.stringify([m.hello.pub, m.helloReply.pub, i.clientNonceB64, i.hostNonceB64, i.saltB64, i.name]))
    const transcript = createHash('sha256').update('MS2').update(d.transcriptInput).digest()
    expect(transcript.toString('hex')).toBe(d.transcript)
    const okm = Buffer.from(hkdfSync('sha256', Buffer.concat([dh, codeKey]), transcript, 'ms2-keys', 96))
    expect([okm.subarray(0, 32), okm.subarray(32, 64), okm.subarray(64)].map((b) => b.toString('hex'))).toEqual([d.c2hKey, d.h2cKey, d.confirmKey])
    const mac = (who: string) => createHmac('sha256', okm.subarray(64)).update(who).update(transcript).digest('hex')
    expect(mac('client')).toBe(d.clientMac)
    expect(mac('host')).toBe(d.hostMac)
    expect(m.confirm).toEqual({ t: 'confirm', mac: d.clientMac })
    expect(m.confirmOk).toEqual({ t: 'confirm-ok', mac: d.hostMac })

    for (const s of v.sealed) {
      const nonce = Buffer.from(s.nonceHex, 'hex')
      const c = createCipheriv('aes-256-gcm', Buffer.from(s.keyHex, 'hex'), nonce)
      const ct = Buffer.concat([c.update(s.plaintext, 'utf8'), c.final()])
      const head = Buffer.alloc(8); head.writeBigUInt64BE(BigInt(s.counter))
      expect(Buffer.concat([head, ct, c.getAuthTag()]).toString('hex')).toBe(s.frameHex)
      expect(s.keyHex).toBe(s.direction === 'client->host' ? d.c2hKey : d.h2cKey)
    }
  })

  it('handshake: the real classes with the fixed keys reproduce the messages and open the sealed frames', () => {
    const { inputs: i, messages: m, sealed } = load('handshake.json')
    const client = new ClientHandshake(i.code, i.name, i.iterations, i.device, i.caps, { privateKey: Buffer.from(i.clientPrivateKey, 'hex'), nonce: i.clientNonceB64 })
    const host = new HostHandshake(i.code, i.saltB64, i.iterations, { privateKey: Buffer.from(i.hostPrivateKey, 'hex'), nonce: i.hostNonceB64 })
    expect(client.hello()).toEqual(m.hello)
    expect(host.onHello(m.hello)).toEqual(m.helloReply)
    expect(client.onReply(m.helloReply)).toEqual(m.confirm)
    const done = host.onConfirm(m.confirm)!
    expect(done.ok).toEqual(m.confirmOk)
    const ch = client.verifyOk(m.confirmOk)!
    expect(done.channel.open(Buffer.from(sealed[0].frameHex, 'hex'))).toBe(sealed[0].plaintext)
    expect(ch.open(Buffer.from(sealed[1].frameHex, 'hex'))).toBe(sealed[1].plaintext)
  })
})
