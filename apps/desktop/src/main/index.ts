import { app, BrowserWindow, Menu, globalShortcut, ipcMain, nativeTheme, screen, session, desktopCapturer, shell } from 'electron'
import { join } from 'node:path'
import { hostname } from 'node:os'
import { ClientMessage, DEFAULT_PORT, isValidCode, normalizeCode } from '@mirror-studio/protocol'
import { AppSession, type UiEvent } from './app-session'
import { createDriver } from './input'
import { firewallCommand, listInterfaces, pickInterface, scanLan } from './network'
import { diagnoseFirewall, ensureFirewall, repairFirewall, type FirewallState } from './firewall'
import { isThemeSource, loadTheme, paintWindow, setTheme, themeInfo, WINDOW_COLORS } from './theme'
// Bundled as files next to the build output, so the window keeps its icon in the packaged app too.
import iconIco from '../../build/icon.ico?asset'
import iconPng from '../../build/icon.png?asset'
import iconLightIco from '../../build/icon-light.ico?asset'
import iconLightPng from '../../build/icon-light.png?asset'

/**
 * Window and taskbar icon follow the theme: official (white on midnight) in dark, the kit's light alternative
 * (midnight on white) in light. ICO on Windows for crisp 16–256 px. The .exe, installer and shortcut icons are
 * files and cannot change at run time: they keep the official icon.
 */
const windowIcon = () => {
  const dark = nativeTheme.shouldUseDarkColors
  return process.platform === 'win32' ? (dark ? iconIco : iconLightIco) : (dark ? iconPng : iconLightPng)
}

// Show real LAN addresses in WebRTC candidates. Without this Chromium hides them behind mDNS names that
// lab networks often do not resolve, and media never connects.
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns')
// Hardware H.264 encoding through Media Foundation (NVENC, Quick Sync, AMF) and the GPU screen capturers
// (Windows Graphics Capture, frames stay in video memory) instead of GDI copies. Chromium already defaults to
// these on recent Windows; naming them makes sure. Unknown names are ignored, so this is safe across versions.
// The GPU blocklist is NOT overridden on purpose: a blocklisted driver is exactly the one that decodes to black.
app.commandLine.appendSwitch('enable-features', 'MediaFoundationH264Encoding,AllowWgcScreenCapturer,AllowWgcWindowCapturer')

let win: BrowserWindow | null = null
// Local notices also go to the always-on-top control bar: the main window may be hidden behind what they talk about.
// A closed window is destroyed, not null: touching its webContents throws "Object has been destroyed" (an error
// box on quit, because closing the app ends the meeting and that sends one last 'closed' event).
const alive = (w: BrowserWindow | null): w is BrowserWindow => !!w && !w.isDestroyed()
const emit = (e: UiEvent) => { if (alive(win)) win.webContents.send('ui', e); if (e.t === 'notice' && alive(banner)) banner.webContents.send('ui', e) }

/** Emergency stop for the person being controlled. Works even when the app window is not focused. */
const PANIC_KEY = 'CommandOrControl+Alt+Escape'
let banner: BrowserWindow | null = null

/**
 * While someone controls this PC an always-on-top bar says so and offers a stop button. It is a separate
 * window, so it stays visible over the controller's view and cannot be minimized with the main window.
 */
function onControlled(by: { id: string; name: string } | null) {
  if (!by) {
    globalShortcut.unregister(PANIC_KEY)
    banner?.destroy(); banner = null
    return
  }
  globalShortcut.register(PANIC_KEY, () => meeting.send({ t: 'control-revoke', other: by.id }))
  const { width } = screen.getPrimaryDisplay().workAreaSize
  banner?.destroy()
  const b = (banner = new BrowserWindow({
    width: 520, height: 52, x: Math.round((width - 520) / 2), y: 0, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
    closable: false, alwaysOnTop: true, skipTaskbar: true, focusable: true, show: false, backgroundColor: '#7c2d12',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true }
  }))
  b.setAlwaysOnTop(true, 'screen-saver')
  const hash = `banner=${encodeURIComponent(by.name)}&id=${encodeURIComponent(by.id)}`
  if (process.env.ELECTRON_RENDERER_URL) b.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${hash}`)
  else b.loadFile(join(__dirname, '../renderer/index.html'), { hash })
  b.once('ready-to-show', () => b.showInactive())
  b.webContents.on('will-navigate', (e) => e.preventDefault())
}

const meeting = new AppSession(createDriver(), emit, undefined, onControlled)

/** Source chosen in the "Presentar" picker. null = primary screen (also used for PC control). */
let pickedSource: string | null = null
/** Share this PC's sound too. Electron can capture system audio (loopback) on Windows only. */
let wantAudio = false
// MS_TEST_AUDIO=1 only lets the automated test enable the checkbox on Linux (its capture is faked there).
const SYSTEM_AUDIO = process.platform === 'win32' || process.env.MS_TEST_AUDIO === '1'

/**
 * Firewall self-repair (see firewall.ts). It starts at launch, in the background: the home screen does not wait for
 * it, and it may show ONE Windows administrator prompt when something blocks the video. MS_NO_FIREWALL_FIX=1 skips
 * the automatic repair (diagnosis only).
 */
let firewall: FirewallState | null = null
const firewallSummary = (f: FirewallState | null) => (!f ? 'unknown' : f.status === 'ok' ? 'ok' : f.status === 'repair' ? 'missing' : 'unknown') as 'ok' | 'missing' | 'unknown'
function afterFirewall(f: FirewallState) {
  firewall = f
  if (f.repair === 'done' && f.status === 'ok') emit({ t: 'notice', text: 'Firewall de Windows configurado para Mirror Studio: la pantalla compartida ya puede llegar a esta PC.' })
  else if (f.repair === 'declined') emit({ t: 'notice', text: 'No se dio permiso de administrador: el firewall puede bloquear el vídeo. Se usará el modo por TCP si hace falta.' })
  else if (f.status === 'policy') emit({ t: 'notice', text: 'El firewall de esta PC lo controla el dominio. Si el vídeo no llega por la vía rápida, se usará el modo por TCP.' })
  emit({ t: 'net-changed' })
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null) // no File/Edit/View bar: this is a call window, not a document editor
  loadTheme()
  const colors = nativeTheme.shouldUseDarkColors ? WINDOW_COLORS.dark : WINDOW_COLORS.light
  const w = (win = new BrowserWindow({
    autoHideMenuBar: true, icon: windowIcon(),
    // Our own title bar (logo + name, drawn by the page); the OS keeps only its minimize/maximize/close buttons.
    titleBarStyle: 'hidden', titleBarOverlay: { color: colors.bar, symbolColor: colors.symbols, height: 40 },
    // Cold start paints the theme background at once, before the page and the brand entrance load.
    width: 1280, height: 800, minWidth: 900, minHeight: 600, backgroundColor: colors.background, title: 'MirrorStudio',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true }
  }))
  const onTheme = () => { if (w.isDestroyed()) return; paintWindow(w); w.setIcon(windowIcon()); w.webContents.send('theme', themeInfo()) }
  nativeTheme.on('updated', onTheme) // OS switched light/dark (Windows or Ubuntu), or the user picked a theme
  w.on('closed', () => { nativeTheme.off('updated', onTheme); win = null })
  ipcMain.handle('theme', () => themeInfo())
  ipcMain.handle('set-theme', (_e, source: unknown) => { if (isThemeSource(source)) setTheme(source); return themeInfo() })
  // Links never navigate the app window.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' } })
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))

  // getDisplayMedia() in the renderer: share the source picked in the app, or the primary screen.
  session.defaultSession.setDisplayMediaRequestHandler(async (req, cb) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] })
      const chosen = (pickedSource && sources.find((s) => s.id === pickedSource)) || sources.find((s) => s.id.startsWith('screen:')) || sources[0]
      cb(chosen ? { video: chosen, ...(wantAudio && SYSTEM_AUDIO && req.audioRequested ? { audio: 'loopback' as const } : {}) } : {})
    } catch (e) { console.error('[display-media] failed', e); cb({}) }
  })
  // Nothing but screen capture (and the 'media' gate in front of it) is granted: no other permission.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => { cb(permission === 'display-capture' || permission === 'media' || permission === 'clipboard-sanitized-write' || permission === 'fullscreen') }) // 'media' is how Chromium asks before getDisplayMedia; the app never calls getUserMedia

  // MS_TEST_BOOT=slow|fail lets a manual test see the slow and the failed start of the brand entrance (and the retry).
  let bootFailures = process.env.MS_TEST_BOOT === 'fail' ? 1 : 0
  ipcMain.handle('net-info', async () => {
    if (process.env.MS_TEST_BOOT === 'slow') await new Promise((r) => setTimeout(r, 3500))
    if (bootFailures > 0) { bootFailures--; throw new Error('no se pudo leer la red (prueba)') }
    const ifaces = listInterfaces()
    const chosen = pickInterface(ifaces)
    const exe = app.getPath('exe')
    return {
      ifaces, chosen: chosen?.address ?? null, port: DEFAULT_PORT, firewall: firewallSummary(firewall), firewallReasons: firewall?.reasons ?? [],
      firewallChecking: !firewall && process.platform === 'win32', firewallCommand: firewallCommand(exe), controllable: meeting.canBeControlled, systemAudio: SYSTEM_AUDIO, name: hostname()
    }
  })
  ipcMain.handle('discover', () => scanLan(DEFAULT_PORT))
  ipcMain.handle('firewall-repair', async () => {
    const exe = app.getPath('exe')
    const repair = await repairFirewall(exe)
    afterFirewall({ ...(await diagnoseFirewall(exe)), repair })
    return firewall
  })
  // Wait for the window: the result is told to the person in it.
  w.webContents.once('did-finish-load', () => {
    void ensureFirewall(app.getPath('exe'), process.env.MS_NO_FIREWALL_FIX !== '1').then(afterFirewall)
  })

  ipcMain.handle('host', async (_e, meetingName: unknown, myName: unknown) => {
    if (typeof meetingName !== 'string' || typeof myName !== 'string') throw new Error('Datos inválidos')
    const r = await meeting.host(meetingName, myName.slice(0, 64) || hostname(), DEFAULT_PORT)
    const ifaces = listInterfaces()
    return { code: r.code, port: r.port, ips: ifaces.map((i) => i.address), ip: pickInterface(ifaces)?.address ?? null }
  })
  ipcMain.handle('join', async (_e, ip: unknown, port: unknown, code: unknown, myName: unknown) => {
    if (typeof ip !== 'string' || !/^[\w.:-]{1,253}$/.test(ip) || typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Dirección inválida')
    if (typeof code !== 'string' || !isValidCode(code)) throw new Error('El código debe tener 8 caracteres (letras y números, sin 0, 1, I ni O)')
    await meeting.join(ip, port, normalizeCode(code), typeof myName === 'string' && myName ? myName.slice(0, 64) : hostname())
  })
  // Everything coming from the window is validated again here: the renderer is not trusted.
  ipcMain.handle('send', (_e, msg: unknown) => {
    const p = ClientMessage.safeParse(msg)
    if (p.success) meeting.send(p.data)
  })
  ipcMain.handle('rtc-out', (_e, to: unknown, kind: unknown, data: unknown) => {
    if (typeof to === 'string' && (kind === 'offer' || kind === 'answer' || kind === 'ice') && typeof data === 'string' && data.length < 32768) meeting.rtcOut(to, kind, data)
  })
  // TCP video relay (see media-relay.ts): one encoded frame per call, answered with "sent" or "dropped".
  ipcMain.handle('media-out', (_e, to: unknown, stream: unknown, data: unknown) =>
    typeof to === 'string' && (stream === 1 || stream === 2 || stream === 3) && data instanceof Uint8Array && data.length <= 4 * 1024 * 1024
      ? meeting.mediaOut(to, stream, data) : false)
  ipcMain.handle('media-mode-out', (_e, to: unknown, reason: unknown) => {
    if (typeof to === 'string') meeting.mediaMode(to, typeof reason === 'string' ? reason.slice(0, 80) : undefined)
  })
  ipcMain.handle('leave', () => meeting.leave())
  ipcMain.handle('sources', async () =>
    (await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: false }))
      .map((s) => ({ id: s.id, name: s.name, type: s.id.startsWith('screen:') ? 'screen' : 'window', thumb: s.thumbnail.toDataURL() })))
  ipcMain.handle('pick-source', (_e, id: unknown, audio: unknown) => { pickedSource = typeof id === 'string' ? id : null; wantAudio = audio === true })
})

app.on('window-all-closed', () => { meeting.dispose(); globalShortcut.unregisterAll(); app.quit() })
