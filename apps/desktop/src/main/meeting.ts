import { EventEmitter } from 'node:events'
import { createHash, randomBytes, randomUUID, type Hash } from 'node:crypto'
import { closeSync, mkdtempSync, openSync, readSync, rmSync, unlinkSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_SETTINGS, FILE_CHUNK, MAX_FILE_BYTES, MAX_MEETING_FILE_BYTES, MAX_MESSAGE_BYTES, MAX_PARTICIPANTS, MEDIA_STREAM, MSG_HISTORY,
  PAIR_TOKEN_TTL_MS, PC_CAPS, POLL_MAX_VOTERS,
  blockedFileName, canAssign, canKick, canPresent, canRequestControl, encodeFileChunk, fileChunkCount, isSafeLink, parseFileChunk, rank, validFileName,
  type Cap, type ClientMessage, type ControlGrant, type Device, type Msg, type MsgBody, type MsgBodyOut, type MsgTo, type Participant,
  type PresentSource, type RoomSettings, type ServerMessage, type SessionState
} from '@mirror-studio/protocol'

/**
 * Transport-agnostic endpoint of one participant (a secure WebSocket, or the host's own renderer).
 * `sendMedia` (TCP video relay) returns false when the frame was dropped because the link is backed up.
 * `sendFile` sends one FILE_TAG chunk (unsealed; the transport seals it) and `backlog` says how many bytes wait in
 * the socket: file chunks only go out while it is below FILE_BACKLOG, so JSON and video always pass first.
 */
export interface Conn {
  send(msg: ServerMessage): void
  close(reason: string): void
  sendMedia?(stream: number, frame: Uint8Array): boolean
  sendFile?(chunk: Uint8Array): void
  backlog?(): number
}

/** What the joining device declared in its hello. */
export interface JoinInfo { device: Device; caps: Cap[] }
const PC_JOIN: JoinInfo = { device: 'pc', caps: PC_CAPS }

export const CONTROL_ASK_TTL_MS = 30_000
/** Control events per second one controller may push to a target. Beyond this they are dropped. */
export const CONTROL_RATE = 400
/** Token buckets per member: `n` actions per `ms`. */
export const LIMITS = {
  control: { n: CONTROL_RATE, ms: 1000 },
  slide: { n: 10, ms: 1000 },
  pointer: { n: 40, ms: 1000 },
  ink: { n: 60, ms: 1000 },
  msg: { n: 5, ms: 10_000 },
  hand: { n: 4, ms: 10_000 },
  vote: { n: 4, ms: 10_000 },
  file: { n: 3, ms: 60_000 }
} as const
export type Limit = keyof typeof LIMITS
/** Teachers hear "X levantó la mano" at most once per this interval per person. */
export const HAND_NOTICE_MS = 10_000
/** File chunks are sent only while the receiver's socket holds fewer bytes than this. */
export const FILE_BACKLOG = 256 * 1024
export const MAX_DOWNLOADS = 2
export const MAX_QUEUED_DOWNLOADS = 20
export const MAX_POLLS = 50
/** A msg-history frame stays below this (JSON bytes), under the 64 KB frame cap. */
const HISTORY_FRAME_BYTES = MAX_MESSAGE_BYTES - 8 * 1024

interface Bucket { tokens: number; refilled: number }
interface Download { fileId: number; next: number; fd: number }
interface Member {
  id: string; name: string; role: Participant['role']; host?: boolean
  device: Device; caps: Set<Cap>; pairedWith: string | null
  conn: Conn; buckets: Map<Limit, Bucket>
  muted: boolean; handNoticeAt: number
  downloads: Download[]; queued: number[]; rr: number
}
interface Pending { controller: string; target: string; timer: NodeJS.Timeout }
interface StoredMsg { id: string; from: string; at: number; to: MsgTo; body: MsgBodyOut; answered?: boolean; shown?: boolean; anonymous?: boolean }
interface Poll {
  id: string; creator: string; question: string; options: string[]; multi: boolean; anonymous: boolean
  showResults: 'live' | 'on-close'; closed: boolean; votes: Map<string, number[]>
}
interface StoredFile {
  id: number; owner: string; name: string; size: number; sha256: string; mime: string; path: string
  count: number; next: number; complete: boolean; fd: number | null; hash: Hash
}

const isTeacher = (m: { role: Participant['role'] }) => rank(m.role) >= rank('teacher')

/**
 * Authoritative state of one meeting. EVERY action is validated here; clients only ask.
 * The creator is the host: when they leave, the meeting ends for everyone.
 * Events: 'state'(SessionState), 'rtc'(participantId, msg), 'closed'(reason),
 *         'media'(participantId, stream, frame), 'media-mode'(participantId)  -- TCP video relay, for the host's hub
 *         'control-ended'(controllerId, targetId)  -- the target must release held keys/buttons.
 */
export class MeetingHost extends EventEmitter {
  readonly id = randomUUID()
  private members = new Map<string, Member>()
  private presenter: string | null = null
  private presenterSource: PresentSource | null = null
  private grants: ControlGrant[] = []
  private pending: Pending[] = []
  private settings: RoomSettings = { ...DEFAULT_SETTINGS }
  private pairTokens = new Map<string, { pc: string; expiresAt: number }>()
  private hands: string[] = []
  private history: StoredMsg[] = []
  private polls = new Map<string, Poll>()
  private files = new Map<number, StoredFile>()
  private nextFileId = 1
  private fileBytes = 0
  private fileDir?: string
  private pumpTimer: NodeJS.Timeout | null = null
  private closed = false

  /** `fileBase`: where the meeting's temporary file folder is created (default: the OS temp folder). */
  constructor(readonly name: string, private now: () => number = Date.now, private fileBase = tmpdir()) { super() }

  get size() { return this.members.size }
  get isClosed() { return this.closed }
  get locked() { return this.settings.locked }

  state(): SessionState {
    return {
      sessionId: this.id, name: this.name,
      participants: [...this.members.values()].map((m) => ({
        id: m.id, name: m.name, role: m.role, ...(m.host ? { host: true } : {}),
        device: m.device, hand: this.handOf(m.id), pairedWith: m.pairedWith
      })),
      presenter: this.presenter,
      presenterSource: this.presenterSource,
      controls: this.grants.map((g) => ({ ...g })),
      settings: { ...this.settings }
    }
  }

  /** The first participant is the creator (the host itself). Null when the meeting is full, locked or closed. */
  join(name: string, conn: Conn, info: JoinInfo = PC_JOIN): string | null {
    if (this.closed || this.members.size >= MAX_PARTICIPANTS) return null
    const first = this.members.size === 0
    if (!first && this.settings.locked) return null
    const id = randomUUID()
    const m: Member = {
      id, name: name.slice(0, 64), role: first ? 'creator' : 'participant', host: first || undefined,
      device: info.device, caps: new Set(info.caps), pairedWith: null, conn, buckets: new Map(),
      muted: false, handNoticeAt: -Infinity, downloads: [], queued: [], rr: 0
    }
    this.members.set(id, m)
    conn.send({ t: 'welcome', you: id, state: this.state() })
    this.sendHistory(m)
    for (const p of this.polls.values()) conn.send(this.pollView(p, m))
    this.broadcast()
    return id
  }

  leave(id: string, reason = 'Salió de la reunión') {
    const m = this.members.get(id); if (!m) return
    if (m.role === 'creator') return this.close('El anfitrión terminó la reunión')
    this.endControlsOf(id, reason)
    this.dropPending((p) => p.controller === id || p.target === id)
    if (this.presenter === id) { this.presenter = null; this.presenterSource = null }
    this.hands = this.hands.filter((h) => h !== id)
    this.unpair(m)
    for (const [t, v] of this.pairTokens) if (v.pc === id) this.pairTokens.delete(t)
    for (const f of [...this.files.values()]) if (f.owner === id && !f.complete) this.dropFile(f)
    this.stopDownloads(m)
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
    for (const m of this.members.values()) this.stopDownloads(m)
    this.members.clear()
    this.presenter = null; this.presenterSource = null
    this.pairTokens.clear(); this.hands = []; this.history = []; this.polls.clear()
    if (this.pumpTimer) clearTimeout(this.pumpTimer)
    this.pumpTimer = null
    for (const f of this.files.values()) if (f.fd !== null) { try { closeSync(f.fd) } catch { /* already closed */ } }
    this.files.clear(); this.fileBytes = 0
    if (this.fileDir) { try { rmSync(this.fileDir, { recursive: true, force: true }) } catch { /* best effort */ } }
    this.emit('closed', reason)
  }

  /** Sends a WebRTC signaling message from the host's media hub to one participant. */
  sendRtc(to: string, kind: 'offer' | 'answer' | 'ice', data: string) {
    this.members.get(to)?.conn.send({ t: 'rtc', kind, data })
  }

  /** TCP video relay, host's hub -> one participant. False when dropped (unknown peer or link backed up). */
  sendMedia(to: string, stream: number, frame: Uint8Array): boolean {
    return this.members.get(to)?.conn.sendMedia?.(stream, frame) ?? false
  }
  /** The hub switched a participant's link to the TCP relay. Never sent to a device without the `relay` cap (phones). */
  sendMediaMode(to: string, reason?: string) {
    const m = this.members.get(to)
    if (m?.caps.has('relay')) m.conn.send({ t: 'media-mode', relay: true, reason })
  }
  /** A participant's own screen, sent over the TCP relay. Only that stream is accepted from participants. */
  media(from: string, stream: number, frame: Uint8Array) {
    if (this.closed || !this.members.get(from)?.caps.has('relay') || stream !== MEDIA_STREAM.screen) return
    this.emit('media', from, stream, frame)
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
        if (!canPresent(t.role) && this.presenter === t.id) { this.presenter = null; this.presenterSource = null }
        if (!canRequestControl(t.role)) { this.endControlsWhere((g) => g.controller === t.id, 'Perdió el permiso de control'); this.dropPending((p) => p.controller === t.id) }
        this.notice(t, `Ahora eres ${msg.role === 'admin' ? 'administrador' : msg.role === 'teacher' ? 'docente' : 'participante'}`)
        this.broadcast(); break
      }
      case 'present-start': {
        const source = msg.source ?? 'screen'
        if (!canPresent(actor.role)) return this.deny(actor, 'No tienes permiso para presentar')
        if (source === 'camera' && !actor.caps.has('camera')) return this.deny(actor, 'Este dispositivo no puede presentar su cámara')
        const cur = this.presenter && this.members.get(this.presenter)
        if (cur && cur.id !== from && rank(actor.role) < rank(cur.role)) return this.deny(actor, `${cur.name} ya está presentando`)
        this.presenter = from; this.presenterSource = source; this.broadcast(); break
      }
      case 'present-stop': {
        const cur = this.presenter && this.members.get(this.presenter)
        if (!cur) return
        if (cur.id !== from && rank(actor.role) <= rank(cur.role)) return this.deny(actor, 'No puedes detener esa presentación')
        this.presenter = null; this.presenterSource = null; this.broadcast(); break
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
        if (!this.take(actor, 'control')) return
        this.members.get(msg.target)?.conn.send({ t: 'control-input', from, input: msg.input }); break
      }
      // Health goes only from a controlled PC to the PC controlling it, and a reset only the other way round.
      case 'control-status': {
        if (!this.grants.some((g) => g.target === from && g.controller === msg.other)) return
        if (!this.take(actor, 'control')) return
        this.members.get(msg.other)?.conn.send({ t: 'control-status', from, health: msg.health }); break
      }
      case 'control-reset': {
        if (!this.grants.some((g) => g.controller === from && g.target === msg.target)) return
        if (!this.take(actor, 'control')) return
        this.members.get(msg.target)?.conn.send({ t: 'control-reset', from }); break
      }
      case 'rtc': this.emit('rtc', from, msg); break
      // A device without the relay cannot play it: the hub keeps it on WebRTC.
      case 'media-mode': if (actor.caps.has('relay')) this.emit('media-mode', from); break
      case 'leave': this.leave(from); break

      case 'pair-create': this.pairCreate(actor); break
      case 'pair-claim': this.pairClaim(actor, msg.token); break
      case 'pair-end': if (actor.pairedWith) { this.unpair(actor); this.broadcast() } break
      case 'slide': {
        const pc = actor.device === 'phone' && actor.pairedWith ? this.members.get(actor.pairedWith) : undefined
        if (!pc || !this.take(actor, 'slide')) return
        pc.conn.send({ t: 'slide', from, action: msg.action }); break
      }
      case 'slide-state': {
        const phone = actor.device === 'pc' && actor.pairedWith ? this.members.get(actor.pairedWith) : undefined
        if (!phone || !this.take(actor, 'slide')) return
        const { t: _t, ...rest } = msg
        phone.conn.send({ t: 'slide-state', from, ...rest }); break
      }
      case 'pointer': {
        const p = this.overlayTarget(actor)
        if (!p || !this.take(actor, 'pointer')) return
        p.conn.send({ t: 'pointer', from, x: msg.x, y: msg.y, on: msg.on }); break
      }
      case 'ink': {
        const p = this.overlayTarget(actor)
        if (!p || !this.take(actor, 'ink')) return
        p.conn.send({ t: 'ink', from, stroke: msg.stroke, points: msg.points, color: msg.color, width: msg.width, tool: msg.tool, done: msg.done }); break
      }
      case 'ink-undo':
      case 'ink-clear': {
        const p = this.overlayTarget(actor)
        if (!p || !this.take(actor, 'ink')) return
        p.conn.send({ t: msg.t, from }); break
      }

      case 'msg-send': this.msgSend(actor, msg.to, msg.body); break
      case 'msg-delete': {
        const s = this.history.find((x) => x.id === msg.id); if (!s) return
        if (s.from !== from && !isTeacher(actor)) return this.deny(actor, 'Solo puedes borrar tus propios mensajes')
        const to = this.membersWhoSee(s)
        this.history = this.history.filter((x) => x !== s)
        for (const m of to) m.conn.send({ t: 'msg-delete', id: s.id, by: from })
        break
      }
      case 'msg-mark':
      case 'msg-show': {
        if (!isTeacher(actor)) return this.deny(actor, 'Solo los docentes pueden gestionar las preguntas')
        const s = this.history.find((x) => x.id === msg.id)
        if (!s || s.body.kind !== 'question') return
        if (msg.t === 'msg-mark') s.answered = msg.answered
        else { s.shown = true; s.anonymous = msg.anonymous }
        for (const m of this.membersWhoSee(s)) m.conn.send(this.view(s, m))
        break
      }
      case 'room-settings': {
        if (!isTeacher(actor)) return this.deny(actor, 'Solo los docentes pueden cambiar los permisos de la sala')
        this.settings = { chat: msg.chat, share: msg.share, locked: msg.locked }
        this.broadcast(); break
      }
      case 'mute-chat': {
        const t = this.members.get(msg.target)
        if (!isTeacher(actor) || !t || t.id === from || rank(actor.role) <= rank(t.role)) return this.deny(actor, 'No puedes silenciar a esa persona')
        if (t.muted === msg.on) return
        t.muted = msg.on
        this.notice(t, msg.on ? 'Un docente te silenció en el chat' : 'Ya puedes volver a escribir en el chat')
        break
      }

      case 'hand': {
        if (!this.take(actor, 'hand')) return
        const up = this.hands.includes(from)
        if (msg.up && !up) {
          this.hands.push(from)
          this.handNotice(actor)
          this.broadcast()
        } else if (!msg.up && up) this.lowerHand(from)
        // The question goes only to teachers (and back to its author), never in the state everyone sees.
        if (msg.up && msg.text && !actor.muted) this.post(actor.id, 'teachers', { kind: 'question', text: msg.text })
        break
      }
      case 'hand-lower': {
        if (msg.target !== from && !isTeacher(actor)) return this.deny(actor, 'Solo los docentes pueden bajar la mano de otra persona')
        this.lowerHand(msg.target); break
      }

      case 'poll-create': {
        if (!isTeacher(actor)) return this.deny(actor, 'Solo los docentes pueden crear encuestas')
        if (this.polls.size >= MAX_POLLS) return this.deny(actor, 'Se alcanzó el máximo de encuestas de esta reunión')
        const p: Poll = {
          id: randomUUID(), creator: from, question: msg.question, options: [...msg.options], multi: msg.multi,
          anonymous: msg.anonymous, showResults: msg.showResults, closed: false, votes: new Map()
        }
        this.polls.set(p.id, p)
        this.sendPoll(p)
        this.post(from, 'all', { kind: 'poll', pollId: p.id })
        break
      }
      case 'poll-vote': {
        const p = this.polls.get(msg.pollId)
        if (!p || !this.take(actor, 'vote')) return
        if (p.closed) return this.deny(actor, 'La encuesta ya está cerrada')
        const choices = [...new Set(msg.choices)].sort((a, b) => a - b)
        if (choices.length !== msg.choices.length || choices.some((c) => c >= p.options.length) || (!p.multi && choices.length !== 1)) return this.deny(actor, 'Respuesta no válida')
        if (!p.votes.has(from) && p.votes.size >= POLL_MAX_VOTERS) return this.deny(actor, 'La encuesta ya no admite más votos')
        p.votes.set(from, choices)
        this.sendPoll(p); break
      }
      case 'poll-close': {
        if (!isTeacher(actor)) return this.deny(actor, 'Solo los docentes pueden cerrar encuestas')
        const p = this.polls.get(msg.pollId)
        if (!p || p.closed) return
        p.closed = true
        this.sendPoll(p); break
      }

      case 'file-offer': this.fileOffer(actor, msg); break
      case 'file-get': this.fileGet(actor, msg.fileId); break
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
    // Being helped answers the raised hand (also one raised from the paired phone).
    this.hands = this.hands.filter((h) => h !== target.id && h !== target.pairedWith)
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

  // ---- pairing, pointer and ink ------------------------------------------------------------

  private pairCreate(pc: Member) {
    if (pc.device !== 'pc') return this.deny(pc, 'Solo una PC puede crear el QR de vinculación')
    if (pc.pairedWith) return this.deny(pc, 'Esta PC ya tiene un teléfono vinculado')
    this.purgeTokens()
    for (const [t, v] of this.pairTokens) if (v.pc === pc.id) this.pairTokens.delete(t)
    const token = randomBytes(16).toString('base64url')
    const expiresAt = this.now() + PAIR_TOKEN_TTL_MS
    this.pairTokens.set(token, { pc: pc.id, expiresAt })
    pc.conn.send({ t: 'pair-token', token, expiresAt })
  }
  private pairClaim(phone: Member, token: string) {
    if (phone.device !== 'phone') return this.deny(phone, 'Solo un teléfono puede usar el QR de vinculación')
    if (phone.pairedWith) return this.deny(phone, 'Este teléfono ya está vinculado')
    this.purgeTokens()
    const tok = this.pairTokens.get(token)
    if (tok) this.pairTokens.delete(token) // single use, even if the PC is gone
    const pc = tok && this.members.get(tok.pc)
    if (!pc || pc.pairedWith) return this.deny(phone, 'El QR de vinculación caducó')
    pc.pairedWith = phone.id; phone.pairedWith = pc.id
    this.broadcast()
  }
  private purgeTokens() { const t = this.now(); for (const [k, v] of this.pairTokens) if (v.expiresAt <= t) this.pairTokens.delete(k) }
  private unpair(m: Member) {
    const other = m.pairedWith ? this.members.get(m.pairedWith) : undefined
    if (other) other.pairedWith = null
    m.pairedWith = null
  }
  /** The presenting PC, when `actor` may draw on it: the presenter itself or its paired phone, and never over a camera. */
  private overlayTarget(actor: Member): Member | undefined {
    const p = this.presenter ? this.members.get(this.presenter) : undefined
    if (!p || this.presenterSource === 'camera' || !p.caps.has('overlay')) return
    if (actor.id !== p.id && actor.pairedWith !== p.id) return
    return p
  }

  // ---- chat --------------------------------------------------------------------------------

  private msgSend(actor: Member, to: MsgTo, body: MsgBody) {
    if (!this.take(actor, 'msg')) return this.deny(actor, 'Estás enviando mensajes muy rápido; espera unos segundos')
    if (actor.muted) return this.deny(actor, 'Un docente te silenció en el chat')
    const teacher = isTeacher(actor)
    if (Array.isArray(to)) {
      if (!teacher) return this.deny(actor, 'Solo los docentes pueden escribir a personas concretas')
      to = [...new Set(to)].filter((x) => this.members.has(x))
      if (!to.length) return this.deny(actor, 'Esas personas ya no están en la reunión')
    }
    if (body.kind === 'poll') {
      if (!teacher) return this.deny(actor, 'Solo los docentes pueden publicar encuestas')
      if (!this.polls.has(body.pollId)) return this.deny(actor, 'Esa encuesta no existe')
      return this.post(actor.id, to, body)
    }
    if (!teacher) {
      const share = body.kind === 'link' || body.kind === 'file'
      const rule = share ? this.settings.share : this.settings.chat
      if (rule === 'off') return this.deny(actor, share ? 'El docente desactivó compartir archivos y enlaces' : 'El docente desactivó el chat')
      if (rule === 'teachers' && to !== 'teachers') return this.deny(actor, 'Por ahora solo puedes escribir a los docentes')
    }
    if (body.kind === 'link' && !isSafeLink(body.url)) return this.deny(actor, 'Solo se permiten enlaces http o https')
    if (body.kind === 'file') {
      const f = this.files.get(body.fileId)
      if (!f || !f.complete || f.owner !== actor.id) return this.deny(actor, 'Ese archivo no está disponible')
      return this.post(actor.id, to, { kind: 'file', fileId: f.id, name: f.name, size: f.size, mime: f.mime })
    }
    this.post(actor.id, to, body)
  }
  /** Stores a message (last MSG_HISTORY) and delivers it to everyone allowed to see it. */
  private post(from: string, to: MsgTo, body: MsgBodyOut) {
    const s: StoredMsg = { id: randomUUID(), from, at: this.now(), to, body }
    this.history.push(s)
    if (this.history.length > MSG_HISTORY) this.history.splice(0, this.history.length - MSG_HISTORY)
    for (const m of this.membersWhoSee(s)) m.conn.send(this.view(s, m))
  }
  private canSee(m: Member, s: StoredMsg) {
    return s.from === m.id || !!s.shown || s.to === 'all' || (s.to === 'teachers' && isTeacher(m)) || (Array.isArray(s.to) && s.to.includes(m.id))
  }
  private membersWhoSee(s: StoredMsg) { return [...this.members.values()].filter((m) => this.canSee(m, s)) }
  /** The message as `m` sees it: an anonymously shown question hides its author from everyone but teachers and the author. */
  private view(s: StoredMsg, m: Member): Msg {
    const hide = s.shown && s.anonymous && !isTeacher(m) && s.from !== m.id
    return {
      t: 'msg', id: s.id, from: hide ? null : s.from, at: s.at, to: s.to, body: s.body,
      ...(s.answered !== undefined ? { answered: s.answered } : {}), ...(s.shown ? { shown: true } : {})
    }
  }
  /** History after the welcome, only what `m` may see, split so every frame stays under the size cap. */
  private sendHistory(m: Member) {
    const items = this.history.filter((s) => this.canSee(m, s)).map((s) => this.view(s, m))
    let chunk: Msg[] = [], bytes = 0
    for (const it of items) {
      const n = Buffer.byteLength(JSON.stringify(it)) + 1
      if (chunk.length && bytes + n > HISTORY_FRAME_BYTES) { m.conn.send({ t: 'msg-history', items: chunk }); chunk = []; bytes = 0 }
      chunk.push(it); bytes += n
    }
    m.conn.send({ t: 'msg-history', items: chunk })
  }

  // ---- raised hands ------------------------------------------------------------------------

  private handOf(id: string) { const i = this.hands.indexOf(id); return i < 0 ? null : i + 1 }
  private lowerHand(id: string) {
    if (!this.hands.includes(id)) return
    this.hands = this.hands.filter((h) => h !== id)
    this.broadcast()
  }
  private handNotice(m: Member) {
    const t = this.now()
    if (t - m.handNoticeAt < HAND_NOTICE_MS) return
    m.handNoticeAt = t
    const text = `${m.name} levantó la mano`.slice(0, 200)
    for (const x of this.members.values()) if (x.id !== m.id && isTeacher(x)) this.notice(x, text)
  }

  // ---- polls -------------------------------------------------------------------------------

  private pollView(p: Poll, m: Member): ServerMessage {
    const creator = m.id === p.creator
    const counts = creator || p.showResults === 'live' || p.closed
      ? p.options.map((_, i) => [...p.votes.values()].filter((c) => c.includes(i)).length) : undefined
    const voters = creator && !p.anonymous ? [...p.votes].map(([id, choices]) => ({ id, choices: [...choices] })) : undefined
    return {
      t: 'poll-state', pollId: p.id, question: p.question, options: [...p.options], multi: p.multi, anonymous: p.anonymous,
      showResults: p.showResults, closed: p.closed, ...(counts ? { counts } : {}), ...(voters ? { voters } : {}), total: p.votes.size
    }
  }
  private sendPoll(p: Poll) { for (const m of this.members.values()) m.conn.send(this.pollView(p, m)) }

  // ---- files -------------------------------------------------------------------------------

  private fileOffer(actor: Member, o: { name: string; size: number; sha256: string; mime: string }) {
    if (!actor.caps.has('files')) return this.deny(actor, 'Este dispositivo no admite archivos')
    if (!this.take(actor, 'file')) return this.deny(actor, 'Puedes enviar como máximo 3 archivos por minuto')
    if (actor.muted) return this.deny(actor, 'Un docente te silenció en el chat')
    if (!isTeacher(actor) && this.settings.share === 'off') return this.deny(actor, 'El docente desactivó compartir archivos y enlaces')
    if (!validFileName(o.name)) return this.deny(actor, 'Nombre de archivo no válido')
    if (blockedFileName(o.name)) return this.deny(actor, 'No se permite enviar ese tipo de archivo')
    if (o.size > MAX_FILE_BYTES) return this.deny(actor, 'El archivo pasa de 50 MB')
    if (this.fileBytes + o.size > MAX_MEETING_FILE_BYTES) return this.deny(actor, 'Se alcanzó el límite de 200 MB de archivos de esta reunión')
    this.fileDir ??= mkdtempSync(join(this.fileBase, 'mirrorstudio-'))
    const id = this.nextFileId++
    const path = join(this.fileDir, String(id))
    const f: StoredFile = {
      id, owner: actor.id, name: o.name, size: o.size, sha256: o.sha256, mime: o.mime, path,
      count: fileChunkCount(o.size), next: 0, complete: false, fd: openSync(path, 'w'), hash: createHash('sha256')
    }
    this.files.set(id, f)
    this.fileBytes += o.size
    actor.conn.send({ t: 'file-accept', fileId: id })
  }

  /**
   * One FILE_TAG chunk of an upload. False only for a malformed frame (the transport drops the peer). Chunks must
   * come in order with the exact sizes; anything else cancels the upload. The SHA-256 is checked on the last one.
   */
  fileChunk(from: string, frame: Uint8Array): boolean {
    const c = parseFileChunk(frame)
    if (!c) return false
    const f = this.files.get(c.fileId)
    if (this.closed || !f || f.owner !== from || f.complete || f.fd === null) return true // cancelled or not theirs: ignored
    const expect = c.index < f.count - 1 ? FILE_CHUNK : f.size - FILE_CHUNK * (f.count - 1)
    if (c.count !== f.count || c.index !== f.next || c.payload.length !== expect) {
      this.dropFile(f, 'El archivo llegó incompleto; vuelve a enviarlo')
      return true
    }
    writeSync(f.fd, c.payload)
    f.hash.update(c.payload)
    f.next++
    if (f.next < f.count) return true
    closeSync(f.fd); f.fd = null
    if (f.hash.digest('hex') !== f.sha256) this.dropFile(f, 'El archivo llegó dañado (no coincide el SHA-256); vuelve a enviarlo')
    else f.complete = true
    return true
  }
  private dropFile(f: StoredFile, reason?: string) {
    if (f.fd !== null) { try { closeSync(f.fd) } catch { /* already closed */ } f.fd = null }
    try { unlinkSync(f.path) } catch { /* already gone */ }
    this.files.delete(f.id)
    this.fileBytes -= f.size
    const owner = this.members.get(f.owner)
    if (reason && owner) this.notice(owner, reason)
  }
  /** Who may download: the uploader, and whoever can see a chat message that carries the file. */
  private mayGet(m: Member, f: StoredFile) {
    return f.owner === m.id || this.history.some((s) => s.body.kind === 'file' && s.body.fileId === f.id && this.canSee(m, s))
  }
  /** For the host's own window, which reads the stored file directly instead of over a socket. */
  localFile(memberId: string, fileId: number): { path: string; name: string; size: number; sha256: string; mime: string } | null {
    const m = this.members.get(memberId), f = this.files.get(fileId)
    if (!m || !f || !f.complete || !this.mayGet(m, f)) return null
    return { path: f.path, name: f.name, size: f.size, sha256: f.sha256, mime: f.mime }
  }
  private fileGet(actor: Member, fileId: number) {
    const f = this.files.get(fileId)
    if (!f || !f.complete || !this.mayGet(actor, f) || !actor.conn.sendFile) return this.deny(actor, 'Ese archivo no está disponible')
    if (actor.downloads.some((d) => d.fileId === fileId) || actor.queued.includes(fileId)) return
    if (actor.downloads.length < MAX_DOWNLOADS) this.startDownload(actor, f)
    else if (actor.queued.length < MAX_QUEUED_DOWNLOADS) actor.queued.push(fileId)
    else this.deny(actor, 'Hay demasiadas descargas en espera')
  }
  private startDownload(m: Member, f: StoredFile) {
    m.conn.send({ t: 'file-meta', fileId: f.id, name: f.name, size: f.size, sha256: f.sha256 })
    m.downloads.push({ fileId: f.id, next: 0, fd: openSync(f.path, 'r') })
    this.schedulePump(0)
  }
  private finishDownload(m: Member, d: Download) {
    try { closeSync(d.fd) } catch { /* already closed */ }
    m.downloads = m.downloads.filter((x) => x !== d)
    while (m.downloads.length < MAX_DOWNLOADS && m.queued.length) {
      const f = this.files.get(m.queued.shift()!)
      if (f?.complete) this.startDownload(m, f)
    }
  }
  private stopDownloads(m: Member) {
    for (const d of m.downloads) { try { closeSync(d.fd) } catch { /* already closed */ } }
    m.downloads = []; m.queued = []
  }
  private schedulePump(delay: number) {
    if (this.pumpTimer || this.closed) return
    this.pumpTimer = setTimeout(() => { this.pumpTimer = null; this.pump() }, delay)
    this.pumpTimer.unref?.()
  }
  /** Low-priority sender: a few chunks per receiver per turn, only while its socket is nearly empty. */
  private pump() {
    let waiting = false, backedUp = false
    for (const m of this.members.values()) {
      for (let sent = 0; m.downloads.length && sent < 8; sent++) {
        if ((m.conn.backlog?.() ?? 0) >= FILE_BACKLOG) { backedUp = true; break }
        const d = m.downloads[m.rr++ % m.downloads.length]
        const f = this.files.get(d.fileId)
        if (!f) { this.finishDownload(m, d); continue }
        const len = d.next < f.count - 1 ? FILE_CHUNK : f.size - FILE_CHUNK * (f.count - 1)
        const buf = Buffer.alloc(len)
        readSync(d.fd, buf, 0, len, d.next * FILE_CHUNK)
        m.conn.sendFile?.(encodeFileChunk(f.id, d.next, f.count, buf))
        if (++d.next === f.count) this.finishDownload(m, d)
      }
      if (m.downloads.length) waiting = true
    }
    if (waiting) this.schedulePump(backedUp ? 20 : 0)
  }

  // ---- helpers -----------------------------------------------------------------------------

  /** Token bucket per member and kind of action. */
  private take(m: Member, kind: Limit): boolean {
    const { n, ms } = LIMITS[kind]
    const t = this.now()
    const b = m.buckets.get(kind) ?? { tokens: n, refilled: t }
    b.tokens = Math.min(n, b.tokens + ((t - b.refilled) / ms) * n)
    b.refilled = t
    m.buckets.set(kind, b)
    if (b.tokens < 1) return false
    b.tokens -= 1
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
