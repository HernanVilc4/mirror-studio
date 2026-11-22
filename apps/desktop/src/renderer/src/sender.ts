import { create } from 'zustand'

export type ShareState = 'idle' | 'connecting' | 'waiting' | 'sharing' | 'error'
interface Share { state: ShareState; message: string; set: (s: ShareState, m?: string) => void }
export const useShare = create<Share>((set) => ({ state: 'idle', message: '', set: (state, message = '') => set({ state, message }) }))

let ws: WebSocket | null = null
let pc: RTCPeerConnection | null = null
let stream: MediaStream | null = null
let timer = 0

async function hmac(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg)))
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function stopShare(message = '') {
  clearInterval(timer)
  try { ws?.send(JSON.stringify({ t: 'bye' })) } catch { /* socket already closed */ }
  ws?.close(); pc?.close(); stream?.getTracks().forEach((t) => t.stop())
  ws = pc = stream = null
  useShare.getState().set('idle', message)
}

/** Share this PC's screen with another Mirror Studio desktop. token '' = discovery pairing (needs approval on the viewer). */
export async function startShare(host: string, port: number, token: string) {
  const { set } = useShare.getState()
  stopShare(); set('connecting')
  const key = token || 'open'
  try {
    // 'motion' tells the encoder to keep frame rate over sharpness: lower latency while scrolling/dragging.
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 60, width: { max: 1920 }, height: { max: 1080 } }, audio: false })
    stream.getVideoTracks()[0].contentHint = 'motion'
    stream.getVideoTracks()[0].onended = () => stopShare('Dejaste de compartir')
  } catch { return set('error', 'No se pudo capturar la pantalla (permiso denegado o no disponible).') }

  const me = await window.studio.hostInfo()
  const sock = (ws = new WebSocket(`ws://${host}:${port}`))
  const send = (o: object) => sock.readyState === WebSocket.OPEN && sock.send(JSON.stringify(o))
  sock.onerror = () => set('error', `No se pudo conectar con ${host}:${port}. ¿Está abierto Mirror Studio y en la misma red?`)
  sock.onclose = () => { if (useShare.getState().state !== 'error' && useShare.getState().state !== 'idle') stopShare('Conexión cerrada') }
  sock.onopen = () => {
    set('waiting')
    send({ t: 'hello', v: 1, ...(token ? { token } : {}), deviceId: crypto.randomUUID(), name: me.name, model: me.model })
  }

  sock.onmessage = async (ev) => {
    let m: any
    try { m = JSON.parse(String(ev.data)) } catch { return }
    if (m.t === 'hello-ack') {
      if (m.status === 'rejected') return stopShare(m.reason ?? 'Rechazado')
      if (m.status === 'approved') await negotiate()
    } else if (m.t === 'answer') {
      if ((await hmac(key, m.sdp)) !== m.sig) return stopShare('Firma inválida: conexión descartada')
      await pc?.setRemoteDescription({ type: 'answer', sdp: m.sdp })
      set('sharing')
    } else if (m.t === 'ice') {
      pc?.addIceCandidate({ candidate: m.candidate, sdpMid: m.sdpMid, sdpMLineIndex: m.sdpMLineIndex }).catch(() => {})
    } else if (m.t === 'bye') stopShare('El otro equipo cerró la sesión')
  }

  async function negotiate() {
    const conn = (pc = new RTCPeerConnection({ iceServers: [] })) // LAN only
    const sender = conn.addTrack(stream!.getVideoTracks()[0], stream!)
    const dc = conn.createDataChannel('control')
    // Viewer needs the real size; control of this PC from the viewer is not implemented, so say so.
    const info = () => dc.readyState === 'open' && dc.send(JSON.stringify({ t: 'info', width: screen.width, height: screen.height, rotation: 0, controlEnabled: false }))
    dc.onopen = () => { info(); timer = window.setInterval(info, 2000) }
    conn.onicecandidate = (e) => e.candidate && send({ t: 'ice', candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex })
    conn.onconnectionstatechange = () => { if (conn.connectionState === 'failed') stopShare('Conexión perdida') }
    const offer = await conn.createOffer()
    await conn.setLocalDescription(offer)
    send({ t: 'offer', sdp: offer.sdp, sig: await hmac(key, offer.sdp!) })
    try {
      const p = sender.getParameters()
      p.encodings = [{ ...(p.encodings?.[0] ?? {}), maxBitrate: 8_000_000, maxFramerate: 60 }]
      ;(p as any).degradationPreference = 'maintain-framerate'
      await sender.setParameters(p)
    } catch { /* parameters not applied: encoder defaults still work */ }
  }
}
