// Ejecuta JS en la pagina de la app de escritorio por el puerto de depuracion 9222, para probarla sin tocar el raton.
// Arranque: cd apps/desktop && npx electron-vite dev -- --remote-debugging-port=9222   (desde la raiz: node apps/android/tools/cdp.cjs "<expresion>")
const WebSocket = require('ws')
const http = require('http')
http.get('http://127.0.0.1:9222/json', (res) => {
  let b = ''
  res.on('data', (d) => (b += d))
  res.on('end', () => {
    const page = JSON.parse(b).find((p) => p.type === 'page' && p.url.startsWith('http'))
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    ws.on('open', () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: process.argv[2], awaitPromise: true, returnByValue: true } })))
    ws.on('message', (m) => { const r = JSON.parse(m); if (r.id === 1) { console.log(JSON.stringify(r.result.result.value ?? r.result, null, 1)); ws.close() } })
  })
})
