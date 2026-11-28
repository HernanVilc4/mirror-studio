import { z } from 'zod'

/**
 * 4: TCP video relay (media-mode + binary media frames).
 * 5: phones (device + caps in hello), pairing, slides, pointer/ink, chat, raised hands, polls, files (FILE_TAG frames).
 */
export const PROTOCOL_VERSION = 5
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
export const Device = z.enum(['pc', 'phone'])
export type Device = z.infer<typeof Device>
/** relay: plays the TCP video relay (WebCodecs); camera: can present a camera; overlay: draws pointer/ink; files: file transfer. */
export const Cap = z.enum(['relay', 'camera', 'overlay', 'files'])
export type Cap = z.infer<typeof Cap>
export const PC_CAPS: Cap[] = ['relay', 'overlay', 'files']
export const PHONE_CAPS: Cap[] = ['camera', 'files']
export const Hello = z.object({
  t: z.literal('hello'), v: z.literal(PROTOCOL_VERSION),
  /** X25519 public key and nonce, base64. */
  pub: str(64), nonce: str(64), name: str(64),
  device: Device,
  caps: z.array(Cap).max(8)
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
  id, name: str(64), role: z.enum(ROLES), host: z.boolean().optional(),
  device: Device,
  /** Place in the raised-hands queue (1 = first), null = hand down. */
  hand: z.number().int().min(1).nullable(),
  /** The phone paired with this PC, or the PC paired with this phone. */
  pairedWith: id.nullable()
})
export type Participant = z.infer<typeof Participant>
export const ControlGrant = z.object({ controller: id, target: id })
export type ControlGrant = z.infer<typeof ControlGrant>
/** Who may write text (chat) or share links/files (share): everyone, participants only towards teachers, or teachers only. */
export const Audience = z.enum(['all', 'teachers', 'off'])
export type Audience = z.infer<typeof Audience>
export const RoomSettings = z.object({ chat: Audience, share: Audience, locked: z.boolean() })
export type RoomSettings = z.infer<typeof RoomSettings>
export const DEFAULT_SETTINGS: RoomSettings = { chat: 'all', share: 'all', locked: false }
export const PresentSource = z.enum(['screen', 'window', 'camera'])
export type PresentSource = z.infer<typeof PresentSource>
export const SessionState = z.object({
  sessionId: id, name: str(64),
  participants: z.array(Participant).max(MAX_PARTICIPANTS),
  presenter: id.nullable(),
  /** What the presenter shows; null when nobody presents. */
  presenterSource: PresentSource.nullable(),
  controls: z.array(ControlGrant).max(MAX_PARTICIPANTS),
  settings: RoomSettings
})
export type SessionState = z.infer<typeof SessionState>

// ---------------------------------------------------------------------------
// Classroom features (v5). See docs/movil/DECISIONES.md, sections 3 to 10.
// ---------------------------------------------------------------------------
/** Pairing token: 16 random bytes, base64url without padding (22 chars), single use. */
export const PAIR_TOKEN_TTL_MS = 2 * 60_000
export const SlideAction = z.enum(['next', 'prev', 'first', 'last', 'black', 'white', 'start', 'end'])
export type SlideAction = z.infer<typeof SlideAction>
export const InkColor = z.enum(['red', 'blue', 'yellow', 'black'])
export const InkWidth = z.union([z.literal(1), z.literal(2), z.literal(3)])
export const InkTool = z.enum(['pen', 'highlighter'])
export const INK_MAX_POINTS = 32
const inkStroke = z.number().int().min(0).max(0x7fffffff)
const inkPoints = z.array(z.tuple([unit, unit])).max(INK_MAX_POINTS)

/** Chat destination: everyone, only teachers (and above), or chosen people (teachers and above only). */
export const MsgTo = z.union([z.literal('all'), z.literal('teachers'), z.array(id).min(1).max(MAX_PARTICIPANTS)])
export type MsgTo = z.infer<typeof MsgTo>
/** File ids are assigned by the host and also travel as u32 in FILE_TAG frames; kept below 2^31 for Kotlin's Int. */
export const FileId = z.number().int().min(1).max(0x7fffffff)
const MAX_FILE_NAME = 200
const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/)
const textBody = z.object({ kind: z.literal('text'), text: str(1000) })
const questionBody = z.object({ kind: z.literal('question'), text: str(1000) })
const linkBody = z.object({ kind: z.literal('link'), url: str(2000), title: str(120).optional() })
const pollBody = z.object({ kind: z.literal('poll'), pollId: id })
export const MsgBody = z.discriminatedUnion('kind', [textBody, questionBody, linkBody, z.object({ kind: z.literal('file'), fileId: FileId }), pollBody])
export type MsgBody = z.infer<typeof MsgBody>
/** What the host distributes: a file body also carries what receivers need to show it before downloading. */
export const MsgBodyOut = z.discriminatedUnion('kind', [
  textBody, questionBody, linkBody,
  z.object({ kind: z.literal('file'), fileId: FileId, name: str(MAX_FILE_NAME), size: z.number().int().min(1), mime: str(100) }),
  pollBody
])
export type MsgBodyOut = z.infer<typeof MsgBodyOut>
/**
 * One chat item. `from` is null only on a question a teacher showed to everyone anonymously (as seen by the
 * others; teachers and the author still get the id). `at`: host clock, ms since the epoch.
 */
export const Msg = z.object({
  t: z.literal('msg'), id, from: id.nullable(), at: z.number().int().min(0), to: MsgTo, body: MsgBodyOut,
  answered: z.boolean().optional(), shown: z.boolean().optional()
})
export type Msg = z.infer<typeof Msg>
export const MSG_HISTORY = 200
export const PollResults = z.enum(['live', 'on-close'])
export const POLL_MAX_OPTIONS = 6
/** Distinct voters one poll accepts. */
export const POLL_MAX_VOTERS = 100
const pollChoices = z.array(z.number().int().min(0).max(POLL_MAX_OPTIONS - 1)).min(1).max(POLL_MAX_OPTIONS)

export const MAX_FILE_BYTES = 50 * 1024 * 1024
export const MAX_MEETING_FILE_BYTES = 200 * 1024 * 1024
export const BLOCKED_EXTENSIONS = [
  '.exe', '.msi', '.bat', '.cmd', '.ps1', '.vbs', '.js', '.jse', '.wsf', '.scr', '.com', '.lnk', '.reg', '.jar', '.hta', '.cpl', '.dll', '.apk'
] as const
/** True when the name ends in a blocked extension (case-insensitive; trailing dots and spaces ignored, as Windows does). */
export function blockedFileName(name: string): boolean {
  const n = name.toLowerCase().replace(/[. ]+$/, '')
  return BLOCKED_EXTENSIONS.some((e) => n.endsWith(e))
}
/** A file name must be a plain name: no path separators, drive colon or control characters. */
export const validFileName = (name: string) => !/[\\/:\u0000-\u001f]/.test(name) && name.trim() !== '' && name !== '.' && name !== '..'
/** Only http: and https: links travel in the chat. */
export function isSafeLink(url: string): boolean {
  try { const u = new URL(url); return u.protocol === 'http:' || u.protocol === 'https:' } catch { return false }
}

// Client -> host. No microphone: everyone is in the same room. Audio is the presenter's PC sound, sent with the screen.
export const Kick = z.object({ t: z.literal('kick'), target: id })
export const SetRole = z.object({ t: z.literal('set-role'), target: id, role: AssignableRole })
export const PresentStart = z.object({ t: z.literal('present-start'), source: PresentSource.default('screen') })
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
/** Pairing (section 3). Only a PC creates a token, only a phone claims it. */
export const PairCreate = z.object({ t: z.literal('pair-create') })
export const PairClaim = z.object({ t: z.literal('pair-claim'), token: str(32) })
export const PairEnd = z.object({ t: z.literal('pair-end') })
/** From a paired phone; the host forwards it only to that phone's PC. */
export const Slide = z.object({ t: z.literal('slide'), action: SlideAction })
/** Optional (phase 2, PowerPoint only): from a PC to its paired phone. `index` is 1-based. */
const slideState = {
  index: z.number().int().min(1).max(100_000), total: z.number().int().min(1).max(100_000),
  nextTitle: z.string().max(200).optional(), notes: z.string().max(2000).optional()
}
export const SlideState = z.object({ t: z.literal('slide-state'), ...slideState })
/** Laser pointer and ink, normalized over what is presented. From the presenter or its paired phone. */
export const Pointer = z.object({ t: z.literal('pointer'), x: unit, y: unit, on: z.boolean() })
export const Ink = z.object({
  t: z.literal('ink'), stroke: inkStroke, points: inkPoints,
  color: InkColor, width: InkWidth, tool: InkTool, done: z.boolean()
})
export const InkUndo = z.object({ t: z.literal('ink-undo') })
export const InkClear = z.object({ t: z.literal('ink-clear') })
/** Chat (section 6). The host assigns id, from and at. */
export const MsgSend = z.object({ t: z.literal('msg-send'), to: MsgTo, body: MsgBody })
export const MsgDelete = z.object({ t: z.literal('msg-delete'), id })
export const MsgMark = z.object({ t: z.literal('msg-mark'), id, answered: z.boolean() })
export const MsgShow = z.object({ t: z.literal('msg-show'), id, anonymous: z.boolean() })
export const RoomSettingsMsg = z.object({ t: z.literal('room-settings'), chat: Audience, share: Audience, locked: z.boolean() })
export const MuteChat = z.object({ t: z.literal('mute-chat'), target: id, on: z.boolean() })
/** Raised hand (section 7). `text` is an optional question, delivered only to teachers. */
export const Hand = z.object({ t: z.literal('hand'), up: z.boolean(), text: str(200).optional() })
export const HandLower = z.object({ t: z.literal('hand-lower'), target: id })
/** Polls (section 8). */
export const PollCreate = z.object({
  t: z.literal('poll-create'), question: str(300),
  options: z.array(str(100)).min(2).max(POLL_MAX_OPTIONS),
  multi: z.boolean(), anonymous: z.boolean(), showResults: PollResults
})
export const PollVote = z.object({ t: z.literal('poll-vote'), pollId: id, choices: pollChoices })
export const PollClose = z.object({ t: z.literal('poll-close'), pollId: id })
/** Files (section 9): offer, then FILE_TAG chunks; receivers ask with file-get. */
export const FileOffer = z.object({
  t: z.literal('file-offer'), name: str(MAX_FILE_NAME),
  size: z.number().int().min(1).max(MAX_FILE_BYTES), sha256: sha256Hex, mime: str(100)
})
export const FileGet = z.object({ t: z.literal('file-get'), fileId: FileId })
export const ClientMessage = z.discriminatedUnion('t', [
  Kick, SetRole, PresentStart, PresentStop,
  ControlRequest, ControlRespond, ControlRevoke, ControlSend, ControlStatus, ControlReset, Rtc, MediaMode, Leave,
  PairCreate, PairClaim, PairEnd, Slide, SlideState, Pointer, Ink, InkUndo, InkClear,
  MsgSend, MsgDelete, MsgMark, MsgShow, RoomSettingsMsg, MuteChat, Hand, HandLower,
  PollCreate, PollVote, PollClose, FileOffer, FileGet
])
/** What a client sends (`present-start` may omit `source`). The host also takes this unparsed from its own window. */
export type ClientMessage = z.input<typeof ClientMessage>
/** A client message after parsing, with defaults filled in. */
export type ClientMessageParsed = z.infer<typeof ClientMessage>

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
/** Only to the PC that asked. `expiresAt`: host clock, ms since the epoch. */
export const PairToken = z.object({ t: z.literal('pair-token'), token: str(32), expiresAt: z.number().int().min(0) })
export const SlideIn = z.object({ t: z.literal('slide'), from: id, action: SlideAction })
export const SlideStateIn = z.object({ t: z.literal('slide-state'), from: id, ...slideState })
export const PointerIn = z.object({ t: z.literal('pointer'), from: id, x: unit, y: unit, on: z.boolean() })
export const InkIn = z.object({
  t: z.literal('ink'), from: id, stroke: inkStroke, points: inkPoints,
  color: InkColor, width: InkWidth, tool: InkTool, done: z.boolean()
})
export const InkUndoIn = z.object({ t: z.literal('ink-undo'), from: id })
export const InkClearIn = z.object({ t: z.literal('ink-clear'), from: id })
/** Sent right after `welcome`, possibly split over several frames so each stays under MAX_MESSAGE_BYTES. */
export const MsgHistory = z.object({ t: z.literal('msg-history'), items: z.array(Msg).max(MSG_HISTORY) })
/** A message was removed; `by` is who removed it (its author, or a teacher). */
export const MsgDeleted = z.object({ t: z.literal('msg-delete'), id, by: id })
export const PollState = z.object({
  t: z.literal('poll-state'), pollId: id, question: str(300),
  options: z.array(str(100)).min(2).max(POLL_MAX_OPTIONS),
  multi: z.boolean(), anonymous: z.boolean(), showResults: PollResults, closed: z.boolean(),
  /** Votes per option. Always to the poll's creator; to the others live or once closed, per showResults. */
  counts: z.array(z.number().int().min(0)).max(POLL_MAX_OPTIONS).optional(),
  /** Only to the creator, and only when the poll is not anonymous. */
  voters: z.array(z.object({ id, choices: pollChoices })).max(POLL_MAX_VOTERS).optional(),
  /** People who voted. */
  total: z.number().int().min(0)
})
export const FileAccept = z.object({ t: z.literal('file-accept'), fileId: FileId })
/** Announces the FILE_TAG chunks of a download. */
export const FileMeta = z.object({ t: z.literal('file-meta'), fileId: FileId, name: str(MAX_FILE_NAME), size: z.number().int().min(1), sha256: sha256Hex })
export const ServerMessage = z.discriminatedUnion('t', [
  Welcome, StateMsg, ControlAsked, ControlStarted, ControlEnded, ControlInputIn, ControlStatusIn, ControlResetIn, Notice, Closed, Rtc, MediaMode,
  PairToken, SlideIn, SlideStateIn, PointerIn, InkIn, InkUndoIn, InkClearIn, Msg, MsgHistory, MsgDeleted, PollState, FileAccept, FileMeta
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

// ---------------------------------------------------------------------------
// Binary file chunks (section 9), sealed like every other frame:
//   [FILE_TAG u8][fileId u32][index u32][count u32][payload]   (big-endian, 13-byte header)
// Every chunk but the last carries exactly FILE_CHUNK bytes; count = ceil(size / FILE_CHUNK), in order.
// Client -> host: an upload accepted with file-accept. Host -> client: a download announced with file-meta.
// ---------------------------------------------------------------------------
export const FILE_TAG = 0x02
export const FILE_CHUNK = 48 * 1024
export const FILE_HEADER = 13
export const fileChunkCount = (size: number) => Math.max(1, Math.ceil(size / FILE_CHUNK))

export function encodeFileChunk(fileId: number, index: number, count: number, payload: Uint8Array): Uint8Array {
  if (payload.length > FILE_CHUNK) throw new Error('file chunk too large')
  const p = new Uint8Array(FILE_HEADER + payload.length)
  const v = new DataView(p.buffer)
  v.setUint8(0, FILE_TAG); v.setUint32(1, fileId >>> 0); v.setUint32(5, index >>> 0); v.setUint32(9, count >>> 0)
  p.set(payload, FILE_HEADER)
  return p
}
export interface FileChunk { fileId: number; index: number; count: number; payload: Uint8Array }
/** Null on a malformed chunk: wrong tag, short header, fileId 0, count 0 or too big, index >= count, oversize payload. */
export function parseFileChunk(frame: Uint8Array): FileChunk | null {
  if (frame.length < FILE_HEADER || frame[0] !== FILE_TAG || frame.length - FILE_HEADER > FILE_CHUNK) return null
  const v = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
  const fileId = v.getUint32(1), index = v.getUint32(5), count = v.getUint32(9)
  if (fileId === 0 || count === 0 || index >= count || count > fileChunkCount(MAX_FILE_BYTES)) return null
  return { fileId, index, count, payload: frame.subarray(FILE_HEADER) }
}

export type ParseResult<T> ={ ok: true; value: T } | { ok: false; error: string }

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
export const parseClient = (raw: unknown) => parseWith<ClientMessageParsed>(ClientMessage, raw)
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
