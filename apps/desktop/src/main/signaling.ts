import { EventEmitter } from 'node:events'
import { randomBytes, randomUUID } from 'node:crypto'
import { WebSocketServer, type WebSocket } from 'ws'
import { parseSignal, MAX_MESSAGE_BYTES, PROTOCOL_VERSION } from '@mirror-studio/protocol'
import { verifySdp, signSdp } from '@mirror-studio/protocol/src/node'

export interface PairingRequest { sessionId: string; deviceId: string; name: string; model: string }

interface Session { id: string; token: string; ws: WebSocket; approved: boolean }
interface Invite { token: string; expires: number }

/** HMAC key for QR-less sessions (Android uses the same constant). */
export const OPEN_KEY = 'open'
const INVITE_TTL_MS = 5 * 60_000

/**
 * Signaling endpoint for phones. Flow: invite(token in QR) -> hello -> user approval -> offer/ice relay.
 * Tokens are single-use: consumed by the first valid hello, so a leaked QR cannot be replayed.
 * Events: 'pairing-request'(PairingRequest), 'offer'(sessionId, sdp), 'ice'(sessionId, msg), 'closed'(sessionId)
 */
export class SignalingServer extends EventEmitter {
  private wss?: WebSocketServer
  private invites = new Map<string, Invite>()
  private sessions = new Map<string, Session>()
  /** Accept QR-less (discovery) pairing. Weaker than QR: SDP is signed with a public constant, so only the approval dialog + LAN trust protect it. */
  openPairing = true

  start(port: number, host = '0.0.0.0'): Promise<number> {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ port, host, maxPayload: MAX_MESSAGE_BYTES })
      this.wss.once('error', reject)
      this.wss.once('listening', () => resolve((this.wss!.address() as { port: number }).port))
      this.wss.on('connection', (ws) => this.onConnection(ws))
    })
  }

  stop() { this.wss?.close(); this.sessions.forEach((s) => s.ws.close()); this.sessions.clear() }

  newInvite(): string {
    const token = randomBytes(16).toString('hex')
    this.invites.set(token, { token, expires: Date.now() + INVITE_TTL_MS })
    return token
  }

  approve(sessionId: string) { this.reply(sessionId, 'approved') ; const s = this.sessions.get(sessionId); if (s) s.approved = true }
  reject(sessionId: string, reason = 'Rechazado por el usuario') { this.reply(sessionId, 'rejected', reason); this.sessions.get(sessionId)?.ws.close() }
  close(sessionId: string, reason = 'bye') {
    const s = this.sessions.get(sessionId)
    if (s) { s.ws.send(JSON.stringify({ t: 'bye', reason })); s.ws.close() }
  }
  sendAnswer(sessionId: string, sdp: string) {
    const s = this.sessions.get(sessionId); if (!s?.approved) return
    s.ws.send(JSON.stringify({ t: 'answer', sdp, sig: signSdp(s.token, sdp) }))
  }
  sendIce(sessionId: string, ice: object) {
    const s = this.sessions.get(sessionId); if (!s?.approved) return
    s.ws.send(JSON.stringify({ t: 'ice', ...ice }))
  }

  private reply(sessionId: string, status: 'approved' | 'rejected', reason?: string) {
    this.sessions.get(sessionId)?.ws.send(JSON.stringify({ t: 'hello-ack', status, sessionId, reason }))
  }

  private onConnection(ws: WebSocket) {
    let session: Session | undefined
    // A socket that never says hello is dropped.
    const helloTimer = setTimeout(() => !session && ws.close(4000, 'hello timeout'), 10_000)

    ws.on('message', (data, isBinary) => {
      const parsed = isBinary ? ({ ok: false, error: 'binary frame' } as const) : parseSignal(data.toString())
      if (!parsed.ok) { ws.close(4400, parsed.error); return }
      const m = parsed.value

      if (!session) {
        if (m.t !== 'hello') { ws.close(4401, 'hello expected'); return }
        let secret = OPEN_KEY
        if (m.token) {
          const inv = this.invites.get(m.token)
          if (!inv || inv.expires < Date.now()) { ws.send(JSON.stringify({ t: 'hello-ack', status: 'rejected', reason: 'Código QR inválido o caducado' })); ws.close(4403); return }
          this.invites.delete(m.token) // single use
          secret = m.token
        } else if (!this.openPairing) {
          ws.send(JSON.stringify({ t: 'hello-ack', status: 'rejected', reason: 'El emparejamiento sin QR está desactivado' })); ws.close(4403); return
        }
        session = { id: randomUUID(), token: secret, ws, approved: false }
        this.sessions.set(session.id, session)
        ws.send(JSON.stringify({ t: 'hello-ack', status: 'pending', sessionId: session.id }))
        this.emit('pairing-request', { sessionId: session.id, deviceId: m.deviceId, name: m.name, model: m.model } satisfies PairingRequest)
        return
      }

      // Everything after hello requires user approval first.
      if (!session.approved) { ws.close(4401, 'not approved'); return }
      if (m.t === 'offer') {
        if (!verifySdp(session.token, m.sdp, m.sig)) { ws.close(4403, 'bad signature'); return }
        this.emit('offer', session.id, m.sdp)
      } else if (m.t === 'ice') this.emit('ice', session.id, m)
      else if (m.t === 'bye') ws.close()
      else ws.close(4400, 'unexpected message')
    })

    ws.on('close', () => {
      clearTimeout(helloTimer)
      if (session) { this.sessions.delete(session.id); this.emit('closed', session.id) }
    })
    ws.on('error', () => ws.terminate())
  }
}

export { PROTOCOL_VERSION }
