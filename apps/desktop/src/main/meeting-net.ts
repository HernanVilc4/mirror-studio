import { EventEmitter } from 'node:events'
import WebSocket, { WebSocketServer } from 'ws'
import {
  FILE_TAG, MAX_MESSAGE_BYTES, MEDIA_STREAM, MEDIA_TAG, MediaAssembler, PC_CAPS, PROTOCOL_VERSION, parseClient, parseFileChunk, parseHandshake, parseServer, splitMedia,
  type Cap, type ClientMessage, type Device, type FileChunk, type ServerMessage
} from '@mirror-studio/protocol'
import { ClientHandshake, HostHandshake, generateSalt, PBKDF2_ITERATIONS, type SecureChannel } from '@mirror-studio/protocol/src/node'
import type { MeetingHost } from './meeting'

export const HANDSHAKE_TIMEOUT_MS = 10_000
/** Failed code attempts per address before it is blocked, and for how long. */
export const MAX_FAILURES = 5
export const LOCKOUT_MS = 60_000
/** Handshakes in flight at once. Each costs the host CPU, so cap them. */
export const MAX_PENDING_HANDSHAKES = 16

const send = (ws: WebSocket, o: object) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(o))

/**
 * Bytes waiting in a socket above which a relayed video frame is dropped instead of queued. Low latency beats
 * completeness: a frame that waits behind others is already old, and the next key frame repairs the picture.
 */
export const MEDIA_BACKLOG = 1_500_000
/**
 * Sends one encoded frame as sealed pieces. False (nothing sent) when the socket is backed up. After a drop, the
 * delta frames that follow are dropped too until a key frame (byte 1, bit 0 of the window's frame header, see
 * media-relay.ts): a delta whose reference never arrived would only paint garbage.
 */
export function sendMediaOver(ws: WebSocket, ch: SecureChannel, stream: number, seq: number, frame: Uint8Array, waitKey: Set<number>): boolean {
  const key = frame.length > 1 && (frame[1] & 1) === 1
  if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > MEDIA_BACKLOG) { waitKey.add(stream); return false }
  if (waitKey.has(stream) && !key) return false
  waitKey.delete(stream)
  for (const piece of splitMedia(stream, seq, frame)) ws.send(ch.sealBytes(piece))
  return true
}

/** The host answers this (close code 4429) when too many handshakes run at once; the client retries by itself. */
export const BUSY = 'El anfitrión está ocupado, intenta de nuevo'
/** Tries in total when the host is busy (a whole class pressing "Unirse" at the same moment). */
export const BUSY_RETRIES = 12
export const LOCKED = 'La sala está bloqueada'
export const VERSION_MISMATCH ='Esta PC y el anfitrión tienen versiones distintas de Mirror Studio. Actualicen todas las PCs a la misma versión.'
/** A hello from another protocol version: it would fail validation with a cryptic error, so it gets a clear one. */
function otherVersion(text: string): boolean {
  try { const m = JSON.parse(text) as { t?: unknown; v?: unknown }; return m?.t === 'hello' && m.v !== PROTOCOL_VERSION } catch { return false }
}

/**
 * Secure endpoint of a meeting. Anyone on the LAN may open a socket and ask `info` (name and head count,
 * like the discovery list). Joining needs the session code, proven with an authenticated key exchange:
 * see packages/protocol/src/node.ts. After that every frame is AES-GCM and goes to MeetingHost.
 */
export class MeetingServer {
  private wss?: WebSocketServer
  private failures = new Map<string, { count: number; until: number }>()
  private pending = 0
  private salt = generateSalt()

  constructor(
    private meeting: MeetingHost, private code: string, private hostName: string,
    private iterations = PBKDF2_ITERATIONS, private now: () => number = Date.now
  ) {}

  start(port: number, host = '0.0.0.0'): Promise<number> {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ port, host, maxPayload: MAX_MESSAGE_BYTES })
      this.wss.once('error', reject)
      this.wss.once('listening', () => resolve((this.wss!.address() as { port: number }).port))
      this.wss.on('connection', (ws, req) => this.onConnection(ws, req.socket.remoteAddress ?? '?'))
    })
  }
  stop() { this.wss?.clients.forEach((c) => c.terminate()); this.wss?.close() }

  private blocked(ip: string) {
    const f = this.failures.get(ip)
    if (!f) return false
    if (f.until && f.until > this.now()) return true
    if (f.until) this.failures.delete(ip) // lockout over
    return false
  }
  private fail(ip: string) {
    const f = this.failures.get(ip) ?? { count: 0, until: 0 }
    f.count++
    if (f.count >= MAX_FAILURES) { f.until = this.now() + LOCKOUT_MS; f.count = 0 }
    this.failures.set(ip, f)
  }

  private onConnection(ws: WebSocket, ip: string) {
    let stage: 'init' | 'confirm' | 'open' = 'init'
    let hs: HostHandshake | undefined
    let channel: SecureChannel | undefined
    let id: string | null = null
    let counted = false
    const media = new MediaAssembler()
    let mediaSeq = 0
    const mediaWait = new Set<number>()
    const release = () => { if (counted) { counted = false; this.pending-- } }
    const reject = (reason: string, code = 4403) => { send(ws, { t: 'reject', reason }); ws.close(code) }
    const timer = setTimeout(() => stage !== 'open' && ws.close(4000, 'handshake timeout'), HANDSHAKE_TIMEOUT_MS)

    ws.on('message', (data, isBinary) => {
      if (stage === 'open') {
        const plain = isBinary ? channel!.openBytes(data as Buffer) : null
        if (plain && plain[0] === MEDIA_TAG) {
          let f: ReturnType<MediaAssembler['push']>
          try { f = media.push(plain) } catch { ws.close(4400, 'bad media'); return }
          if (f) this.meeting.media(id!, f.stream, f.frame)
          return
        }
        if (plain && plain[0] === FILE_TAG) {
          if (!this.meeting.fileChunk(id!, plain)) ws.close(4400, 'bad file chunk')
          return
        }
        const m = plain === null ? null : parseClient(plain)
        if (!m || !m.ok) { ws.close(4400, 'bad frame'); return }
        this.meeting.handle(id!, m.value as ClientMessage)
        return
      }
      if (isBinary) { ws.close(4400, 'binary before handshake'); return }
      if (stage === 'init' && otherVersion(data.toString())) return reject(VERSION_MISMATCH, 4426)
      const p = parseHandshake(data.toString())
      if (!p.ok) { ws.close(4400, p.error); return }
      const m = p.value

      if (m.t === 'info' && stage === 'init') {
        send(ws, { t: 'info-reply', v: PROTOCOL_VERSION, name: this.meeting.name, host: this.hostName, participants: this.meeting.size })
        ws.close(); return
      }
      if (m.t === 'hello' && stage === 'init') {
        if (this.blocked(ip)) return reject('Demasiados intentos. Espera un minuto.')
        if (this.meeting.isClosed) return reject('La reunión terminó')
        if (this.meeting.locked) return reject(LOCKED)
        if (this.pending >= MAX_PENDING_HANDSHAKES) return reject(BUSY, 4429)
        this.pending++; counted = true
        hs = new HostHandshake(this.code, this.salt, this.iterations)
        const reply = hs.onHello(m)
        if (!reply) return reject('Clave inválida', 4400)
        stage = 'confirm'; send(ws, reply); return
      }
      if (m.t === 'confirm' && stage === 'confirm' && hs) {
        const ok = hs.onConfirm(m)
        release()
        if (!ok) { this.fail(ip); return reject('Código incorrecto') }
        const ch = (channel = ok.channel)
        send(ws, ok.ok)
        const hello = hs.clientHello!
        id = this.meeting.join(hs.clientName, {
          send: (msg) => ws.readyState === WebSocket.OPEN && ws.send(ch.seal(JSON.stringify(msg))),
          close: () => ws.close(1000),
          sendMedia: (stream, frame) => sendMediaOver(ws, ch, stream, mediaSeq++, frame, mediaWait),
          sendFile: (chunk) => ws.readyState === WebSocket.OPEN && ws.send(ch.sealBytes(chunk)),
          backlog: () => ws.bufferedAmount
        }, { device: hello.device, caps: hello.caps })
        if (!id) {
          const reason = this.meeting.locked ? LOCKED : 'La reunión está llena'
          ws.send(ch.seal(JSON.stringify({ t: 'closed', reason }))); ws.close(1000); return
        }
        stage = 'open'; return
      }
      ws.close(4401, 'unexpected message')
    })
    ws.on('close', () => { clearTimeout(timer); release(); if (id) this.meeting.leave(id, 'Se desconectó') })
    ws.on('error', () => ws.terminate())
  }
}

/** Asks a host for its public info (discovery list). Null when nothing answers or the reply is invalid. */
export function probeInfo(host: string, port: number, timeoutMs = 1500): Promise<{ name: string; host: string; participants: number } | null> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://${host}:${port}`, { handshakeTimeout: timeoutMs })
    const done = (v: { name: string; host: string; participants: number } | null) => { clearTimeout(t); ws.terminate(); resolve(v) }
    const t = setTimeout(() => done(null), timeoutMs)
    ws.once('open', () => ws.send(JSON.stringify({ t: 'info' })))
    ws.once('message', (d) => { const p = parseHandshake(d.toString()); done(p.ok && p.value.t === 'info-reply' ? p.value : null) })
    ws.once('error', () => done(null))
  })
}

/** Events: 'message'(ServerMessage), 'media'(stream, frame), 'file'(FileChunk), 'closed'(reason). */
export class MeetingClient extends EventEmitter {
  private ws?: WebSocket
  private channel?: SecureChannel
  private closedOnce = false
  private media = new MediaAssembler()
  private mediaSeq = 0
  private mediaWait = new Set<number>()

  /** What this endpoint declares in its hello. */
  constructor(private device: Device = 'pc', private caps: Cap[] = PC_CAPS) { super() }

  /**
   * Resolves once the host has proven it knows the code too. Rejects with a user-facing message.
   * "Host busy" is not shown: with 35 PCs joining at once the host only takes 16 handshakes at a time, so the
   * others wait a random moment (growing with each try) and try again.
   */
  async connect(host: string, port: number, code: string, name: string, iterations = PBKDF2_ITERATIONS): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try { return await this.connectOnce(host, port, code, name, iterations) } catch (e) {
        if ((e as Error).message !== BUSY || attempt >= BUSY_RETRIES) throw e
        await new Promise((r) => setTimeout(r, 150 + Math.random() * 250 * Math.min(attempt, 6)))
      }
    }
  }

  private connectOnce(host: string, port: number, code: string, name: string, iterations: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = (this.ws = new WebSocket(`ws://${host}:${port}`, { maxPayload: MAX_MESSAGE_BYTES, handshakeTimeout: HANDSHAKE_TIMEOUT_MS }))
      const hs = new ClientHandshake(code, name, iterations, this.device, this.caps)
      let ready = false
      const fail = (msg: string) => { if (!ready) { ready = true; reject(new Error(msg)) } ws.terminate() }
      const timer = setTimeout(() => fail('El anfitrión no respondió'), HANDSHAKE_TIMEOUT_MS)

      ws.once('open', () => ws.send(JSON.stringify(hs.hello())))
      ws.on('error', () => fail(`No se pudo conectar con ${host}:${port}. ¿Está abierta la reunión y permite el firewall el puerto ${port}?`))
      ws.on('message', (data, isBinary) => {
        if (this.channel) {
          const plain = isBinary ? this.channel.openBytes(data as Buffer) : null
          if (plain && plain[0] === MEDIA_TAG) {
            let f: ReturnType<MediaAssembler['push']>
            try { f = this.media.push(plain) } catch { this.finish('Mensaje inválido del anfitrión'); ws.terminate(); return }
            // The host only sends what this PC watches: the presentation and the screen of the PC it controls.
            if (f && (f.stream === MEDIA_STREAM.presentation || f.stream === MEDIA_STREAM.control)) this.emit('media', f.stream, f.frame)
            return
          }
          if (plain && plain[0] === FILE_TAG) {
            const c: FileChunk | null = parseFileChunk(plain)
            if (!c) { this.finish('Mensaje inválido del anfitrión'); ws.terminate(); return }
            this.emit('file', c)
            return
          }
          const m = plain === null ? null : parseServer(plain)
          if (!m || !m.ok) { this.finish('Mensaje inválido del anfitrión'); ws.terminate(); return }
          this.emit('message', m.value as ServerMessage)
          return
        }
        const p = parseHandshake(data.toString())
        if (!p.ok) return fail('Respuesta inválida del anfitrión')
        const m = p.value
        if (m.t === 'reject') return fail(m.reason)
        if (m.t === 'hello-reply') {
          const c = hs.onReply(m)
          if (!c) return fail('Respuesta inválida del anfitrión')
          ws.send(JSON.stringify(c)); return
        }
        if (m.t === 'confirm-ok') {
          const ch = hs.verifyOk(m)
          // The host could not prove the code: a stranger on the network, not the meeting we meant.
          if (!ch) return fail('El anfitrión no pudo demostrar que conoce el código. No te conectes.')
          this.channel = ch; ready = true; clearTimeout(timer); resolve(); return
        }
        fail('Mensaje inesperado')
      })
      ws.on('close', (code) => {
        clearTimeout(timer)
        // An older host cannot parse our hello and just closes with 4400: almost always a version mismatch.
        if (!ready) { ready = true; reject(new Error(code === 4400 ? VERSION_MISMATCH : 'Conexión cerrada antes de entrar')) }
        // Only a socket that got in ends the meeting; a failed (or retried) attempt is reported by the rejection.
        if (this.ws === ws && this.channel) this.finish('Conexión cerrada')
      })
    })
  }

  send(msg: ClientMessage): boolean {
    if (!this.channel || this.ws?.readyState !== WebSocket.OPEN) return false
    this.ws.send(this.channel.seal(JSON.stringify(msg)))
    return true
  }
  /** TCP video relay: this PC's screen to the host. False when dropped (not connected, or the link is backed up). */
  sendMedia(stream: number, frame: Uint8Array): boolean {
    if (!this.channel || !this.ws) return false
    return sendMediaOver(this.ws, this.channel, stream, this.mediaSeq++, frame, this.mediaWait)
  }
  /** One FILE_TAG chunk of an upload (see encodeFileChunk). Callers pace themselves with `backlog`. */
  sendFileChunk(chunk: Uint8Array): boolean {
    if (!this.channel || this.ws?.readyState !== WebSocket.OPEN) return false
    this.ws.send(this.channel.sealBytes(chunk))
    return true
  }
  /** Bytes waiting in the socket. */
  get backlog() { return this.ws?.bufferedAmount ?? 0 }
  close() { try { this.send({ t: 'leave' }) } catch { /* already closed */ } this.ws?.close(); this.finish('Saliste de la reunión') }
  private finish(reason: string) { if (!this.closedOnce) { this.closedOnce = true; this.emit('closed', reason) } }
}
