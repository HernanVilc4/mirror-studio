// Two-process end-to-end: the REAL AppSession (main) + the REAL Hub/Guest (window), one Electron process per role.
import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { AppSession, type UiEvent } from '../../src/main/app-session'
import type { InputDriver } from '../../src/main/input'

const role = process.env.E2E_ROLE as 'host' | 'guest'
const PORT = 47811
app.setPath('userData', join(app.getPath('temp'), `ms-e2e-${role}`))
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns')
app.commandLine.appendSwitch('enable-features', 'MediaFoundationH264Encoding,AllowWgcScreenCapturer,AllowWgcWindowCapturer')

const driver: InputDriver = { supported: false, mouseMove() {}, mouseButton() {}, wheel() {}, key() {}, text() {} }
let win: BrowserWindow | null = null
const session = new AppSession(driver, (e: UiEvent) => { if (win && !win.isDestroyed()) win.webContents.send('ui', e) })

ipcMain.handle('send', (_e, m) => session.send(m))
ipcMain.handle('rtc-out', (_e, to, kind, data) => session.rtcOut(to, kind, data))
ipcMain.handle('media-out', (_e, to, stream, data) => session.mediaOut(to, stream, data))
ipcMain.handle('media-mode-out', (_e, to, reason) => session.mediaMode(to, reason))
ipcMain.on('result', (_e, r) => { console.log('RESULT', role, r); setTimeout(() => app.exit(0), 300) })
ipcMain.on('log', (_e, m) => console.log('LOG', role, m))

app.whenReady().then(async () => {
  win = new BrowserWindow({ show: true, width: 420, height: 300, x: role === 'host' ? 0 : 440, y: 0, webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false } })
  await win.loadFile(join(__dirname, 'page.html'), { query: { role, brk: process.env.E2E_BREAK ?? '0' } })
  if (role === 'host') {
    const r = await session.host('E2E', 'Host', PORT, '127.0.0.1')
    console.log('CODE', r.code)
  } else {
    await session.join('127.0.0.1', PORT, process.env.E2E_CODE!, 'Guest')
  }
})
