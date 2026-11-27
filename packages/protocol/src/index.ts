import { z } from 'zod'

/** Bumped to 4 for the TCP video relay (media-mode + binary media frames): an older host would drop a peer that sends them. */
export const PROTOCOL_VERSION = 4
/** Hard cap for any signaling frame (SDP is the largest, ~10 KB). */
export const MAX_MESSAGE_BYTES = 64 * 1024
/** Participants per session. A target, not a promise: see the load measurements in HANDOFF.md. */
export const MAX_PARTICIPANTS = 35
export const DEFAULT_PORT = 47800

const str = (max: number) => z.string().min(1).max(max)
const unit = z.number().min(0).max(1)

// ---------------------------------------------------------------------------
// Roles and permissions. The HOST validates every action; clients never authorize themselves.
// ---------------------------------------------------------------------------
export const ROLES = ['creator', 'admin', 'teacher', 'participant'] as const
export type Role = (typeof ROLES)[number]
export const AssignableRole = z.enum(['admin', 'teacher', 'participant'])
export type AssignableRole = z.infer<typeof AssignableRole>

const RANK: Record<Role, number> = { creator: 3, admin: 2, teacher: 1, participant: 0 }
export const rank = (r: Role) => RANK[r]

/** Everyone may present. Taking over someone else's presentation still needs equal or higher rank (see the host). */
export const canPresent = (_r: Role) => true
export const canRequestControl = (r: Role) => rank(r) >= RANK.teacher
/** Kicking needs admin and strictly higher rank than the target. */
export const canKick = (actor: Role, target: Role) => rank(actor) >= RANK.admin && rank(actor) > rank(target)
/**
 * Role changes: the creator is permanent and can assign anything to anyone else.
 * Admins can only assign/remove "teacher" on participants/teachers. Nobody else can change roles.
 */
export function canAssign(actor: Role, target: Role, next: AssignableRole): boolean {
  if (target === 'creator') return false
  if (actor === 'creator') return true
  if (actor === 'admin') return (next === 'teacher' || next === 'participant') && rank(target) <= RANK.teacher
  return false
}

// ---------------------------------------------------------------------------
// Pre-handshake frames (plain JSON text). Nothing secret travels here: see node.ts in this package.
// ---------------------------------------------------------------------------
export const InfoRequest = z.object({ t: z.literal('info') })
export const InfoReply = z.object({
  // Any version parses, so the discovery list can still show a meeting that runs another version (and say so).
  t: z.literal('info-reply'), v: z.number().int().min(1).max(1000),
  name: str(64), host: str(64), participants: z.number().int().min(0).max(1000)
})
export const Hello = z.object({
  t: z.literal('hello'), v: z.literal(PROTOCOL_VERSION),
  /** X25519 public key and nonce, base64. */
  pub: str(64), nonce: str(64), name: str(64)
})
export const HelloReply = z.object({
  t: z.literal('hello-reply'), pub: str(64), nonce: str(64), salt: str(64)
})
export const Confirm = z.object({ t: z.literal('confirm'), mac: str(128) })
export const ConfirmOk = z.object({ t: z.literal('confirm-ok'), mac: str(128) })
export const Reject = z.object({ t: z.literal('reject'), reason: str(200) })
export type Hello = z.infer<typeof Hello>
export type HelloReply = z.infer<typeof HelloReply>
export type Confirm = z.infer<typeof Confirm>
export type ConfirmOk = z.infer<typeof ConfirmOk>
export const HandshakeMessage = z.discriminatedUnion('t', [InfoRequest, InfoReply, Hello, HelloReply, Confirm, ConfirmOk, Reject])
export type HandshakeMessage = z.infer<typeof HandshakeMessage>

// ---------------------------------------------------------------------------
// Control input (PC control): normalized coordinates over the target's primary display.
// ---------------------------------------------------------------------------
export const MouseMove = z.object({ t: z.literal('mouse-move'), x: unit, y: unit })
export const MouseButton = z.object({ t: z.literal('mouse-button'), button: z.enum(['left', 'right', 'middle']), down: z.boolean() })
export const Wheel = z.object({ t: z.literal('wheel'), dx: z.number().int().min(-2000).max(2000), dy: z.number().int().min(-2000).max(2000) })
/** `code` is a KeyboardEvent.code value ("KeyA", "Enter", ...). The driver rejects unknown codes. */
export const KeyEvent = z.object({ t: z.literal('key'), code: str(32), down: z.boolean() })
export const TextEvent = z.object({ t: z.literal('text'), text: z.string().min(1).max(200) })
export const ControlInput = z.discriminatedUnion('t', [MouseMove, MouseButton, Wheel, KeyEvent, TextEvent])
export type ControlInput = z.infer<typeof ControlInput>

// ---------------------------------------------------------------------------
// Session messages (encrypted after the handshake).
// ---------------------------------------------------------------------------
const id = str(64)
export const Participant = z.object({
  id, name: str(64), role: z.enum(ROLES), host: z.boolean().optional()
})
export type Participant = z.infer<typeof Participant>
export const ControlGrant = z.object({ controller: id, target: id })
export type ControlGrant = z.infer<typeof ControlGrant>
export const SessionState = z.object({
  sessionId: id, name: str(64),
  participants: z.array(Participant).max(MAX_PARTICIPANTS),
  presenter: id.nullable(),
  controls: z.array(ControlGrant).max(MAX_PARTICIPANTS)
})
export type SessionState = z.infer<typeof SessionState>

// Client -> host. No microphone: everyone is in the same room. Audio is the presenter's PC sound, sent with the screen.
export const Kick = z.object({ t: z.literal('kick'), target: id })
export const SetRole = z.object({ t: z.literal('set-role'), target: id, role: AssignableRole })
export const PresentStart = z.object({ t: z.literal('present-start') })
export const PresentStop = z.object({ t: z.literal('present-stop') })
export const ControlRequest = z.object({ t: z.literal('control-request'), target: id })
export const ControlRespond = z.object({ t: z.literal('control-respond'), controller: id, accept: z.boolean() })
export const ControlRevoke = z.object({ t: z.literal('control-revoke'), other: id })
export const ControlSend = z.object({ t: z.literal('control-input'), target: id, input: ControlInput })
/**
 * How remote control is doing on the controlled PC, sent by it to its controller every few seconds:
 * - ok: input is applied
 * - restarting: the injector died or hung and is being started again
 * - blocked-admin: Windows drops injected input because an elevated window (detail: its process) is in front
 * - blocked-secure: a secure screen is up (UAC prompt, lock screen, Ctrl+Alt+Del), nothing can be injected
 * - rejected: Windows refused the injected input without saying why
 * `received` counts the input events that reached the controlled PC since control started.
 */
export const ControlHealth = z.object({
  code: z.enum(['ok', 'restarting', 'blocked-admin', 'blocked-secure', 'rejected']),
  detail: z.string().max(64).optional(),
  received: z.number().int().min(0)
})
export type ControlHealth = z.infer<typeof ControlHealth>
/** From the controlled PC, about its controller `other`. */
export const ControlStatus = z.object({ t: z.literal('control-status'), other: id, health: ControlHealth })
/** From the controller: input or picture stopped working, so the controlled PC restarts its injector and capture. */
export const ControlReset = z.object({ t: z.literal('control-reset'), target: id })
/** WebRTC signaling between a participant and the host's media hub. */
export const Rtc = z.object({
  t: z.literal('rtc'),
  kind: z.enum(['offer', 'answer', 'ice']),
  data: z.string().max(32768)
})
/**
 * WebRTC video for this participant<->host link does not get through (UDP blocked by a firewall, no frames
 * decoded): from now on its video travels inside the encrypted WebSocket (TCP 47800) as binary media frames
 * (see MEDIA_TAG below). Either end may switch; it never switches back during the meeting.
 */
export const MediaMode = z.object({ t: z.literal('media-mode'), relay: z.literal(true), reason: z.string().max(80).optional() })
export const Leave = z.object({ t: z.literal('leave') })
export const ClientMessage = z.discriminatedUnion('t', [
  Kick, SetRole, PresentStart, PresentStop,
  ControlRequest, ControlRespond, ControlRevoke, ControlSend, ControlStatus, ControlReset, Rtc, MediaMode, Leave
])
export type ClientMessage = z.infer<typeof ClientMessage>

// Host -> client
export const Welcome = z.object({ t: z.literal('welcome'), you: id, state: SessionState })
export const StateMsg = z.object({ t: z.literal('state'), state: SessionState })
export const ControlAsked = z.object({ t: z.literal('control-asked'), controller: id, name: str(64) })
export const ControlStarted = z.object({ t: z.literal('control-started'), controller: id, target: id })
export const ControlEnded = z.object({ t: z.literal('control-ended'), controller: id, target: id, reason: str(120) })
export const ControlInputIn = z.object({ t: z.literal('control-input'), from: id, input: ControlInput })
export const ControlStatusIn = z.object({ t: z.literal('control-status'), from: id, health: ControlHealth })
export const ControlResetIn = z.object({ t: z.literal('control-reset'), from: id })
export const Notice = z.object({ t: z.literal('notice'), text: str(200) })
export const Closed = z.object({ t: z.literal('closed'), reason: str(200) })
export const ServerMessage = z.discriminatedUnion('t', [
  Welcome, StateMsg, ControlAsked, ControlStarted, ControlEnded, ControlInputIn, ControlStatusIn, ControlResetIn, Notice, Closed, Rtc, MediaMode
])
export type ServerMessage = z.infer<typeof ServerMessage>

// ---------------------------------------------------------------------------
// Binary media frames (TCP video relay). After the handshake every frame is sealed; a JSON message starts
// with '{', a media piece starts with MEDIA_TAG. One encoded video frame is split into pieces of at most
// MEDIA_PIECE bytes, so control input slips in between them and every frame stays under the 64 KB cap.
//   piece: [MEDIA_TAG u8][stream u8][seq u32][index u16][count u16][payload]
// The reassembled payload is the renderer's encoded frame (see media-relay.ts in the desktop app).
// ---------------------------------------------------------------------------
export const MEDIA_TAG = 0x01
export const MEDIA_PIECE = 48 * 1024
export const MEDIA_HEADER = 10
/** Largest encoded frame accepted (a 1440p key frame is far below this). */
export const MAX_MEDIA_FRAME = 4 * 1024 * 1024
/** What the host sends a participant (the presentation, the PC it controls) and the participant's own screen. */
export const MEDIA_STREAM = { presentation: 1, control: 2, screen: 3 } as const

export function splitMedia(stream: number, seq: number, frame: Uint8Array): Uint8Array[] {
  const count = Math.max(1, Math.ceil(frame.length / MEDIA_PIECE))
  const out: Uint8Array[] = []
  for (let i = 0; i < count; i++) {
    const body = frame.subarray(i * MEDIA_PIECE, (i + 1) * MEDIA_PIECE)
    const p = new Uint8Array(MEDIA_HEADER + body.length)
    const v = new DataView(p.buffer)
    v.setUint8(0, MEDIA_TAG); v.setUint8(1, stream); v.setUint32(2, seq >>> 0); v.setUint16(6, i); v.setUint16(8, count)
    p.set(body, MEDIA_HEADER)
    out.push(p)
  }
  return out
}

/**
 * Puts pieces back together, per stream. A piece of a newer frame drops the unfinished older one: in a live
 * picture a late frame is worth nothing, the next one is already coming.
 */
export class MediaAssembler {
  private cur = new Map<number, { seq: number; count: number; parts: (Uint8Array | undefined)[]; got: number }>()
  /** The complete frame, or null while pieces are missing. Throws on a malformed piece (callers drop the peer). */
  push(piece: Uint8Array): { stream: number; frame: Uint8Array } | null {
    if (piece.length < MEDIA_HEADER || piece[0] !== MEDIA_TAG) throw new Error('bad media piece')
    const v = new DataView(piece.buffer, piece.byteOffset, piece.byteLength)
    const stream = v.getUint8(1), seq = v.getUint32(2), index = v.getUint16(6), count = v.getUint16(8)
    if (count === 0 || index >= count || (count - 1) * MEDIA_PIECE > MAX_MEDIA_FRAME) throw new Error('bad media piece')
    let c = this.cur.get(stream)
    if (!c || c.seq !== seq || c.count !== count) {
      if (c && ((seq - c.seq) | 0) < 0) return null // an older frame arriving late: ignore it
      c = { seq, count, parts: new Array(count), got: 0 }
      this.cur.set(stream, c)
    }
    if (!c.parts[index]) { c.parts[index] = piece.subarray(MEDIA_HEADER); c.got++ }
    if (c.got < c.count) return null
    this.cur.delete(stream)
    const frame = new Uint8Array(c.parts.reduce((n, p) => n + p!.length, 0))
    let o = 0
    for (const p of c.parts) { frame.set(p!, o); o += p!.length }
    return { stream, frame }
  }
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

function parseWith<T>(schema: z.ZodType<T>, raw: unknown): ParseResult<T> {
  const text = typeof raw === 'string' ? raw : raw instanceof Uint8Array ? new TextDecoder().decode(raw) : null
  if (text === null) return { ok: false, error: 'frame is not text' }
  if (new TextEncoder().encode(text).length > MAX_MESSAGE_BYTES) return { ok: false, error: 'frame too large' }
  let json: unknown
  try { json = JSON.parse(text) } catch { return { ok: false, error: 'invalid JSON' } }
  const r = schema.safeParse(json)
  return r.success ? { ok: true, value: r.data } : { ok: false, error: r.error.issues[0]?.message ?? 'invalid message' }
}
export const parseHandshake = (raw: unknown) => parseWith(HandshakeMessage, raw)
export const parseClient = (raw: unknown) => parseWith(ClientMessage, raw)
export const parseServer = (raw: unknown) => parseWith(ServerMessage, raw)
export const parseControlInput = (raw: unknown) => parseWith(ControlInput, raw)

// ---------------------------------------------------------------------------
// Session code: 8 chars from a 32-symbol alphabet (40 bits), shown as XXXX-XXXX.
// No 0/O/1/I so it survives being read aloud in a classroom. Exactly 32 symbols, so `byte & 31` is uniform.
// ---------------------------------------------------------------------------
export const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
export const CODE_LENGTH = 8
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '')
}
export function isValidCode(input: string): boolean {
  const c = normalizeCode(input)
  return c.length === CODE_LENGTH && [...c].every((ch) => CODE_ALPHABET.includes(ch))
}
export const formatCode = (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`

// ---------------------------------------------------------------------------
// Coordinates: pointer on screen -> normalized coordinates over the shown picture.
// ---------------------------------------------------------------------------
export interface Rect { x: number; y: number; w: number; h: number }
/**
 * Maps a pointer position (client px) inside `box` to normalized coords of a video of
 * `videoW`x`videoH` rendered with object-fit: contain (letterboxed). Null over the letterbox bars.
 */
export function mapPointToVideo(px: number, py: number, box: Rect, videoW: number, videoH: number): { x: number; y: number } | null {
  if (box.w <= 0 || box.h <= 0 || videoW <= 0 || videoH <= 0) return null
  const scale = Math.min(box.w / videoW, box.h / videoH)
  const dw = videoW * scale, dh = videoH * scale
  const ox = box.x + (box.w - dw) / 2, oy = box.y + (box.h - dh) / 2
  const x = (px - ox) / dw, y = (py - oy) / dh
  if (x < 0 || x > 1 || y < 0 || y > 1) return null
  return { x, y }
}
