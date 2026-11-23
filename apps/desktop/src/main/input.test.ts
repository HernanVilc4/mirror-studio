import { describe, it, expect } from 'vitest'
import { RemoteInput, KEYMAP, INPUT_HELPER_SCRIPT, createWindowsDriver, readProbe, type InputDriver } from './input'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function fake(supported = true) {
  const calls: string[] = []
  const d: InputDriver = {
    supported,
    mouseMove: (x, y) => calls.push(`move ${x} ${y}`),
    mouseButton: (b, down) => calls.push(`btn ${b} ${down ? 'down' : 'up'}`),
    wheel: (dx, dy) => calls.push(`wheel ${dx} ${dy}`),
    key: (vk, ext, down) => calls.push(`key ${vk}${ext ? 'e' : ''} ${down ? 'down' : 'up'}`),
    text: (s) => calls.push(`text ${s}`),
    dispose: () => calls.push('dispose')
  }
  return { d, calls }
}

describe('RemoteInput', () => {
  it('ignores input until begin() and from anyone but the controller', () => {
    const { d, calls } = fake(); const r = new RemoteInput(d)
    r.apply('prof', { t: 'mouse-move', x: 0.1, y: 0.2 })
    expect(calls).toEqual([])
    expect(r.begin('prof')).toBe(true)
    r.apply('eve', { t: 'mouse-move', x: 0.1, y: 0.2 })
    expect(calls).toEqual([])
    r.apply('prof', { t: 'mouse-move', x: 0.1, y: 0.2 })
    expect(calls).toEqual(['move 0.1 0.2'])
  })
  it('refuses on platforms that cannot inject input', () => {
    const { d } = fake(false); const r = new RemoteInput(d)
    expect(r.begin('prof')).toBe(false)
    expect(r.active).toBe(false)
  })
  it('releases held keys and buttons when control ends, and not the ones already released', () => {
    const { d, calls } = fake(); const r = new RemoteInput(d)
    r.begin('prof')
    r.apply('prof', { t: 'key', code: 'ControlLeft', down: true })
    r.apply('prof', { t: 'key', code: 'KeyC', down: true })
    r.apply('prof', { t: 'key', code: 'KeyC', down: false })
    r.apply('prof', { t: 'mouse-button', button: 'left', down: true })
    calls.length = 0
    r.end()
    expect(calls.sort()).toEqual(['btn left up', 'key 162 up'].sort()) // Ctrl and left button only
    expect(r.active).toBe(false)
    calls.length = 0
    r.end() // idempotent
    expect(calls).toEqual([])
  })
  it('stops applying input after end()', () => {
    const { d, calls } = fake(); const r = new RemoteInput(d)
    r.begin('prof'); r.end()
    r.apply('prof', { t: 'key', code: 'KeyA', down: true })
    expect(calls).toEqual([])
  })
  it('clears leftovers when a new controller starts', () => {
    const { d, calls } = fake(); const r = new RemoteInput(d)
    r.begin('a'); r.apply('a', { t: 'key', code: 'ShiftLeft', down: true })
    calls.length = 0
    r.begin('b')
    expect(calls).toEqual(['key 160 up'])
  })
  it('drops keys that are not in the allowed map', () => {
    const { d, calls } = fake(); const r = new RemoteInput(d)
    r.begin('prof')
    r.apply('prof', { t: 'key', code: 'LaunchApp1', down: true })
    r.apply('prof', { t: 'key', code: 'Power', down: true })
    expect(calls).toEqual([])
  })
  it('maps extended keys', () => {
    const { d, calls } = fake(); const r = new RemoteInput(d)
    r.begin('prof'); r.apply('prof', { t: 'key', code: 'ArrowUp', down: true })
    expect(calls).toEqual(['key 38e down'])
    expect(KEYMAP.KeyA).toEqual([0x41, false])
    expect(KEYMAP.F5).toEqual([0x74, false])
  })
  it('counts what it receives from the current controller only, from zero at each grant', () => {
    const { d } = fake(); const r = new RemoteInput(d)
    r.begin('prof')
    r.apply('prof', { t: 'mouse-move', x: 0.1, y: 0.1 })
    r.apply('prof', { t: 'key', code: 'LaunchApp1', down: true }) // ignored key, but it did arrive
    r.apply('eve', { t: 'mouse-move', x: 0.1, y: 0.1 })
    expect(r.received).toBe(2)
    r.begin('ana')
    expect(r.received).toBe(0)
  })
  it('reset restarts the injector first, then lifts what was held through the new one', () => {
    const { d, calls } = fake(); d.reset = () => calls.push('reset')
    const r = new RemoteInput(d)
    r.begin('prof'); r.apply('prof', { t: 'key', code: 'ShiftLeft', down: true }); calls.length = 0
    r.reset()
    expect(calls).toEqual(['reset', 'key 160 up'])
  })
  it('a driver without health checks reports ok', async () => {
    const { d } = fake(); const r = new RemoteInput(d)
    expect(await r.probe()).toEqual({ code: 'ok' })
  })
  it('dispose releases and shuts the driver', () => {
    const { d, calls } = fake(); const r = new RemoteInput(d)
    r.begin('prof'); r.apply('prof', { t: 'mouse-button', button: 'right', down: true }); calls.length = 0
    r.dispose()
    expect(calls).toEqual(['btn right up', 'dispose'])
  })
})

// Regression: a wheel scroll down (-120) used to throw inside the PowerShell helper, which then died and
// silently dropped every later remote event while the video kept flowing. Malformed lines must be survived too.
describe.runIf(process.platform === 'win32')('Windows input helper', () => {
  it('survives bad lines and quits cleanly on Q (sends no real input)', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'ms-input-')), 'input.ps1')
    writeFileSync(file, INPUT_HELPER_SCRIPT, 'utf8')
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file],
      { input: 'M abc def\nK notanumber 0\nW 0 0\nQ\n', encoding: 'utf8', timeout: 60_000, windowsHide: true })
    expect(r.status).toBe(0) // reached Q: the bad lines did not kill it
    expect(r.stderr).toContain("input 'M abc def'")
    expect(r.stderr).toContain("input 'K notanumber 0'")
  }, 70_000)
})

describe('reading a probe answer', () => {
  it('maps the helper answer to a health code', () => {
    expect(readProbe('0 ok', 0)).toEqual({ health: { code: 'ok' }, refused: 0 })
    expect(readProbe('0 secure', 0).health).toEqual({ code: 'blocked-secure' })
    expect(readProbe('0 admin Taskmgr', 0).health).toEqual({ code: 'blocked-admin', detail: 'Taskmgr' })
    expect(readProbe('0 admin ?', 0).health).toEqual({ code: 'blocked-admin', detail: '?' })
  })
  it('a growing refusal count means Windows dropped input, even if nothing is visibly in the way', () => {
    expect(readProbe('3 ok', 1)).toEqual({ health: { code: 'rejected' }, refused: 3 })
    expect(readProbe('3 ok', 3).health).toEqual({ code: 'ok' })
    expect(readProbe('garbage', 0).health.code).toBe('ok')
  })
})

// Health probes only read state (desktop, foreground window): none of these send real input.
describe.runIf(process.platform === 'win32')('Windows input helper health', () => {
  it('says it is ready, then answers a probe', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'ms-input-')), 'input.ps1')
    writeFileSync(file, INPUT_HELPER_SCRIPT, 'utf8')
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file],
      { input: 'P 7\nQ\n', encoding: 'utf8', timeout: 60_000, windowsHide: true })
    expect(r.status).toBe(0)
    const lines = r.stdout.trim().split(/\r?\n/)
    expect(lines[0]).toBe('R')
    expect(lines[1]).toMatch(/^P 7 0 (ok|secure|admin .+)$/)
  }, 70_000)
  it('the driver answers probes, and replaces a helper that does not answer in time', async () => {
    const drv = createWindowsDriver()
    try {
      let h = await drv.probe!()
      for (let i = 0; i < 10 && h.code === 'restarting'; i++) h = await drv.probe!() // still compiling on a slow PC
      expect(['ok', 'blocked-admin', 'blocked-secure']).toContain(h.code)
      drv.reset!() // what a controller's "Reintentar" does
      h = await drv.probe!()
      for (let i = 0; i < 10 && h.code === 'restarting'; i++) h = await drv.probe!()
      expect(['ok', 'blocked-admin', 'blocked-secure']).toContain(h.code)
    } finally { drv.dispose() }
    // Impatient driver: no helper can answer in 1 ms, and with no start-up grace it is replaced, not waited on.
    const impatient = createWindowsDriver({ probeMs: 1, bootMs: 0 })
    try { expect(await impatient.probe!()).toEqual({ code: 'restarting' }) } finally { impatient.dispose() }
  }, 90_000)
})
