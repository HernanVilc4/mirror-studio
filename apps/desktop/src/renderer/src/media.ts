import type { SessionState } from '@mirror-studio/protocol'

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
 * Honest limit: the hub re-encodes video once per viewer inside Chromium; it is not a true SFU. The caps
 * below keep that affordable (measured on a 12-core dev PC: 35 viewers ~ 37% of one core, see HANDOFF.md),
 * but a lab PC must be measured too.
 */
// Quality adapts to the audience: the host spends a fixed outbound budget, split among viewers. One viewer
// (a remote-control session) gets up to 12 Mbps at 30 fps; a full 35-person room falls back to the old 2.5 Mbps / 15 fps.
export const VIDEO_MIN_BITRATE = 2_500_000
export const VIDEO_MAX_BITRATE = 12_000_000
const VIDEO_BUDGET = 80_000_000 // bits/s of video the host may send in total: fits Gigabit, not 100 Mbps links
export function videoLimits(viewers: number) {
  const bitrate = Math.round(Math.min(VIDEO_MAX_BITRATE, Math.max(VIDEO_MIN_BITRATE, VIDEO_BUDGET / Math.max(1, viewers))))
  return { bitrate, fps: viewers <= 8 ? 30 : 15 }
}
const ICE = { iceServers: [] as RTCIceServer[] } // LAN only: no STUN/TURN

type Rtc = (kind: 'offer' | 'answer' | 'ice', data: string) => void

function addFour(pc: RTCPeerConnection) {
  return {
    audio: pc.addTransceiver('audio', { direction: 'sendrecv' }),
    present: pc.addTransceiver('video', { direction: 'recvonly' }),
    control: pc.addTransceiver('video', { direction: 'recvonly' }),
    screen: pc.addTransceiver('video', { direction: 'sendonly' })
  }
}
type Four = ReturnType<typeof addFour>

async function capVideo(sender: RTCRtpSender, viewers = 1) {
  try {
    const { bitrate, fps } = videoLimits(viewers)
    const p = sender.getParameters()
    // maintain-resolution: for text and UI a lower frame rate is better than a blurry picture.
    p.degradationPreference = 'maintain-resolution'
    p.encodings = [{ ...(p.encodings?.[0] ?? {}), maxBitrate: bitrate, maxFramerate: fps, scaleResolutionDownBy: 1 }]
    await sender.setParameters(p)
  } catch { /* encoder defaults still work */ }
}

/** `sourceId` null = primary screen. With `audio`, also captures the PC's sound (Windows loopback). */
export async function captureScreen(sourceId: string | null, hint: 'detail' | 'motion', audio = false): Promise<MediaStream> {
  await window.studio.pickSource(sourceId, audio)
  const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 30 }, width: { max: 2560 }, height: { max: 1440 } }, audio })
  s.getVideoTracks()[0].contentHint = hint
  return s
}

/** Plays a remote audio track on this PC's speakers. Returns a stop function. */
function playTrack(track: MediaStreamTrack | null, el: HTMLAudioElement): void {
  el.srcObject = track ? new MediaStream([track]) : null
  if (track) void el.play().catch(() => {})
}

export interface View { presentation: MediaStream | null; control: MediaStream | null }

// ---- Participant side ------------------------------------------------------------------------------

/** My connection to the host's hub. */
export class Guest {
  private pc = new RTCPeerConnection(ICE)
  private t: Four = addFour(this.pc)
  private speaker = new Audio()
  private view: View = { presentation: null, control: null }
  private pendingIce: RTCIceCandidateInit[] = []

  constructor(private rtc: Rtc, private onView: (v: View) => void) {
    this.pc.onicecandidate = (e) => e.candidate && rtc('ice', JSON.stringify(e.candidate))
    this.pc.ontrack = (e) => {
      if (e.transceiver === this.t.audio) playTrack(e.track, this.speaker) // the presenter's PC sound
      else if (e.transceiver === this.t.present) { this.view = { ...this.view, presentation: new MediaStream([e.track]) }; this.onView(this.view) }
      else if (e.transceiver === this.t.control) { this.view = { ...this.view, control: new MediaStream([e.track]) }; this.onView(this.view) }
    }
  }
  async start() {
    await capVideo(this.t.screen.sender)
    await this.pc.setLocalDescription(await this.pc.createOffer())
    this.rtc('offer', this.pc.localDescription!.sdp)
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
    void this.t.audio.sender.replaceTrack(audio)
    return this.t.screen.sender.replaceTrack(video)
  }
  /** Round-trip time, for the status line. */
  async stats() {
    let rtt: number | undefined
    for (const r of (await this.pc.getStats()).values()) if (r.type === 'candidate-pair' && r.nominated && r.currentRoundTripTime !== undefined) rtt = r.currentRoundTripTime * 1000
    return { rtt, state: this.pc.connectionState }
  }
  close() { this.speaker.srcObject = null; this.pc.close() }
}

// ---- Host side: the hub ---------------------------------------------------------------------------

interface Link { pc: RTCPeerConnection; t: Four; screen?: MediaStreamTrack; audio?: MediaStreamTrack; pending: RTCIceCandidateInit[] }

export class Hub {
  private links = new Map<string, Link>()
  private localScreen: MediaStreamTrack | null = null
  private localAudio: MediaStreamTrack | null = null
  private speaker = new Audio()
  private state: SessionState | null = null

  constructor(private me: string, private send: (to: string, kind: 'offer' | 'answer' | 'ice', data: string) => void, private onView: (v: View) => void) {}

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
    this.links.get(id)?.pc.close()
    const pc = new RTCPeerConnection(ICE)
    const l: Link = { pc, t: undefined as unknown as Four, pending: [] }
    this.links.set(id, l)
    pc.onicecandidate = (e) => e.candidate && this.send(id, 'ice', JSON.stringify(e.candidate))
    pc.ontrack = (e) => {
      const idx = pc.getTransceivers().indexOf(e.transceiver)
      if (idx === 0) { l.audio = e.track; this.route() } // that PC's sound
      else if (idx === 3) { l.screen = e.track; this.route() }
    }
    await pc.setRemoteDescription({ type: 'offer', sdp })
    const ts = pc.getTransceivers()
    l.t = { audio: ts[0], present: ts[1], control: ts[2], screen: ts[3] }
    l.t.audio.direction = 'sendrecv'; l.t.present.direction = 'sendonly'; l.t.control.direction = 'sendonly'; l.t.screen.direction = 'recvonly'
    await this.tune()
    for (const c of l.pending.splice(0)) await pc.addIceCandidate(c).catch(() => {})
    await pc.setLocalDescription(await pc.createAnswer())
    this.send(id, 'answer', pc.localDescription!.sdp)
    this.route()
  }

  /** Call on every state update: it decides who is shown, who is heard, and who has left. */
  apply(state: SessionState) {
    this.state = state
    const present = new Set(state.participants.map((p) => p.id))
    for (const [id, l] of this.links) if (!present.has(id)) { l.pc.close(); this.links.delete(id) }
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
      void l.t.present.sender.replaceTrack(others ? pres : null)
      void l.t.audio.sender.replaceTrack(others ? presAudio : null)
      void l.t.control.sender.replaceTrack(g ? this.screenOf(g.target) : null)
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

  close() { for (const l of this.links.values()) l.pc.close(); this.links.clear(); this.speaker.srcObject = null }
  get linkCount() { return this.links.size }
}
