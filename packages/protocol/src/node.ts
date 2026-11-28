// Node-only crypto (main process / tests). Never import this from the renderer.
//
// Authenticated key exchange for ws:// signaling, built only from node:crypto primitives:
//   1. Both sides send an ephemeral X25519 key + nonce. The session `salt` comes from the host.
//   2. codeKey = PBKDF2-SHA256(code, salt, N). The code (40 bits) NEVER travels on the wire.
//   3. keys = HKDF(dh || codeKey, transcript). A passive observer lacks `dh`, so it cannot even test
//      guesses of the code offline. Every later frame is AES-256-GCM with a strictly increasing counter.
//   4. Both sides prove knowledge of codeKey with an HMAC over the full transcript (incl. the name).
//
// Known limit (no PAKE library available): an ACTIVE man-in-the-middle that completes its own DH with a
// client can test code guesses offline, each guess costing one PBKDF2 run. 40 bits x 200k iterations makes
// that impractical, but it is weaker than a real PAKE (SPAKE2/OPAQUE); replace if the threat model grows.
import {
  createCipheriv, createDecipheriv, createHash, createHmac, createPrivateKey, createPublicKey,
  diffieHellman, generateKeyPairSync, hkdfSync, pbkdf2Sync, randomBytes, timingSafeEqual, type KeyObject
} from 'node:crypto'
import {
  CODE_ALPHABET, CODE_LENGTH, PC_CAPS, PROTOCOL_VERSION, normalizeCode,
  type Cap, type Device, type Hello, type HelloReply, type Confirm, type ConfirmOk
} from './index'

export const PBKDF2_ITERATIONS = 200_000
const SPKI_X25519_PREFIX = Buffer.from('302a300506032b656e032100', 'hex')
const PKCS8_X25519_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex')
const b64 = (b: Buffer) => b.toString('base64')
const unb64 = (s: string) => Buffer.from(s, 'base64')

export function generateCode(): string {
  // 32 symbols: `byte & 31` is uniform.
  return [...randomBytes(CODE_LENGTH)].map((x) => CODE_ALPHABET[x & 31]).join('')
}
export const generateSalt = () => b64(randomBytes(16))
/** Pairing token: 16 random bytes, base64url without padding. */
export const generatePairToken = () => randomBytes(16).toString('base64url')

/** Fixed key material, only for test vectors: a raw 32-byte X25519 private key and the base64 nonce. */
export interface FixedKeys { privateKey: Buffer; nonce: string }

function newKeyPair(fixed?: Buffer) {
  let privateKey: KeyObject, publicKey: KeyObject
  if (fixed) {
    privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_X25519_PREFIX, fixed]), format: 'der', type: 'pkcs8' })
    publicKey = createPublicKey(privateKey)
  } else ({ publicKey, privateKey } = generateKeyPairSync('x25519'))
  const raw = (publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(-32)
  return { privateKey, rawPublic: Buffer.from(raw) }
}
/** Raw X25519 public key for a raw private key (test vectors). */
export const x25519Public = (priv: Buffer) => newKeyPair(priv).rawPublic
function importPublic(raw: Buffer): KeyObject | null {
  if (raw.length !== 32) return null
  try { return createPublicKey({ key: Buffer.concat([SPKI_X25519_PREFIX, raw]), format: 'der', type: 'spki' }) } catch { return null }
}
// The host derives the same key for every joiner (one salt per session). Memoizing keeps a flood of
// hellos from forcing one PBKDF2 run each. Small, so secrets do not pile up in memory.
const keyCache = new Map<string, Buffer>()
export function deriveCodeKey(code: string, salt: string, iterations = PBKDF2_ITERATIONS): Buffer {
  const k = `${normalizeCode(code)}|${salt}|${iterations}`
  const hit = keyCache.get(k); if (hit) return hit
  const key = pbkdf2Sync(normalizeCode(code), unb64(salt), iterations, 32, 'sha256')
  if (keyCache.size >= 8) keyCache.delete(keyCache.keys().next().value!)
  keyCache.set(k, key)
  return key
}

interface Material { send: Buffer; recv: Buffer; confirm: Buffer; transcript: Buffer }
export interface TranscriptParts { cpub: string; hpub: string; cnonce: string; hnonce: string; name: string }

/** SHA-256("MS2" || JSON.stringify([cpub, hpub, cnonce, hnonce, salt, name])). The hello's device/caps are not bound. */
export const transcriptHash = (p: TranscriptParts, salt: string) =>
  createHash('sha256').update('MS2').update(JSON.stringify([p.cpub, p.hpub, p.cnonce, p.hnonce, salt, p.name])).digest()
/** HKDF-SHA256(ikm = dh || codeKey, salt = transcript, info = "ms2-keys", 96): client->host, host->client, confirm. */
export function deriveKeys(dh: Buffer, codeKey: Buffer, transcript: Buffer) {
  const okm = Buffer.from(hkdfSync('sha256', Buffer.concat([dh, codeKey]), transcript, 'ms2-keys', 96))
  return { c2h: okm.subarray(0, 32), h2c: okm.subarray(32, 64), confirm: okm.subarray(64, 96) }
}
/** HMAC-SHA256(confirm, who || transcript), hex. */
export const confirmMac = (confirm: Buffer, who: 'client' | 'host', transcript: Buffer) =>
  createHmac('sha256', confirm).update(who).update(transcript).digest('hex')
/** Raw X25519 shared secret; null for an invalid public key. */
export function x25519(priv: Buffer, peerPub: Buffer): Buffer | null {
  const peer = importPublic(peerPub); if (!peer) return null
  try { return diffieHellman({ privateKey: newKeyPair(priv).privateKey, publicKey: peer }) } catch { return null }
}

function derive(
  role: 'client' | 'host', priv: KeyObject, peerPub: Buffer, code: string, salt: string, iterations: number, parts: TranscriptParts
): Material | null {
  const peer = importPublic(peerPub); if (!peer) return null
  let dh: Buffer
  try { dh = diffieHellman({ privateKey: priv, publicKey: peer }) } catch { return null }
  const transcript = transcriptHash(parts, salt)
  const k = deriveKeys(dh, deriveCodeKey(code, salt, iterations), transcript)
  return { send: role === 'client' ? k.c2h : k.h2c, recv: role === 'client' ? k.h2c : k.c2h, confirm: k.confirm, transcript }
}
const mac = (m: Material, who: 'client' | 'host') => confirmMac(m.confirm, who, m.transcript)
const eq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y) }

export class ClientHandshake {
  private kp: ReturnType<typeof newKeyPair>; private nonce: string; private m?: Material
  constructor(
    private code: string, private name: string, private iterations = PBKDF2_ITERATIONS,
    private device: Device = 'pc', private caps: Cap[] = PC_CAPS, fixed?: FixedKeys
  ) {
    this.kp = newKeyPair(fixed?.privateKey)
    this.nonce = fixed?.nonce ?? b64(randomBytes(16))
  }
  hello(): Hello {
    return { t: 'hello', v: PROTOCOL_VERSION, pub: b64(this.kp.rawPublic), nonce: this.nonce, name: this.name, device: this.device, caps: [...this.caps] }
  }
  /** Returns the confirmation to send, or null when the reply is malformed. */
  onReply(r: HelloReply): Confirm | null {
    const m = derive('client', this.kp.privateKey, unb64(r.pub), this.code, r.salt, this.iterations,
      { cpub: b64(this.kp.rawPublic), hpub: r.pub, cnonce: this.nonce, hnonce: r.nonce, name: this.name })
    if (!m) return null
    this.m = m
    return { t: 'confirm', mac: mac(m, 'client') }
  }
  /** Checks the host's proof. Only then is the channel usable. */
  verifyOk(ok: ConfirmOk): SecureChannel | null {
    return this.m && eq(ok.mac, mac(this.m, 'host')) ? new SecureChannel(this.m.send, this.m.recv) : null
  }
}

export class HostHandshake {
  private kp: ReturnType<typeof newKeyPair>; private m?: Material; private hello?: Hello
  constructor(private code: string, readonly salt: string, private iterations = PBKDF2_ITERATIONS, private fixed?: FixedKeys) {
    this.kp = newKeyPair(fixed?.privateKey)
  }
  get clientName() { return this.hello?.name ?? '' }
  /** The client's hello (device and caps), once received. */
  get clientHello() { return this.hello }
  onHello(h: Hello): HelloReply | null {
    const nonce = this.fixed?.nonce ?? b64(randomBytes(16))
    const m = derive('host', this.kp.privateKey, unb64(h.pub), this.code, this.salt, this.iterations,
      { cpub: h.pub, hpub: b64(this.kp.rawPublic), cnonce: h.nonce, hnonce: nonce, name: h.name })
    if (!m) return null
    this.m = m; this.hello = h
    return { t: 'hello-reply', pub: b64(this.kp.rawPublic), nonce, salt: this.salt }
  }
  /** Verifies the client's proof of the code. On success returns our proof and the channel. */
  onConfirm(c: Confirm): { ok: ConfirmOk; channel: SecureChannel } | null {
    if (!this.m || !eq(c.mac, mac(this.m, 'client'))) return null
    return { ok: { t: 'confirm-ok', mac: mac(this.m, 'host') }, channel: new SecureChannel(this.m.send, this.m.recv) }
  }
}

/** AES-256-GCM framing: [8-byte counter][ciphertext][16-byte tag]. Counters must arrive in exact order. */
export class SecureChannel {
  private out = 0n; private inn = 0n
  constructor(private sendKey: Buffer, private recvKey: Buffer) {}
  private static nonce(n: bigint) { const b = Buffer.alloc(12); b.writeBigUInt64BE(n, 4); return b }
  seal(plain: string): Buffer { return this.sealBytes(Buffer.from(plain, 'utf8')) }
  /** Same framing for binary payloads (media pieces of the TCP video relay). */
  sealBytes(plain: Uint8Array): Buffer {
    const n = this.out++
    const c = createCipheriv('aes-256-gcm', this.sendKey, SecureChannel.nonce(n))
    const ct = Buffer.concat([c.update(plain), c.final()])
    const head = Buffer.alloc(8); head.writeBigUInt64BE(n)
    return Buffer.concat([head, ct, c.getAuthTag()])
  }
  /** Null on tampering, replay, reordering or truncation. Callers must close the connection. */
  open(frame: Buffer): string | null { return this.openBytes(frame)?.toString('utf8') ?? null }
  openBytes(frame: Buffer): Buffer | null {
    if (frame.length < 8 + 16) return null
    const n = frame.readBigUInt64BE(0)
    if (n !== this.inn) return null
    try {
      const d = createDecipheriv('aes-256-gcm', this.recvKey, SecureChannel.nonce(n))
      d.setAuthTag(frame.subarray(frame.length - 16))
      const plain = Buffer.concat([d.update(frame.subarray(8, frame.length - 16)), d.final()])
      this.inn++
      return plain
    } catch { return null }
  }
}
