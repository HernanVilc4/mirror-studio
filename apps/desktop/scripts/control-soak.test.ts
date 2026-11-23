// Remote-control soak on a REAL Windows desktop: the real PowerShell injector, the real encrypted socket and the
// host relay, aimed at a throwaway always-on-top test window that reports what it receives.
// It MOVES THE REAL MOUSE for ~20 s, so it only runs when asked:
//   PowerShell:  $env:MS_SOAK='1'; npx vitest run scripts/control-soak.test.ts
//   Git Bash:    MS_SOAK=1 npx vitest run scripts/control-soak.test.ts
// Do not touch the mouse while it runs. Keys are limited to Shift, so nothing gets typed anywhere.
import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ControlInput, ServerMessage } from '@mirror-studio/protocol'
import { AppSession, type UiEvent } from '../src/main/app-session'
import { createWindowsDriver, type InputDriver } from '../src/main/input'

const SOAK_MS = Number(process.env.MS_SOAK_MS ?? 20_000)

// Integer pixels only: a Spanish Windows prints decimals with a comma.
const TARGET_PS = String.raw`
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$f = New-Object Windows.Forms.Form
$f.Text = 'Mirror Studio - prueba de control'; $f.TopMost = $true; $f.StartPosition = 'Manual'; $f.KeyPreview = $true
$f.Location = New-Object Drawing.Point(160, 120); $f.Size = New-Object Drawing.Size(560, 380); $f.BackColor = 'DarkSlateGray'
$sw = [Diagnostics.Stopwatch]::StartNew()
function Say($s) { [Console]::Out.WriteLine("$s $($sw.ElapsedMilliseconds)"); [Console]::Out.Flush() }
$f.Add_MouseDown({ Say "down $($_.Button)" }); $f.Add_MouseUp({ Say "up $($_.Button)" })
$f.Add_MouseWheel({ Say "wheel $($_.Delta)" }); $f.Add_KeyDown({ Say "key $($_.KeyCode)" })
$f.Add_Activated({ Say 'active' }); $f.Add_Deactivate({ Say 'inactive' })
$f.Add_Shown({ $r = $f.RectangleToScreen($f.ClientRectangle); $s = [Windows.Forms.Screen]::PrimaryScreen.Bounds; Say "ready $($r.X) $($r.Y) $($r.Width) $($r.Height) $($s.Width) $($s.Height)" })
$t = New-Object Windows.Forms.Timer; $t.Interval = 90000; $t.Add_Tick({ $f.Close() }); $t.Start()
[Windows.Forms.Application]::Run($f)
`

const fakeDriver: InputDriver = { supported: true, mouseMove() {}, mouseButton() {}, wheel() {}, key() {}, text() {}, dispose() {} }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const until = async (pred: () => boolean, ms = 5000) => { for (let t = 0; t < ms && !pred(); t += 10) await sleep(10); return pred() }

function session(driver: InputDriver) {
  const events: UiEvent[] = []
  const s = new AppSession(driver, (e) => events.push(e), 1000)
  const of = <T extends ServerMessage['t']>(t: T) =>
    events.flatMap((e) => (e.t === 'message' && e.m.t === t ? [e.m as Extract<ServerMessage, { t: T }>] : []))
  return { s, of }
}

describe.runIf(process.env.MS_SOAK === '1' && process.platform === 'win32')('remote control soak (moves the REAL mouse)', () => {
  it(`clicks, scrolls and keys keep arriving for ${SOAK_MS / 1000} s`, async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'ms-soak-')), 'target.ps1')
    writeFileSync(file, TARGET_PS, 'utf8')
    const target = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file])
    const seen: { what: string; t: number }[] = []
    let box: number[] | null = null
    let active = false
    let buf = ''
    target.stdout.on('data', (d) => {
      buf += String(d)
      for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
        const p = line.split(' ')
        if (p[0] === 'ready') box = p.slice(1, 7).map(Number)
        else if (p[0] === 'active') active = true
        else if (p[0] === 'inactive') active = false
        else if (p[0]) seen.push({ what: p.slice(0, -1).join(' '), t: Date.now() })
      }
    })

    // The controlled PC hosts, like the failing setup: the controller is a teacher who joined it.
    const host = session(createWindowsDriver())
    const ctl = session(fakeDriver)
    try {
      expect(await until(() => box !== null, 20_000)).toBe(true)
      const [bx, by, bw, bh, sw, sh] = box!
      const { code, port } = await host.s.host('Soak', 'Anfitrion', 0, '127.0.0.1')
      await ctl.s.join('127.0.0.1', port, code, 'Docente')
      await until(() => ctl.of('welcome').length === 1)
      host.s.send({ t: 'set-role', target: ctl.s.id, role: 'teacher' })
      await until(() => ctl.of('state').some((m) => m.state.participants.some((p) => p.id === ctl.s.id && p.role === 'teacher')))
      ctl.s.send({ t: 'control-request', target: host.s.id })
      await until(() => host.of('control-asked').length === 1)
      host.s.send({ t: 'control-respond', controller: ctl.s.id, accept: true })
      expect(await until(() => ctl.of('control-started').length === 1)).toBe(true)

      const send = (input: ControlInput) => ctl.s.send({ t: 'control-input', target: host.s.id, input })
      // A point inside the test window, normalized over the primary screen like the controller's view does.
      const at = (fx: number, fy: number) => ({ x: (bx + bw * fx) / sw, y: (by + bh * fy) / sh })
      const t0 = Date.now()
      let n = 0
      while (Date.now() - t0 < SOAK_MS) {
        const k = n++
        const a = k / 20
        send({ t: 'mouse-move', ...at(0.5 + 0.3 * Math.cos(a), 0.5 + 0.3 * Math.sin(a)) })
        if (k % 30 === 0) { // ~2 clicks per second, as the view sends them: move, press, move, release
          const p = at(0.5, 0.5)
          send({ t: 'mouse-move', ...p }); send({ t: 'mouse-button', button: 'left', down: true })
          send({ t: 'mouse-move', ...p }); send({ t: 'mouse-button', button: 'left', down: false })
        }
        if (k % 60 === 15) send({ t: 'wheel', dx: 0, dy: k % 120 === 15 ? 100 : -100 }) // down then up: down used to kill the helper
        if (k % 60 === 45) send({ t: 'wheel', dx: 0, dy: 4 }) // a touchpad's small deltas
        if (k % 90 === 45 && active) { send({ t: 'key', code: 'ShiftLeft', down: true }); send({ t: 'key', code: 'ShiftLeft', down: false }) }
        await sleep(16)
      }
      await sleep(1500) // let the helper drain what is queued

      const windows = Math.ceil(SOAK_MS / 5000)
      const report = Array.from({ length: windows }, (_, w) => {
        const inW = seen.filter((e) => e.t - t0 >= w * 5000 && e.t - t0 < (w + 1) * 5000)
        const count = (re: RegExp) => inW.filter((e) => re.test(e.what)).length
        return { from: `${w * 5}s`, clicks: count(/^down Left/), ups: count(/^up Left/), wheel: count(/^wheel/), keys: count(/^key/) }
      })
      console.table(report)
      for (const r of report) expect(r.clicks, `clicks in the window starting at ${r.from}`).toBeGreaterThan(3)
      expect(report.at(-1)!.wheel).toBeGreaterThan(0)

      // The controlled PC kept reporting its health while being driven, and what it received kept growing.
      const health = ctl.of('control-status').map((m) => m.health)
      console.log('health reports:', health.length, 'codes:', [...new Set(health.map((h) => h.code))].join(','), 'received:', health.map((h) => h.received).join(' '))
      expect(health.length).toBeGreaterThanOrEqual(Math.floor(SOAK_MS / 2000) - 2)
      expect(health.every((h) => h.code === 'ok')).toBe(true)
      expect(health.at(-1)!.received).toBeGreaterThan(health[0].received)
    } finally {
      host.s.dispose(); ctl.s.dispose(); target.kill()
    }
  }, SOAK_MS + 60_000)
})
