import { z } from 'zod'

export const PROTOCOL_VERSION = 1
/** Hard cap for any signaling frame (SDP is the largest, ~10 KB). */
export const MAX_MESSAGE_BYTES = 64 * 1024

const str = (max: number) => z.string().min(1).max(max)
const unit = z.number().min(0).max(1)

// ---- Signaling channel (WebSocket, JSON text frames) ----
export const Hello = z.object({
  t: z.literal('hello'),
  v: z.literal(PROTOCOL_VERSION),
  /** Absent = discovery pairing (no QR): allowed only while the desktop has open pairing, always needs manual approval. */
  token: str(64).optional(),
  deviceId: str(64),
  name: str(64),
  model: str(64)
})
export const HelloAck = z.object({
  t: z.literal('hello-ack'),
  status: z.enum(['pending', 'approved', 'rejected']),
  sessionId: str(64).optional(),
  reason: str(200).optional()
})
/** `sig` = HMAC-SHA256(token, sdp), hex. Binds the DTLS fingerprint in the SDP to the QR secret. */
export const Offer = z.object({ t: z.literal('offer'), sdp: str(32768), sig: str(64) })
export const Answer = z.object({ t: z.literal('answer'), sdp: str(32768), sig: str(64) })
export const Ice = z.object({
  t: z.literal('ice'),
  candidate: z.string().max(1024),
  sdpMid: z.string().max(64).nullable().optional(),
  sdpMLineIndex: z.number().int().min(0).max(8).nullable().optional()
})
export const Bye = z.object({ t: z.literal('bye'), reason: str(200).optional() })

export const SignalMessage = z.discriminatedUnion('t', [Hello, HelloAck, Offer, Answer, Ice, Bye])
export type SignalMessage = z.infer<typeof SignalMessage>

// ---- Control channel (WebRTC DataChannel "control", JSON) ----
// Coordinates are normalized 0..1 over the device screen in its CURRENT orientation.
export const Pointer = z.object({
  t: z.literal('pointer'),
  action: z.enum(['down', 'move', 'up', 'cancel']),
  id: z.number().int().min(0).max(9),
  x: unit,
  y: unit
})
export const Scroll = z.object({ t: z.literal('scroll'), x: unit, y: unit, dx: z.number().min(-1).max(1), dy: z.number().min(-1).max(1) })
export const Key = z.object({ t: z.literal('key'), key: z.enum(['back', 'home', 'recents']) })
export const Text = z.object({ t: z.literal('text'), text: z.string().max(500) })
export const ControlMessage = z.discriminatedUnion('t', [Pointer, Scroll, Key, Text])
export type ControlMessage = z.infer<typeof ControlMessage>

/** Device → desktop over the same DataChannel. */
export const DeviceInfo = z.object({
  t: z.literal('info'),
  width: z.number().int().min(1).max(8192),
  height: z.number().int().min(1).max(8192),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  controlEnabled: z.boolean()
})
export type DeviceInfo = z.infer<typeof DeviceInfo>

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
export const parseSignal = (raw: unknown) => parseWith(SignalMessage, raw)
export const parseControl = (raw: unknown) => parseWith(ControlMessage, raw)
export const parseDeviceInfo = (raw: unknown) => parseWith(DeviceInfo, raw)

// ---- Pairing payload ----
/** Payload encoded in the desktop's QR code. */
export const PairingPayload = z.object({
  v: z.literal(PROTOCOL_VERSION),
  host: str(64), port: z.number().int().min(1).max(65535),
  token: str(64), name: str(64)
})
export type PairingPayload = z.infer<typeof PairingPayload>

// ---- Coordinates: pointer on screen → normalized device coordinates ----
export interface Rect { x: number; y: number; w: number; h: number }
/**
 * Maps a pointer position (client px) inside `box` to normalized device coords,
 * for a video of `videoW`x`videoH` rendered with object-fit: contain (letterboxed)
 * and an optional canvas `zoom` already applied to `box` (pass the on-screen box).
 * Returns null when the pointer is over the letterbox bars.
 * The device reports its own rotation inside the stream, so the video already shows the
 * rotated screen: normalized coords are over the displayed picture; no extra rotation is needed.
 */
export function mapPointToDevice(px: number, py: number, box: Rect, videoW: number, videoH: number): { x: number; y: number } | null {
  if (box.w <= 0 || box.h <= 0 || videoW <= 0 || videoH <= 0) return null
  const scale = Math.min(box.w / videoW, box.h / videoH)
  const dw = videoW * scale, dh = videoH * scale
  const ox = box.x + (box.w - dw) / 2, oy = box.y + (box.h - dh) / 2
  const x = (px - ox) / dw, y = (py - oy) / dh
  if (x < 0 || x > 1 || y < 0 || y > 1) return null
  return { x, y }
}
