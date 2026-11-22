import { create } from 'zustand'
import { parseDeviceInfo, mapPointToDevice, type DeviceInfo } from '@mirror-studio/protocol'

export type Status = 'pending' | 'connecting' | 'streaming' | 'lost'
export interface Dev {
  id: string; name: string; model: string; status: Status
  stream?: MediaStream; info?: DeviceInfo; fps?: number; w?: number; h?: number; rtt?: number; buf?: number
}

interface Store {
  devs: Record<string, Dev>
  patch: (id: string, p: Partial<Dev>) => void
  remove: (id: string) => void
}
export const useStore = create<Store>((set) => ({
  devs: {},
  patch: (id, p) => set((s) => ({ devs: { ...s.devs, [id]: { ...(s.devs[id] ?? { id, name: '?', model: '?', status: 'pending' as Status }), ...p } } })),
  remove: (id) => set((s) => { const { [id]: _, ...rest } = s.devs; return { devs: rest } })
}))

interface Conn { pc: RTCPeerConnection; dc?: RTCDataChannel; stats?: number }
// One RTCPeerConnection per phone: a failure in one session never touches the others.
const conns = new Map<string, Conn>()

export function sendControl(id: string, msg: object): boolean {
  const dc = conns.get(id)?.dc
  if (dc?.readyState !== 'open') return false
  dc.send(JSON.stringify(msg))
  return true
}
export { mapPointToDevice }

export function initSessions() {
  const s = window.studio
  const st = useStore.getState()

  s.onPairingRequest((r) => st.patch(r.sessionId, { id: r.sessionId, name: r.name, model: r.model, status: 'pending' }))

  s.onOffer(async (id, sdp) => {
    st.patch(id, { status: 'connecting' })
    const pc = new RTCPeerConnection({ iceServers: [] }) // LAN only, no STUN/TURN
    const c: Conn = { pc }
    conns.set(id, c)
    pc.onicecandidate = (e) => e.candidate && s.ice(id, { candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex })
    pc.ontrack = (e) => {
      // Ask the browser to play frames as soon as they arrive instead of buffering for smoothness.
      try { (e.receiver as any).jitterBufferTarget = 0; (e.receiver as any).playoutDelayHint = 0 } catch { /* unsupported: default buffering */ }
      st.patch(id, { stream: e.streams[0], status: 'streaming' })
    }
    pc.ondatachannel = (e) => {
      c.dc = e.channel
      e.channel.onmessage = (m) => { const r = parseDeviceInfo(m.data); if (r.ok) st.patch(id, { info: r.value }) }
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') st.patch(id, { status: 'lost' })
    }
    c.stats = window.setInterval(async () => {
      for (const r of (await pc.getStats()).values()) {
        if (r.type === 'inbound-rtp' && r.kind === 'video')
          st.patch(id, { fps: r.framesPerSecond, w: r.frameWidth, h: r.frameHeight, buf: r.jitterBufferEmittedCount ? (r.jitterBufferDelay / r.jitterBufferEmittedCount) * 1000 : undefined })
        if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.nominated && r.currentRoundTripTime !== undefined) st.patch(id, { rtt: r.currentRoundTripTime * 1000 })
      }
    }, 1000)
    await pc.setRemoteDescription({ type: 'offer', sdp })
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    s.answer(id, answer.sdp!)
  })

  s.onIce((id, m) => {
    conns.get(id)?.pc.addIceCandidate({ candidate: m.candidate, sdpMid: m.sdpMid, sdpMLineIndex: m.sdpMLineIndex }).catch(() => {})
  })

  s.onClosed((id) => {
    const c = conns.get(id)
    if (c) { clearInterval(c.stats); c.pc.close(); conns.delete(id) }
    st.remove(id)
  })
}
