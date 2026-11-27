/**
 * TCP video relay: the "always works" path for screen video.
 *
 * WebRTC sends video over UDP on dynamic ports. When a firewall (Windows, an antivirus, a switch ACL) lets the
 * meeting's TCP port through but not that UDP, the meeting works and the picture stays black. This module moves
 * the picture of that ONE link into the encrypted WebSocket the meeting already uses (TCP 47800): if a PC could
 * join, it can see.
 *
 * Built for latency, like remote-desktop tools:
 *  - Capture frames come straight from the track (MediaStreamTrackProcessor): the GPU capturer's frames, no canvas copy.
 *  - WebCodecs encoder with hardwareAcceleration 'prefer-hardware' (NVENC, Quick Sync or AMF through Media
 *    Foundation) and latencyMode 'realtime'. WebCodecs never emits B-frames in realtime mode.
 *  - Late frames are DROPPED, never queued: the encoder skips a frame when it is behind, the main process skips
 *    a frame when the socket is backed up, and the decoder skips to the next key frame when it falls behind.
 *    A key frame every 2 s (or right after any drop) repairs the picture.
 *
 * Encoded frame between window and main process: [codec u8][flags u8][width u16][height u16][pad u16][timestamp f64][data]
 */

export const FRAME_HEADER = 16
/** Codec ids on the wire, and the WebCodecs string each one decodes with. */
export const CODECS: Record<number, string> = { 1: 'avc1.640033', 2: 'avc1.42e033', 3: 'vp8' }
const KEY_EVERY_MS = 2000

// Chromium exposes these in windows; lib.dom does not type them yet.
declare const MediaStreamTrackProcessor: { new (init: { track: MediaStreamTrack; maxBufferSize?: number }): { readable: ReadableStream<VideoFrame> } } | undefined
declare const MediaStreamTrackGenerator: { new (init: { kind: 'video' }): MediaStreamTrack & { writable: WritableStream<VideoFrame> } } | undefined

export function packFrame(codec: number, key: boolean, width: number, height: number, timestamp: number, data: Uint8Array | null, size = data?.length ?? 0): Uint8Array {
  const buf = new Uint8Array(FRAME_HEADER + size)
  const v = new DataView(buf.buffer)
  v.setUint8(0, codec); v.setUint8(1, key ? 1 : 0); v.setUint16(2, width); v.setUint16(4, height); v.setFloat64(8, timestamp)
  if (data) buf.set(data, FRAME_HEADER)
  return buf
}
export function unpackFrame(buf: Uint8Array) {
  if (buf.length < FRAME_HEADER) return null
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  return { codec: v.getUint8(0), key: (v.getUint8(1) & 1) === 1, width: v.getUint16(2), height: v.getUint16(4), timestamp: v.getFloat64(8), data: buf.subarray(FRAME_HEADER) }
}

export const relaySupported = () =>
  typeof VideoEncoder === 'function' && typeof VideoDecoder === 'function' && typeof MediaStreamTrackProcessor === 'function'

/** Encoder choices, best first: hardware H.264 High, hardware Baseline, any H.264, VP8 (software, always there). */
const ENCODERS: { id: number; hw: HardwareAcceleration }[] = [
  { id: 1, hw: 'prefer-hardware' }, { id: 2, hw: 'prefer-hardware' }, { id: 2, hw: 'no-preference' }, { id: 3, hw: 'no-preference' }
]

/** Sends one video track over the relay. `send` resolves false when the frame was dropped on the way. */
export class RelaySender {
  private track: MediaStreamTrack | null = null
  private gen = 0
  private reader: ReadableStreamDefaultReader<VideoFrame> | null = null
  private enc: VideoEncoder | null = null
  private cfg = ''
  private codec = 0
  private size = { w: 0, h: 0 }
  private needKey = true
  private lastKey = 0
  private lastFrame = 0
  private failedAt = new Set<string>()

  constructor(private send: (frame: Uint8Array) => Promise<boolean>, private limits: () => { bitrate: number; fps: number }) {}

  setTrack(t: MediaStreamTrack | null) {
    if (t === this.track) return
    this.stop()
    this.track = t
    if (t) void this.pump(t, ++this.gen)
  }

  private async pump(track: MediaStreamTrack, gen: number) {
    if (typeof MediaStreamTrackProcessor !== 'function') return
    // maxBufferSize 1: if we are slow, the processor keeps only the newest frame.
    const reader = (this.reader = new MediaStreamTrackProcessor({ track, maxBufferSize: 1 }).readable.getReader())
    try {
      for (;;) {
        const { value: frame, done } = await reader.read()
        if (done || !frame) break
        if (gen !== this.gen) { frame.close(); break }
        try { await this.encode(frame) } catch (e) { console.warn('[relay] encode', e) } finally { frame.close() }
      }
    } catch { /* track ended or reader cancelled */ }
  }

  private async encode(frame: VideoFrame) {
    const { bitrate, fps } = this.limits()
    const now = performance.now()
    if (now - this.lastFrame < 1000 / fps - 2) return // pacing: never more than the allowed frame rate
    const w = frame.displayWidth & ~1, h = frame.displayHeight & ~1 // H.264 needs even sizes
    if (w < 2 || h < 2) return
    const cfg = `${w}x${h}/${bitrate}/${fps}`
    if (!this.enc || this.enc.state === 'closed' || cfg !== this.cfg) { await this.configure(w, h, bitrate, fps); this.cfg = cfg }
    const enc = this.enc
    if (!enc || enc.state !== 'configured') return
    if (enc.encodeQueueSize > 1) { this.needKey = true; return } // the encoder is behind: drop, do not queue
    this.lastFrame = now
    const keyFrame = this.needKey || now - this.lastKey > KEY_EVERY_MS
    if (keyFrame) { this.needKey = false; this.lastKey = now }
    enc.encode(frame, { keyFrame })
  }

  private async configure(width: number, height: number, bitrate: number, framerate: number) {
    for (const c of ENCODERS) {
      const name = `${c.id}/${c.hw}`
      if (this.failedAt.has(name)) continue
      const config: VideoEncoderConfig = {
        codec: CODECS[c.id], width, height, bitrate, framerate, hardwareAcceleration: c.hw, latencyMode: 'realtime', bitrateMode: 'variable',
        ...(c.id !== 3 ? { avc: { format: 'annexb' as const } } : {})
      }
      try { if (!(await VideoEncoder.isConfigSupported(config)).supported) continue } catch { continue }
      // Same codec: reconfigure in place (new size or bitrate). Otherwise a fresh encoder.
      if (!this.enc || this.enc.state === 'closed' || this.codec !== c.id) {
        try { this.enc?.close() } catch { /* already closed */ }
        const id = c.id
        this.enc = new VideoEncoder({
          output: (chunk) => {
            const buf = packFrame(id, chunk.type === 'key', this.size.w, this.size.h, chunk.timestamp, null, chunk.byteLength)
            chunk.copyTo(buf.subarray(FRAME_HEADER))
            void this.send(buf).then((ok) => { if (!ok) this.needKey = true })
          },
          // A hardware encoder that dies mid-stream (driver reset, too many sessions): next one down the list.
          error: (e) => { console.warn('[relay] encoder error', e); this.failedAt.add(name); this.cfg = ''; this.enc = null }
        })
      }
      try { this.enc.configure(config) } catch { this.failedAt.add(name); continue }
      this.codec = c.id; this.size = { w: width, h: height }; this.needKey = true
      return
    }
    this.enc = null
  }

  stop() {
    this.gen++
    void this.reader?.cancel().catch(() => {}); this.reader = null
    try { this.enc?.close() } catch { /* already closed */ }
    this.enc = null; this.cfg = ''; this.track = null; this.needKey = true
  }
}

/** Turns relayed frames back into a MediaStreamTrack the rest of the app uses like any WebRTC track. */
export class RelayReceiver {
  readonly track: MediaStreamTrack
  private writer: WritableStreamDefaultWriter<VideoFrame> | null = null
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private dec: VideoDecoder | null = null
  private codec = 0
  private waitKey = true
  private software = false
  /** Frames shown so far: lets the watchdog see the relay itself working. */
  frames = 0

  constructor() {
    if (typeof MediaStreamTrackGenerator === 'function') {
      const g = new MediaStreamTrackGenerator({ kind: 'video' })
      this.writer = g.writable.getWriter()
      this.track = g
    } else {
      this.canvas = document.createElement('canvas'); this.canvas.width = 16; this.canvas.height = 9
      this.ctx = this.canvas.getContext('2d')
      this.track = this.canvas.captureStream().getVideoTracks()[0]
    }
  }

  push(buf: Uint8Array) {
    const f = unpackFrame(buf)
    if (!f || !CODECS[f.codec]) return
    if (this.waitKey && !f.key) return
    if (!this.dec || this.dec.state === 'closed' || f.codec !== this.codec) {
      if (!f.key) { this.waitKey = true; return }
      this.configure(f.codec)
    }
    const dec = this.dec!
    // Behind (slow PC, burst): throw the backlog away and start again at this key frame, or wait for the next one.
    if (dec.decodeQueueSize > 2) {
      if (!f.key) { this.waitKey = true; return }
      try { dec.reset() } catch { /* closed */ }
      this.configure(f.codec)
    }
    try {
      this.dec!.decode(new EncodedVideoChunk({ type: f.key ? 'key' : 'delta', timestamp: f.timestamp, data: f.data }))
      this.waitKey = false
    } catch { this.waitKey = true }
  }

  private configure(codec: number) {
    if (!this.dec || this.dec.state === 'closed') {
      this.dec = new VideoDecoder({
        output: (frame) => this.show(frame),
        // A GPU decoder that fails (old driver: the classic black picture) is replaced by the software one.
        error: (e) => { console.warn('[relay] decoder error', e); this.software = true; this.waitKey = true; this.dec = null }
      })
    }
    this.dec.configure({ codec: CODECS[codec], optimizeForLatency: true, hardwareAcceleration: this.software ? 'prefer-software' : 'no-preference' })
    this.codec = codec
  }

  private show(frame: VideoFrame) {
    this.frames++
    if (this.writer) {
      // The generator owns the frame once written. If it is still busy with the previous one, this one is late: drop it.
      if ((this.writer.desiredSize ?? 1) <= 0) { frame.close(); return }
      void this.writer.write(frame).catch(() => frame.close())
      return
    }
    const c = this.canvas!
    if (c.width !== frame.displayWidth || c.height !== frame.displayHeight) { c.width = frame.displayWidth; c.height = frame.displayHeight }
    this.ctx?.drawImage(frame, 0, 0)
    frame.close()
  }

  close() {
    try { this.dec?.close() } catch { /* closed */ }
    this.dec = null
    void this.writer?.close().catch(() => {})
    this.track.stop()
  }
}
