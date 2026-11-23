import { z } from 'zod'

export const PROTOCOL_VERSION = 2
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

/** Who may present their screen and ask to control another PC. */
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
  t: z.literal('info-reply'), v: z.literal(PROTOCOL_VERSION),
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
/** WebRTC signaling between a participant and the host's media hub. */
export const Rtc = z.object({
  t: z.literal('rtc'),
  kind: z.enum(['offer', 'answer', 'ice']),
  data: z.string().max(32768)
})
export const Leave = z.object({ t: z.literal('leave') })
export const ClientMessage = z.discriminatedUnion('t', [
  Kick, SetRole, PresentStart, PresentStop,
  ControlRequest, ControlRespond, ControlRevoke, ControlSend, Rtc, Leave
])
export type ClientMessage = z.infer<typeof ClientMessage>

// Host -> client
export const Welcome = z.object({ t: z.literal('welcome'), you: id, state: SessionState })
export const StateMsg = z.object({ t: z.literal('state'), state: SessionState })
export const ControlAsked = z.object({ t: z.literal('control-asked'), controller: id, name: str(64) })
export const ControlStarted = z.object({ t: z.literal('control-started'), controller: id, target: id })
export const ControlEnded = z.object({ t: z.literal('control-ended'), controller: id, target: id, reason: str(120) })
export const ControlInputIn = z.object({ t: z.literal('control-input'), from: id, input: ControlInput })
export const Notice = z.object({ t: z.literal('notice'), text: str(200) })
export const Closed = z.object({ t: z.literal('closed'), reason: str(200) })
export const ServerMessage = z.discriminatedUnion('t', [
  Welcome, StateMsg, ControlAsked, ControlStarted, ControlEnded, ControlInputIn, Notice, Closed, Rtc
])
export type ServerMessage = z.infer<typeof ServerMessage>

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
