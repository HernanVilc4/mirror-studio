import { Hub, Guest } from '../../src/renderer/src/media'

declare const require: (m: string) => { ipcRenderer: { invoke: (...a: unknown[]) => Promise<any>; send: (...a: unknown[]) => void; on: (c: string, f: (e: unknown, v: any) => void) => void } }
const { ipcRenderer } = require('electron')
const q = new URLSearchParams(location.search)
const role = q.get('role'), brk = q.get('brk') === '1'
const log = (m: string) => ipcRenderer.send('log', m)
const W = 1280, H = 720, BITS = 24, BLOCK = 32

// Source picture: moving content + the send time (ms, low 24 bits) as 24 black/white blocks on the top row.
function source(): MediaStreamTrack {
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const g = c.getContext('2d')!
  let n = 0
  setInterval(() => {
    n++
    g.fillStyle = '#334'; g.fillRect(0, 0, W, H)
    g.fillStyle = '#fc0'; g.fillRect((n * 9) % (W - 100), 300, 100, 100)
    g.font = '48px monospace'; g.fillText('Mirror Studio e2e ' + n, 40, 200)
    const t = Date.now() & 0xffffff
    for (let i = 0; i < BITS; i++) { g.fillStyle = (t >> i) & 1 ? '#fff' : '#000'; g.fillRect(i * BLOCK, 0, BLOCK, BLOCK) }
  }, 1000 / 30)
  return c.captureStream(30).getVideoTracks()[0]
}

let me = ''
let state: any = null

if (role === 'host') {
  let hub: Hub | null = null
  ipcRenderer.on('ui', (_e, ev) => {
    if (ev.t === 'message' && ev.m.t === 'welcome') {
      me = ev.m.you; state = ev.m.state
      hub = new Hub(me, (to, kind, data) => { if (brk && kind === 'ice') return; void ipcRenderer.invoke('rtc-out', to, kind, data) }, () => {}, {
        mediaOut: (to, s, f) => ipcRenderer.invoke('media-out', to, s, f),
        modeOut: (to, r) => void ipcRenderer.invoke('media-mode-out', to, r),
        onRelay: (id, r) => log(`hub relay on for ${id}: ${r}`)
      })
      hub.apply(state)
      hub.setLocalScreen(source())
      void ipcRenderer.invoke('send', { t: 'present-start' })
    } else if (ev.t === 'message' && ev.m.t === 'state') hub?.apply(ev.m.state)
    else if (ev.t === 'rtc-in') void hub?.onSignal(ev.from, ev.kind, ev.data)
    else if (ev.t === 'media-in') hub?.onMedia(ev.from, ev.stream, ev.data)
    else if (ev.t === 'media-mode') hub?.onMediaMode(ev.from)
  })
} else {
  let guest: Guest | null = null
  const video = document.createElement('video'); video.muted = true; video.autoplay = true; video.style.width = '400px'; document.body.appendChild(video)
  const probe = document.createElement('canvas'); probe.width = BITS * BLOCK; probe.height = BLOCK
  const pg = probe.getContext('2d', { willReadFrequently: true })!
  let shown = 0, firstAt = 0
  const lat: number[] = []
  const t0 = Date.now()
  const onFrame = () => {
    shown++; if (!firstAt) firstAt = Date.now() - t0
    if (video.videoWidth === W) {
      pg.drawImage(video, 0, 0, BITS * BLOCK, BLOCK, 0, 0, BITS * BLOCK, BLOCK)
      const px = pg.getImageData(0, 0, BITS * BLOCK, BLOCK).data
      let t = 0
      for (let i = 0; i < BITS; i++) { const o = ((BLOCK / 2) * BITS * BLOCK + i * BLOCK + BLOCK / 2) * 4; if (px[o] + px[o + 1] + px[o + 2] > 382) t |= 1 << i }
      const d = ((Date.now() & 0xffffff) - t + 0x1000000) % 0x1000000
      if (d < 5000) lat.push(d)
    }
    ;(video as any).requestVideoFrameCallback(onFrame)
  }
  ;(video as any).requestVideoFrameCallback(onFrame)
  const timeline: string[] = []
  ipcRenderer.on('ui', (_e, ev) => {
    if (ev.t === 'message' && ev.m.t === 'welcome') {
      me = ev.m.you; state = ev.m.state
      guest = new Guest((kind, data) => { if (brk && kind === 'ice') return; void ipcRenderer.invoke('send', { t: 'rtc', kind, data }) }, (v) => {
        if (v.presentation && video.srcObject !== v.presentation) { video.srcObject = v.presentation; void video.play().catch(() => {}) }
      }, {
        expect: () => ({ presentation: !!state?.presenter && state.presenter !== me, control: false }),
        mediaOut: (s, f) => ipcRenderer.invoke('media-out', 'host', s, f),
        modeOut: (r) => void ipcRenderer.invoke('send', { t: 'media-mode', relay: true, reason: r }),
        onRelay: (r) => log(`guest relay on: ${r} at ${Date.now() - t0} ms`)
      })
      void guest.start()
      let s = 0
      const iv = setInterval(async () => {
        s++; timeline.push(`${s}s:${shown}`)
        if (s < 20) return
        clearInterval(iv)
        const st = await guest!.stats()
        const tail = lat.slice(-150).sort((a, b) => a - b)
        const pct = (p: number) => tail.length ? tail[Math.min(tail.length - 1, Math.floor(p * tail.length))] : -1
        // fps over the last 10 s
        const fpsLast10 = (shown - Number(timeline[9].split(':')[1])) / 10
        ipcRenderer.send('result', JSON.stringify({ brokenUdp: brk, transport: st.relay ? 'TCP relay' : 'WebRTC/UDP', pc: st.state, firstFrameMs: firstAt, width: video.videoWidth, fpsLast10, latencyMs: { p50: pct(0.5), p95: pct(0.95), samples: tail.length }, timeline: timeline.join(' ') }))
      }, 1000)
    } else if (ev.t === 'message' && ev.m.t === 'state') state = ev.m.state
    else if (ev.t === 'message' && ev.m.t === 'rtc') void guest?.onSignal(ev.m.kind, ev.m.data)
    else if (ev.t === 'message' && ev.m.t === 'media-mode') guest?.enableRelay('peer', false)
    else if (ev.t === 'media-in') guest?.onMedia(ev.stream, ev.data)
  })
}
