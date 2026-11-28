import { BrowserWindow, screen } from 'electron'
import type { ServerMessage } from '@mirror-studio/protocol'

/**
 * Capa del puntero laser y de los trazos del telefono vinculado (docs/movil/DECISIONES.md, seccion 5).
 * Es una ventana transparente sobre la pantalla principal, sin clics, siempre encima y sin foco. Como esta
 * dentro de la pantalla, sale en la captura (los espectadores la ven) y en el proyector, sin tocar el video.
 * Las coordenadas llegan normalizadas 0..1 sobre la pantalla presentada.
 *
 * Solo existe mientras ESTA PC presenta: el anfitrion unicamente reenvia puntero y trazos a la PC que presenta.
 */
const PAGE = String.raw`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;overflow:hidden;background:transparent}canvas{position:fixed;inset:0}</style><canvas id="c"></canvas><script>
const cv = document.getElementById('c'), g = cv.getContext('2d')
const COLORS = { red: '#ef4444', blue: '#2b47d3', yellow: '#facc15', black: '#0b1020' }
const strokes = []            // { id, color, width, tool, pts: [[x, y]] }
const laser = { x: 0, y: 0, on: false, a: 0, seen: 0 }
function fit() { cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio }
addEventListener('resize', fit); fit()
window.laser = (x, y, on) => { laser.x = x; laser.y = y; laser.on = on; laser.seen = performance.now(); if (on) laser.a = 1 }
window.ink = (m) => {
  let s = strokes.find((t) => t.id === m.stroke && !t.done)
  if (!s) { s = { id: m.stroke, color: m.color, width: m.width, tool: m.tool, pts: [], done: false }; strokes.push(s) }
  for (const p of m.points) s.pts.push(p)
  if (m.done) s.done = true
}
window.undo = () => { strokes.pop() }
window.clearInk = () => { strokes.length = 0 }
function frame(now) {
  const W = cv.width, H = cv.height, k = devicePixelRatio
  g.clearRect(0, 0, W, H)
  g.lineCap = 'round'; g.lineJoin = 'round'
  for (const s of strokes) {
    if (!s.pts.length) continue
    const hl = s.tool === 'highlighter'
    g.globalAlpha = hl ? 0.4 : 1
    g.strokeStyle = COLORS[s.color] || COLORS.red
    g.lineWidth = (hl ? 14 : 3) * s.width * k
    g.beginPath(); g.moveTo(s.pts[0][0] * W, s.pts[0][1] * H)
    for (const p of s.pts.slice(1)) g.lineTo(p[0] * W, p[1] * H)
    if (s.pts.length === 1) g.lineTo(s.pts[0][0] * W + 0.1, s.pts[0][1] * H)
    g.stroke()
  }
  g.globalAlpha = 1
  // El laser se apaga solo si deja de llegar (telefono sin red) y se desvanece al soltar.
  if (laser.on && now - laser.seen > 1500) laser.on = false
  if (!laser.on && laser.a > 0) laser.a = Math.max(0, laser.a - 0.08)
  if (laser.a > 0) {
    const x = laser.x * W, y = laser.y * H
    const halo = g.createRadialGradient(x, y, 0, x, y, 34 * k)
    halo.addColorStop(0, 'rgba(239,68,68,0.55)'); halo.addColorStop(1, 'rgba(239,68,68,0)')
    g.globalAlpha = laser.a
    g.fillStyle = halo; g.beginPath(); g.arc(x, y, 34 * k, 0, 7); g.fill()
    g.fillStyle = '#ef4444'; g.beginPath(); g.arc(x, y, 9 * k, 0, 7); g.fill()
    g.globalAlpha = 1
  }
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
</script>`

export class Overlay {
  private win: BrowserWindow | null = null
  private ready = false
  private queue: string[] = []

  private alive(): boolean { return !!this.win && !this.win.isDestroyed() }

  private open() {
    if (this.alive()) return
    const { x, y, width, height } = screen.getPrimaryDisplay().bounds
    const w = (this.win = new BrowserWindow({
      x, y, width, height, transparent: true, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
      focusable: false, skipTaskbar: true, show: false, hasShadow: false, backgroundColor: '#00000000',
      webPreferences: { sandbox: true, contextIsolation: true }
    }))
    this.ready = false
    w.setAlwaysOnTop(true, 'screen-saver')
    w.setIgnoreMouseEvents(true) // nunca recibe clics: todo pasa a lo que haya debajo
    w.setMenu(null)
    w.webContents.on('will-navigate', (e) => e.preventDefault())
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    w.webContents.once('did-finish-load', () => {
      this.ready = true
      for (const js of this.queue.splice(0)) void w.webContents.executeJavaScript(js).catch(() => {})
      if (!w.isDestroyed()) w.showInactive()
    })
    void w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(PAGE))
  }

  private run(js: string) {
    this.open()
    const w = this.win
    if (!w || w.isDestroyed()) return
    if (this.ready) void w.webContents.executeJavaScript(js).catch(() => {})
    else this.queue.push(js)
  }

  /** Cierra la capa y borra todo lo dibujado. */
  close() {
    this.queue = []
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
    this.ready = false
  }

  /**
   * Recibe lo que el anfitrion reenvia a esta PC. `me` es el id de esta PC y `presenter` quien presenta ahora
   * (null si nadie): sin presentacion propia no hay capa.
   */
  onMessage(m: ServerMessage, me: string) {
    switch (m.t) {
      case 'pointer': this.run(`window.laser(${m.x}, ${m.y}, ${m.on})`); break
      case 'ink': this.run(`window.ink(${JSON.stringify({ stroke: m.stroke, points: m.points, color: m.color, width: m.width, tool: m.tool, done: m.done })})`); break
      case 'ink-undo': this.run('window.undo()'); break
      case 'ink-clear': this.run('window.clearInk()'); break
      // Al pasar de diapositiva los trazos se borran (seccion 5).
      case 'slide': if (this.alive()) this.run('window.clearInk()'); break
      case 'state': if (m.state.presenter !== me) this.close(); break
      case 'closed': this.close(); break
    }
  }
}
