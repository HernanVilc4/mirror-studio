import type { SessionState } from '@mirror-studio/protocol'
import { RelayReceiver, RelaySender, relaySupported } from './media-relay'

/**
 * Media topology: every participant keeps ONE RTCPeerConnection to the host's hub (no peer-to-peer mesh).
 * There is NO microphone: everyone is in the same room. What travels is the presenter's screen and the
 * sound of the presenter's PC. Each connection has the same four transceivers, in this order, so both ends
 * agree without negotiating roles:
 *   0 audio    sendrecv  : my PC's sound out (while I present), the presenter's PC sound in
 *   1 present  recvonly  : the presenter's screen
 *   2 control  recvonly  : the screen of the PC I am controlling
 *   3 screen   sendonly  : my own screen (presentation or control)
 * Switching who is shown only calls replaceTrack(), so nothing is renegotiated.
 *
 * Two transports per link, chosen automatically:
 *  - WebRTC (UDP, the fast path). Video prefers H.264, which Chromium encodes on the GPU (NVENC, Quick Sync,
 *    AMF via Media Foundation) instead of VP8 on the CPU. Receivers ask for the smallest jitter buffer.
 *  - TCP relay (media-relay.ts) inside the meeting's encrypted WebSocket. A watchdog switches a link to it when
 *    WebRTC does not connect or no frames get decoded: the black-screen case, usually a firewall dropping UDP.
 *    Audio stays on WebRTC (if UDP is blocked, the PC sound is lost but the picture is not).
 *
 * Honest limit: the hub re-encodes video once per viewer inside Chromium; it is not a true SFU. The caps
 * below keep that affordable (measured on a 12-core dev PC: 35 viewers ~ 37% of one core, see HANDOFF.md),
 * but a lab PC must be measured too.
 */
// Quality adapts to the audience: the host spends a fixed outbound budget, split among viewers. A remote-control
// session or a small room gets up to 12 Mbps at 60 fps; a full 35-person room falls back to 2.5 Mbps / 15 fps.
export const VIDEO_MIN_BITRATE = 2_500_000
export const VIDEO_MAX_BITRATE = 12_000_000
const VIDEO_BUDGET = 80_000_000 // bits/s of video the host may send in total: fits Gigabit, not 100 Mbps links
export function videoLimits(viewers: number) {
  const bitrate = Math.round(Math.min(VIDEO_MAX_BITRATE, Math.max(VIDEO_MIN_BITRATE, VIDEO_BUDGET / Math.max(1, viewers))))
  return { bitrate, fps: viewers <= 3 ? 60 : viewers <= 8 ? 30 : 15 }
}
const ICE = { iceServers: [] as RTCIceServer[] } // LAN only: no STUN/TURN

/** WebRTC never connected after this long: switch the link to the TCP relay. */
export const CONNECT_TIMEOUT_MS = 5000
/** Connected, but a picture we expect decodes no frame for this long: switch too. */
export const STALL_MS = 6000

type Rtc = (kind: 'offer' | 'answer' | 'ice', data: string) => void

/**
 * H.264 first (hardware encode and decode almost everywhere), High before Constrained Baseline, then VP8/VP9 as
 * the fallback Chromium can always do in software. RTX/RED/FEC entries keep their place after the codecs.
 */
function preferH264(t: RTCRtpTransceiver) {
  try {
    const caps = RTCRtpReceiver.getCapabilities('video')?.codecs
    if (!caps?.length || !t.setCodecPreferences) return
    const score = (c: RTCRtpCodec) => {
      const fmtp = c.sdpFmtpLine ?? ''
      if (c.mimeType === 'video/H264') return (/packetization-mode=1/.test(fmtp) ? 0 : 2) + (/profile-level-id=64/i.test(fmtp) ? 0 : 1)
      if (c.mimeType === 'video/VP8') return 4
      if (c.mimeType === 'video/VP9') return 5
      if (c.mimeType === 'video/AV1') return 6
      return 9 // rtx, red, ulpfec, flexfec
    }
    t.setCodecPreferences([...caps].sort((a, b) => score(a) - score(b)))
  } catch { /* the default order still works */ }
}

/** Smallest jitter buffer: on a LAN, showing the newest frame now beats smoothing over a network that does not jitter. */
function lowLatency(r: RTCRtpReceiver) {
  const x = r as RTCRtpReceiver & { jitterBufferTarget?: number | null; playoutDelayHint?: number }
  try { x.jitterBufferTarget = 0 } catch { /* not supported */ }
  try { x.playoutDelayHint = 0 } catch { /* not supported */ }
}

function addFour(pc: RTCPeerConnection) {
  const t = {
    audio: pc.addTransceiver('audio', { direction: 'sendrecv' }),
    present: pc.addTransceiver('video', { direction: 'recvonly' }),
    control: pc.addTransceiver('video', { direction: 'recvonly' }),
    screen: pc.addTransceiver('video', { direction: 'sendonly' })
  }
  for (const v of [t.present, t.control, t.screen]) preferH264(v)
  lowLatency(t.present.receiver); lowLatency(t.control.receiver); lowLatency(t.audio.receiver)
  return t
}
type Four = ReturnType<typeof addFour>

async function capVideo(sender: RTCRtpSender, viewers = 1) {
  try {
    const { bitrate, fps } = videoLimits(viewers)
    const p = sender.getParameters()
    // maintain-resolution: for text and UI a lower frame rate is better than a blurry picture.
    p.degradationPreference = 'maintain-resolution'
    p.encodings = [{ ...(p.encodings?.[0] ?? {}), maxBitrate: bitrate, maxFramerate: fps, scaleResolutionDownBy: 1, priority: 'high', networkPriority: 'high' }]
    await sender.setParameters(p)
  } catch { /* encoder defaults still work */ }
}

/** `sourceId` null = primary screen. With `audio`, also captures the PC's sound (Windows loopback). */
export async function captureScreen(sourceId: string | null, hint: 'detail' | 'motion', audio = false): Promise<MediaStream> {
  await window.studio.pickSource(sourceId, audio)
  const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 60, max: 60 }, width: { max: 2560 }, height: { max: 1440 } }, audio })
  s.getVideoTracks()[0].contentHint = hint
  return s
}

/** Plays a remote audio track on this PC's speakers. */
function playTrack(track: MediaStreamTrack | null, el: HTMLAudioElement): void {
  el.srcObject = track ? new MediaStream([track]) : null
  if (track) void el.play().catch(() => {})
}

/** Frames decoded so far by one receiver (inbound-rtp). Undefined when nothing has been received at all. */
async function framesDecoded(r: RTCRtpReceiver): Promise<number | undefined> {
  try {
    for (const s of (await r.getStats()).values()) if (s.type === 'inbound-rtp' && s.kind === 'video') return s.framesDecoded ?? 0
  } catch { /* closed */ }
  return undefined
}

/**
 * Tells "this picture should be moving and is not". Feed it every second with whether the picture is expected
 * and the receiver's frame count; it answers true once it stayed still for `ms` while expected.
 */
export class StallWatch {
  private since: number | null = null
  private last = -1
  constructor(private ms = STALL_MS) {}
  update(expected: boolean, frames: number | undefined, now = Date.now()): boolean {
    if (!expected) { this.since = null; this.last = -1; return false }
    const f = frames ?? 0
    if (this.since === null || f !== this.last) { this.since = now; this.last = f; return false }
    return now - this.since >= this.ms
  }
}

export interface View { presentation: MediaStream | null; control: MediaStream | null }

/** Why a link went to the relay, for the person and the logs. */
export type RelayReason = 'no-connect' | 'failed' | 'no-frames' | 'peer'

// ---- Participant side ------------------------------------------------------------------------------

export interface GuestRelayHooks {
  /** Which pictures this PC should be receiving now. */
  expect: () => { presentation: boolean; control: boolean }
  /** Sends my screen over the relay. */
  mediaOut: (stream: number, frame: Uint8Array) => Promise<boolean>
  /** Tells the host this link now uses the relay. */
  modeOut: (reason: RelayReason) => void
  onRelay: (reason: RelayReason) => void
}

/** My connection to the host's hub. */
export class Guest {
  private pc = new RTCPeerConnection(ICE)
  private t: Four = addFour(this.pc)
  private speaker = new Audio()
  private view: View = { presentation: null, control: null }
  private pendingIce: RTCIceCandidateInit[] = []
  private screenTrack: MediaStreamTrack | null = null
  private relay = false
  private relayOut: RelaySender | null = null
  private relayIn = new Map<number, RelayReceiver>()
  private startedAt = 0
  private downSince: number | null = null
  private watchdog = 0
  private stall = { presentation: new StallWatch(), control: new StallWatch() }

  constructor(private rtc: Rtc, private onView: (v: View) => void, private hooks: GuestRelayHooks) {
    this.pc.onicecandidate = (e) => e.candidate && rtc('ice', JSON.stringify(e.candidate))
    this.pc.ontrack = (e) => {
      if (e.transceiver === this.t.audio) playTrack(e.track, this.speaker) // the presenter's PC sound
      if (this.relay) return // pictures come from the relay now
      if (e.transceiver === this.t.present) { this.view = { ...this.view, presentation: new MediaStream([e.track]) }; this.onView(this.view) }
      else if (e.transceiver === this.t.control) { this.view = { ...this.view, control: new MediaStream([e.track]) }; this.onView(this.view) }
    }
  }
  get relayed() { return this.relay }

  async start() {
    this.startedAt = Date.now()
    await capVideo(this.t.screen.sender)
    await this.pc.setLocalDescription(await this.pc.createOffer())
    this.rtc('offer', this.pc.localDescription!.sdp)
    this.watchdog = window.setInterval(() => void this.check(), 1000)
  }

  /** Every second: is WebRTC up, and do the pictures I expect actually move? If not, go to the TCP relay. */
  private async check() {
    if (this.relay) return
    if (!relaySupported()) return
    const now = Date.now(), st = this.pc.connectionState
    if (st === 'failed') return this.enableRelay('failed', true)
    if (st !== 'connected') {
      if (this.downSince === null) this.downSince = now
      const limit = this.everConnected ? 5000 : CONNECT_TIMEOUT_MS
      if (now - Math.max(this.downSince, this.startedAt) >= limit) return this.enableRelay('no-connect', true)
      return
    }
    this.everConnected = true; this.downSince = null
    const want = this.hooks.expect()
    // Longer than the host's own check: if the presenter's upload is what stalls, the host repairs THAT link first.
    const [p, c] = await Promise.all([framesDecoded(this.t.present.receiver), framesDecoded(this.t.control.receiver)])
    if (this.stall.presentation.update(want.presentation, p) || this.stall.control.update(want.control, c)) this.enableRelay('no-frames', true)
  }
  private everConnected = false

  /** Moves this link's video to the TCP relay. `tell`: this side decided, so the host must be told. */
  enableRelay(reason: RelayReason, tell: boolean) {
    if (this.relay || !relaySupported()) return
    this.relay = true
    if (tell) this.hooks.modeOut(reason)
    for (const s of [1, 2]) this.relayIn.set(s, new RelayReceiver())
    this.view = { presentation: new MediaStream([this.relayIn.get(1)!.track]), control: new MediaStream([this.relayIn.get(2)!.track]) }
    this.onView(this.view)
    this.relayOut = new RelaySender((f) => this.hooks.mediaOut(3, f), () => videoLimits(1))
    void this.t.screen.sender.replaceTrack(null) // no double encoding: the screen goes by TCP only
    this.relayOut.setTrack(this.screenTrack)
    this.hooks.onRelay(reason)
  }

  /** A relayed frame from the host (stream 1 presentation, 2 the PC I control). */
  onMedia(stream: number, frame: Uint8Array) {
    if (!this.relay) this.enableRelay('peer', false) // the host switched first
    this.relayIn.get(stream)?.push(frame)
  }

  async onSignal(kind: 'offer' | 'answer' | 'ice', data: string) {
    if (kind === 'answer') {
      await this.pc.setRemoteDescription({ type: 'answer', sdp: data })
      for (const c of this.pendingIce.splice(0)) await this.pc.addIceCandidate(c).catch(() => {})
    } else if (kind === 'ice') {
      const c = JSON.parse(data) as RTCIceCandidateInit
      if (this.pc.remoteDescription) await this.pc.addIceCandidate(c).catch(() => {}); else this.pendingIce.push(c)
    }
  }
  /** My screen and my PC's sound, while I present or am controlled. */
  setScreen(video: MediaStreamTrack | null, audio: MediaStreamTrack | null = null) {
    this.screenTrack = video
    void this.t.audio.sender.replaceTrack(audio)
    if (this.relay) { this.relayOut?.setTrack(video); return Promise.resolve() }
    return this.t.screen.sender.replaceTrack(video)
  }
  /** Round-trip time and transport, for the status line. */
  async stats() {
    let rtt: number | undefined
    for (const r of (await this.pc.getStats()).values()) if (r.type === 'candidate-pair' && r.nominated && r.currentRoundTripTime !== undefined) rtt = r.currentRoundTripTime * 1000
    return { rtt, state: this.pc.connectionState, relay: this.relay }
  }
  close() {
    clearInterval(this.watchdog)
    this.relayOut?.stop(); for (const r of this.relayIn.values()) r.close()
    this.speaker.srcObject = null; this.pc.close()
  }
}

// ---- Host side: the hub ---------------------------------------------------------------------------

interface Link {
  pc: RTCPeerConnection; t: Four; screen?: MediaStreamTrack; audio?: MediaStreamTrack; pending: RTCIceCandidateInit[]
  startedAt: number; downSince: number | null; everConnected: boolean
  relay: boolean; relayOut?: { presentation: RelaySender; control: RelaySender }; relayIn?: RelayReceiver; stall: StallWatch
}

export interface HubRelayHooks {
  mediaOut: (to: string, stream: number, frame: Uint8Array) => Promise<boolean>
  modeOut: (to: string, reason: RelayReason) => void
  onRelay: (id: string, reason: RelayReason) => void
}

export class Hub {
  private links = new Map<string, Link>()
  private localScreen: MediaStreamTrack | null = null
  private localAudio: MediaStreamTrack | null = null
  private speaker = new Audio()
  private state: SessionState | null = null
  private watchdog: number

  constructor(private me: string, private send: (to: string, kind: 'offer' | 'answer' | 'ice', data: string) => void, private onView: (v: View) => void, private hooks: HubRelayHooks) {
    this.watchdog = window.setInterval(() => void this.check(), 1000)
  }

  /** The host's own screen and PC sound, while it presents or is controlled. */
  setLocalScreen(video: MediaStreamTrack | null, audio: MediaStreamTrack | null = null) { this.localScreen = video; this.localAudio = audio; this.route() }

  async onSignal(from: string, kind: 'offer' | 'answer' | 'ice', data: string) {
    if (kind === 'offer') return this.accept(from, data)
    const l = this.links.get(from); if (!l) return
    if (kind === 'ice') {
      const c = JSON.parse(data) as RTCIceCandidateInit
      if (l.pc.remoteDescription) await l.pc.addIceCandidate(c).catch(() => {}); else l.pending.push(c)
    }
  }

  private async accept(id: string, sdp: string) {
    const old = this.links.get(id)
    if (old) this.closeLink(old)
    const pc = new RTCPeerConnection(ICE)
    const l: Link = { pc, t: undefined as unknown as Four, pending: [], startedAt: Date.now(), downSince: null, everConnected: false, relay: false, stall: new StallWatch(STALL_MS - 1000) }
    this.links.set(id, l)
    pc.onicecandidate = (e) => e.candidate && this.send(id, 'ice', JSON.stringify(e.candidate))
    pc.ontrack = (e) => {
      const idx = pc.getTransceivers().indexOf(e.transceiver)
      if (idx === 0) { l.audio = e.track; this.route() } // that PC's sound
      else if (idx === 3 && !l.relay) { l.screen = e.track; this.route() }
    }
    await pc.setRemoteDescription({ type: 'offer', sdp })
    const ts = pc.getTransceivers()
    l.t = { audio: ts[0], present: ts[1], control: ts[2], screen: ts[3] }
    l.t.audio.direction = 'sendrecv'; l.t.present.direction = 'sendonly'; l.t.control.direction = 'sendonly'; l.t.screen.direction = 'recvonly'
    for (const v of [l.t.present, l.t.control, l.t.screen]) preferH264(v)
    lowLatency(l.t.screen.receiver); lowLatency(l.t.audio.receiver)
    await this.tune()
    for (const c of l.pending.splice(0)) await pc.addIceCandidate(c).catch(() => {})
    await pc.setLocalDescription(await pc.createAnswer())
    this.send(id, 'answer', pc.localDescription!.sdp)
    this.route()
  }

  /** Every second, per link: does WebRTC connect, and does the screen I need from that PC actually move? */
  private async check() {
    if (!relaySupported()) return
    const now = Date.now(), st = this.state
    for (const [id, l] of this.links) {
      if (l.relay || !l.t) continue
      const cs = l.pc.connectionState
      if (cs === 'failed') { this.enableRelay(id, 'failed', true); continue }
      if (cs !== 'connected') {
        if (l.downSince === null) l.downSince = now
        if (now - Math.max(l.downSince, l.startedAt) >= (l.everConnected ? 5000 : CONNECT_TIMEOUT_MS)) this.enableRelay(id, 'no-connect', true)
        continue
      }
      l.everConnected = true; l.downSince = null
      // I need this PC's screen while it presents or while someone controls it.
      const needed = !!st && (st.presenter === id || st.controls.some((c) => c.target === id))
      if (l.stall.update(needed, await framesDecoded(l.t.screen.receiver))) this.enableRelay(id, 'no-frames', true)
    }
  }

  /** Moves one participant's video to the TCP relay, both ways. `tell`: the hub decided, so the participant must know. */
  enableRelay(id: string, reason: RelayReason, tell: boolean) {
    const l = this.links.get(id)
    if (!l || l.relay || !relaySupported()) return
    // Un telefono no tiene rele TCP (decision A5): su enlace sigue por WebRTC aunque el video parezca quieto
    // (la captura de una pantalla que no cambia manda pocos cuadros y no es un fallo de red).
    if (this.state?.participants.find((p) => p.id === id)?.device === 'phone') return
    l.relay = true
    if (tell) this.hooks.modeOut(id, reason)
    const n = () => Math.max(1, this.links.size)
    l.relayOut = {
      presentation: new RelaySender((f) => this.hooks.mediaOut(id, 1, f), () => videoLimits(n())),
      control: new RelaySender((f) => this.hooks.mediaOut(id, 2, f), () => videoLimits(1))
    }
    l.relayIn = new RelayReceiver()
    l.screen = l.relayIn.track // that PC's screen now arrives by TCP; it is forwarded to everyone else as before
    this.hooks.onRelay(id, reason)
    this.route()
  }
  /** The participant switched first. */
  onMediaMode(from: string) { this.enableRelay(from, 'peer', false) }
  /** A relayed frame of a participant's screen. */
  onMedia(from: string, stream: number, frame: Uint8Array) {
    if (stream !== 3) return
    const l = this.links.get(from); if (!l) return
    if (!l.relay) this.enableRelay(from, 'peer', false)
    l.relayIn?.push(frame)
  }

  /** Call on every state update: it decides who is shown, who is heard, and who has left. */
  apply(state: SessionState) {
    this.state = state
    const present = new Set(state.participants.map((p) => p.id))
    for (const [id, l] of this.links) if (!present.has(id)) { this.closeLink(l); this.links.delete(id) }
    void this.tune()
    this.route()
  }

  /** Re-splits the bitrate budget whenever the number of viewers changes. */
  private async tune() {
    const n = this.links.size
    for (const l of this.links.values()) if (l.t) await Promise.all([capVideo(l.t.present.sender, n), capVideo(l.t.control.sender, n)])
  }

  private screenOf(id: string) { return id === this.me ? this.localScreen : this.links.get(id)?.screen ?? null }
  private audioOf(id: string) { return id === this.me ? this.localAudio : this.links.get(id)?.audio ?? null }

  private route() {
    const st = this.state; if (!st) return
    const pres = st.presenter ? this.screenOf(st.presenter) : null
    const presAudio = st.presenter ? this.audioOf(st.presenter) : null
    for (const [id, l] of this.links) {
      if (!l.t) continue
      const g = st.controls.find((c) => c.controller === id)
      const others = !!st.presenter && st.presenter !== id // the presenter never gets their own picture or sound back
      const presTrack = others ? pres : null
      const ctlTrack = g ? this.screenOf(g.target) : null
      void l.t.audio.sender.replaceTrack(others ? presAudio : null)
      if (l.relay && l.relayOut) {
        void l.t.present.sender.replaceTrack(null); void l.t.control.sender.replaceTrack(null)
        l.relayOut.presentation.setTrack(presTrack)
        l.relayOut.control.setTrack(ctlTrack)
      } else {
        void l.t.present.sender.replaceTrack(presTrack)
        void l.t.control.sender.replaceTrack(ctlTrack)
      }
    }
    // What the host itself sees and hears.
    const hostWatches = !!st.presenter && st.presenter !== this.me
    playTrack(hostWatches ? presAudio : null, this.speaker)
    const mine = st.controls.find((c) => c.controller === this.me)
    this.onView({
      presentation: hostWatches && pres ? new MediaStream([pres]) : null,
      control: mine ? ((t) => (t ? new MediaStream([t]) : null))(this.screenOf(mine.target)) : null
    })
  }

  private closeLink(l: Link) {
    l.relayOut?.presentation.stop(); l.relayOut?.control.stop(); l.relayIn?.close()
    l.pc.close()
  }
  close() { clearInterval(this.watchdog); for (const l of this.links.values()) this.closeLink(l); this.links.clear(); this.speaker.srcObject = null }
  get linkCount() { return this.links.size }
  get relayCount() { return [...this.links.values()].filter((l) => l.relay).length }
}
