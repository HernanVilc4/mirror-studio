import { app, BrowserWindow, ipcMain, session, desktopCapturer } from 'electron'
import { join } from 'node:path'
import { networkInterfaces, hostname } from 'node:os'
import { Bonjour } from 'bonjour-service'
import QRCode from 'qrcode'
import { SignalingServer } from './signaling'
import { scanLan, PORT as DEFAULT_PORT } from './discovery'
import type { PairingPayload } from '@mirror-studio/protocol'

const PORT = DEFAULT_PORT
// Linux: PipeWire screen capture (Wayland) and hardware video decode for a faster viewer. Unverified on real Linux.
if (process.platform === 'linux') app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer,VaapiVideoDecoder')
const signaling = new SignalingServer()
let win: BrowserWindow | null = null
let bonjour: Bonjour | null = null

function lanIps(): string[] {
  const out: string[] = []
  for (const list of Object.values(networkInterfaces()))
    for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) out.push(i.address)
  return out
}
const lanIp = () => lanIps()[0] ?? '127.0.0.1'
const send = (ch: string, ...a: unknown[]) => win?.webContents.send(ch, ...a)

async function createInvite() {
  const payload: PairingPayload = { v: 1, host: lanIp(), port: PORT, token: signaling.newInvite(), name: hostname() }
  return { payload, ips: lanIps(), qr: await QRCode.toDataURL(JSON.stringify(payload), { margin: 1, width: 320 }) }
}

app.whenReady().then(async () => {
  win = new BrowserWindow({
    width: 1280, height: 800, backgroundColor: '#111317', title: 'Mirror Studio',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))

  // getDisplayMedia() in the renderer: share the primary screen (on Wayland the OS portal asks the user).
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => {
    const [screen] = await desktopCapturer.getSources({ types: ['screen'] })
    cb(screen ? { video: screen } : {})
  })
  await signaling.start(PORT)
  // mDNS: phones browse _mirrorstudio._tcp. The token is NOT advertised (only in the QR).
  bonjour = new Bonjour()
  bonjour.publish({ name: `Mirror Studio (${hostname()})`, type: 'mirrorstudio', port: PORT, txt: { v: '1' } })

  signaling.on('pairing-request', (r) => send('pairing-request', r))
  signaling.on('offer', (id, sdp) => send('offer', id, sdp))
  signaling.on('ice', (id, m) => send('ice', id, m))
  signaling.on('closed', (id) => send('closed', id))

  // Selftest only: dump the app's own contents (not the desktop) so the PC-to-PC path can be inspected.
  if (['1', '2'].includes(process.env.MS_SELFTEST ?? '')) setTimeout(async () => { win!.restore(); win!.showInactive(); await new Promise((r) => setTimeout(r, 1500)); const img = await win!.webContents.capturePage(); (await import('node:fs')).writeFileSync(process.env.MS_SELFTEST_OUT ?? 'selftest.png', img.toPNG()) }, Number(process.env.MS_SELFTEST_DELAY ?? 14000))
  ipcMain.handle('invite', createInvite)
  ipcMain.handle('discover', scanLan)
  ipcMain.handle('host-info', () => ({ name: hostname(), model: process.platform }))
  ipcMain.handle('selftest', () => ['1', '2'].includes(process.env.MS_SELFTEST ?? ''))
  ipcMain.handle('selftest-loop', () => process.env.MS_SELFTEST === '1')
  ipcMain.handle('approve', (_e, id: string) => signaling.approve(id))
  ipcMain.handle('reject', (_e, id: string) => signaling.reject(id))
  ipcMain.handle('close', (_e, id: string) => signaling.close(id))
  ipcMain.handle('answer', (_e, id: string, sdp: string) => signaling.sendAnswer(id, sdp))
  ipcMain.handle('ice', (_e, id: string, ice: object) => signaling.sendIce(id, ice))
})

app.on('window-all-closed', () => {
  bonjour?.unpublishAll(() => bonjour?.destroy())
  signaling.stop()
  app.quit()
})
