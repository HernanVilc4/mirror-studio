const { app, BrowserWindow } = require('electron')
const path = require('node:path')
app.commandLine.appendSwitch('disable-gpu'); app.commandLine.appendSwitch('mute-audio')
const counts = [5, 15, 35]
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } })
  win.webContents.on('console-message', (_e, _l, msg) => console.log(msg))
  await win.loadFile(path.join(__dirname, 'page.html'))
  const cpu = () => app.getAppMetrics().reduce((a, m) => a + m.cpu.percentCPUUsage, 0)
  for (const n of counts) {
    await win.webContents.executeJavaScript(`window.start(${n})`)
    await new Promise((r) => setTimeout(r, 6000))            // let encoders settle
    const samples = []
    for (let i = 0; i < 8; i++) { await new Promise((r) => setTimeout(r, 1000)); samples.push(cpu()) }
    const res = await win.webContents.executeJavaScript(`window.report()`)
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length
    console.log(`RESULT viewers=${n} cpu_total=${avg.toFixed(0)}% (100%=1 core) cores=${require('node:os').cpus().length} ${res}`)
    await win.webContents.executeJavaScript(`window.stop()`)
  }
  app.quit()
})
