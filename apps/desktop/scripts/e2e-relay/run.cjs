// Build + run (from apps/desktop): npx esbuild scripts/e2e-relay/main.ts --bundle --platform=node --format=cjs --external:electron --outfile=scripts/e2e-relay/main.js
//   npx esbuild scripts/e2e-relay/renderer.ts --bundle --format=iife --external:electron --outfile=scripts/e2e-relay/renderer.js
//   node scripts/e2e-relay/run.cjs ../../node_modules/electron/dist/electron.exe 1   (1 = UDP blocked, 0 = normal)
// Orchestrates host + guest Electron processes. Usage: node run.cjs <electron.exe> <0|1 break UDP>
const { spawn } = require('node:child_process')
const path = require('node:path')
const [electron, brk] = process.argv.slice(2)
const main = path.join(__dirname, 'main.js')
const env = (extra) => ({ ...process.env, E2E_BREAK: brk, ...extra })
const host = spawn(electron, [main], { env: env({ E2E_ROLE: 'host' }) })
let guest = null
const kill = () => { try { host.kill() } catch {} try { guest?.kill() } catch {} }
setTimeout(() => { console.log('TIMEOUT'); kill(); process.exit(1) }, 60000)
const relay = (p, tag) => p.stdout.on('data', (d) => {
  for (const line of String(d).split(/\r?\n/)) {
    if (!line.trim()) continue
    if (/^(RESULT|LOG|CODE)/.test(line)) console.log(tag, line)
    const m = /^CODE (\w+)/.exec(line)
    if (m && !guest) {
      guest = spawn(electron, [main], { env: env({ E2E_ROLE: 'guest', E2E_CODE: m[1] }) })
      relay(guest, '[guest]')
      guest.on('exit', () => { kill(); setTimeout(() => process.exit(0), 500) })
    }
  }
})
relay(host, '[host]')
