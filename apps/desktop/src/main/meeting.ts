import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import {
  MAX_PARTICIPANTS, canAssign, canKick, canPresent, canRequestControl, rank,
  type ClientMessage, type ControlGrant, type Participant, type ServerMessage, type SessionState
} from '@mirror-studio/protocol'

/** Transport-agnostic endpoint of one participant (a secure WebSocket, or the host's own renderer). */
export interface Conn { send(msg: ServerMessage): void; close(reason: string): void }

interface Member extends Participant { conn: Conn; tokens: number; refilled: number }
interface Pending { controller: string; target: string; timer: NodeJS.Timeout }

export const CONTROL_ASK_TTL_MS = 30_000
/** Control events per second one controller may push to a target. Beyond this they are dropped. */
export const CONTROL_RATE = 400

/**
 * Authoritative state of one meeting. EVERY action is validated here; clients only ask.
 * The creator is the host: when they leave, the meeting ends for everyone.
 * Events: 'state'(SessionState), 'rtc'(participantId, msg), 'closed'(reason),
 *         'control-ended'(controllerId, targetId)  -- the target must release held keys/buttons.
 */
export class MeetingHost extends EventEmitter {
  readonly id = randomUUID()
  private members = new Map<string, Member>()
  private presenter: string | null = null
  private grants: ControlGrant[] = []
  private pending: Pending[] = []
  private closed = false

  constructor(readonly name: string, private now: () => number = Date.now) { super() }

  get size() { return this.members.size }
  get isClosed() { return this.closed }

  state(): SessionState {
    return {
      sessionId: this.id, name: this.name,
      participants: [...this.members.values()].map(({ conn: _c, tokens: _t, refilled: _r, ...p }) => p),
      presenter: this.presenter,
      controls: this.grants.map((g) => ({ ...g }))
    }
  }

  /** The first participant is the creator (the host itself). Returns null when the meeting is full or closed. */
  join(name: string, conn: Conn): string | null {
    if (this.closed || this.members.size >= MAX_PARTICIPANTS) return null
    const id = randomUUID()
    const first = this.members.size === 0
    this.members.set(id, { id, name: name.slice(0, 64), role: first ? 'creator' : 'participant', host: first || undefined, conn, tokens: CONTROL_RATE, refilled: this.now() })
    conn.send({ t: 'welcome', you: id, state: this.state() })
    this.broadcast()
    return id
  }

  leave(id: string, reason = 'Salió de la reunión') {
    const m = this.members.get(id); if (!m) return
    if (m.role === 'creator') return this.close('El anfitrión terminó la reunión')
    this.endControlsOf(id, reason)
    this.dropPending((p) => p.controller === id || p.target === id)
    if (this.presenter === id) this.presenter = null
    this.members.delete(id)
    this.broadcast()
  }

  close(reason: string) {
    if (this.closed) return
    this.closed = true
    for (const p of this.pending) clearTimeout(p.timer)
    this.pending = []
    for (const g of this.grants) this.emit('control-ended', g.controller, g.target)
    this.grants = []
    for (const m of this.members.values()) { try { m.conn.send({ t: 'closed', reason }) } catch { /* peer already gone */ } m.conn.close(reason) }
    this.members.clear()
    this.presenter = null
    this.emit('closed', reason)
  }

  /** Sends a WebRTC signaling message from the host's media hub to one participant. */
  sendRtc(to: string, kind: 'offer' | 'answer' | 'ice', data: string) {
    this.members.get(to)?.conn.send({ t: 'rtc', kind, data })
  }

  handle(from: string, msg: ClientMessage) {
    const actor = this.members.get(from)
    if (!actor || this.closed) return
    switch (msg.t) {
      case 'kick': {
        const t = this.members.get(msg.target)
        if (!t || t.id === from || !canKick(actor.role, t.role)) return this.deny(actor, 'No tienes permiso para expulsar a esa persona')
        const conn = t.conn
        this.leave(t.id, 'Fue expulsado de la reunión')
        try { conn.send({ t: 'closed', reason: 'Fuiste expulsado de la reunión' }) } catch { /* gone */ }
        conn.close('kicked'); break
      }
      case 'set-role': {
        const t = this.members.get(msg.target)
        if (!t || t.id === from || !canAssign(actor.role, t.role, msg.role)) return this.deny(actor, 'No tienes permiso para cambiar ese rol')
        t.role = msg.role
        // Losing a role must also drop the powers that came with it.
        if (!canPresent(t.role) && this.presenter === t.id) this.presenter = null
        if (!canRequestControl(t.role)) { this.endControlsWhere((g) => g.controller === t.id, 'Perdió el permiso de control'); this.dropPending((p) => p.controller === t.id) }
        this.notice(t, `Ahora eres ${msg.role === 'admin' ? 'administrador' : msg.role === 'teacher' ? 'docente' : 'participante'}`)
        this.broadcast(); break
      }
      case 'present-start': {
        if (!canPresent(actor.role)) return this.deny(actor, 'No tienes permiso para presentar')
        const cur = this.presenter && this.members.get(this.presenter)
        if (cur && cur.id !== from && rank(actor.role) < rank(cur.role)) return this.deny(actor, `${cur.name} ya está presentando`)
        this.presenter = from; this.broadcast(); break
      }
      case 'present-stop': {
        const cur = this.presenter && this.members.get(this.presenter)
        if (!cur) return
        if (cur.id !== from && rank(actor.role) <= rank(cur.role)) return this.deny(actor, 'No puedes detener esa presentación')
        this.presenter = null; this.broadcast(); break
      }
      case 'control-request': this.requestControl(actor, msg.target); break
      case 'control-respond': this.respondControl(actor, msg.controller, msg.accept); break
      case 'control-revoke': {
        const g = this.grants.find((x) => (x.controller === from && x.target === msg.other) || (x.target === from && x.controller === msg.other))
        if (g) this.endControlsWhere((x) => x === g, from === g.target ? 'La persona controlada detuvo el control' : 'El controlador detuvo el control')
        else this.dropPending((p) => (p.controller === from && p.target === msg.other)) // withdraw a request
        break
      }
      case 'control-input': {
        if (!this.grants.some((g) => g.controller === from && g.target === msg.target)) return // no active grant: dropped
        if (!this.take(actor)) return
        this.members.get(msg.target)?.conn.send({ t: 'control-input', from, input: msg.input }); break
      }
      case 'rtc': this.emit('rtc', from, msg); break
      case 'leave': this.leave(from); break
    }
  }

  // ---- control lifecycle -------------------------------------------------------------------

  private requestControl(actor: Member, targetId: string) {
    const t = this.members.get(targetId)
    if (!canRequestControl(actor.role)) return this.deny(actor, 'Solo docentes y administradores pueden pedir control')
    if (!t || t.id === actor.id) return this.deny(actor, 'Esa persona no está disponible')
    if (this.grants.some((g) => g.target === t.id)) return this.deny(actor, `${t.name} ya está siendo controlado`)
    if (this.grants.some((g) => g.controller === actor.id)) return this.deny(actor, 'Ya estás controlando otra PC; detenla primero')
    if (this.pending.some((p) => p.controller === actor.id && p.target === t.id)) return
    const timer = setTimeout(() => {
      this.dropPending((p) => p.controller === actor.id && p.target === t.id)
      this.notice(actor, `${t.name} no respondió a la solicitud de control`)
    }, CONTROL_ASK_TTL_MS)
    timer.unref?.()
    this.pending.push({ controller: actor.id, target: t.id, timer })
    t.conn.send({ t: 'control-asked', controller: actor.id, name: actor.name })
  }

  private respondControl(target: Member, controllerId: string, accept: boolean) {
    const p = this.pending.find((x) => x.controller === controllerId && x.target === target.id)
    if (!p) return // nobody asked, or it expired: a response is not a grant
    this.dropPending((x) => x === p)
    const controller = this.members.get(controllerId); if (!controller) return
    // The controller may have lost the role while the dialog was open.
    if (!accept || !canRequestControl(controller.role)) {
      controller.conn.send({ t: 'control-ended', controller: controllerId, target: target.id, reason: accept ? 'Ya no tienes permiso' : 'Rechazado' })
      return
    }
    this.grants.push({ controller: controllerId, target: target.id })
    const started = { t: 'control-started', controller: controllerId, target: target.id } as const
    controller.conn.send(started); target.conn.send(started)
    this.broadcast()
  }

  private endControlsOf(id: string, reason: string) { this.endControlsWhere((g) => g.controller === id || g.target === id, reason) }
  private endControlsWhere(pred: (g: ControlGrant) => boolean, reason: string) {
    const ended = this.grants.filter(pred)
    if (!ended.length) return
    this.grants = this.grants.filter((g) => !ended.includes(g))
    for (const g of ended) {
      const msg = { t: 'control-ended', controller: g.controller, target: g.target, reason: reason.slice(0, 120) } as const
      this.members.get(g.controller)?.conn.send(msg)
      this.members.get(g.target)?.conn.send(msg)
      this.emit('control-ended', g.controller, g.target)
    }
    this.broadcast()
  }
  private dropPending(pred: (p: Pending) => boolean) {
    this.pending = this.pending.filter((p) => { if (pred(p)) { clearTimeout(p.timer); return false } return true })
  }

  // ---- helpers -----------------------------------------------------------------------------

  /** Token bucket per controller. */
  private take(m: Member): boolean {
    const t = this.now()
    m.tokens = Math.min(CONTROL_RATE, m.tokens + ((t - m.refilled) / 1000) * CONTROL_RATE)
    m.refilled = t
    if (m.tokens < 1) return false
    m.tokens -= 1
    return true
  }
  private deny = (m: Member, text: string) => this.notice(m, text)
  private notice(m: Member, text: string) { m.conn.send({ t: 'notice', text }) }
  private broadcast() {
    const state = this.state()
    for (const m of this.members.values()) m.conn.send({ t: 'state', state })
    this.emit('state', state)
  }
}
