import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ControlInput } from '@mirror-studio/protocol'

/** Low-level injection. Implementations must be safe to call after dispose() (no-ops). */
export interface InputDriver {
  readonly supported: boolean
  mouseMove(x: number, y: number): void
  mouseButton(button: 'left' | 'right' | 'middle', down: boolean): void
  wheel(dx: number, dy: number): void
  /** `vk` is a Windows virtual-key code; `extended` marks keys such as arrows and Delete. */
  key(vk: number, extended: boolean, down: boolean): void
  text(s: string): void
  dispose(): void
}

/** KeyboardEvent.code -> [Windows virtual key, extended]. Anything not listed is rejected. */
export const KEYMAP: Record<string, [number, boolean]> = (() => {
  const m: Record<string, [number, boolean]> = {}
  for (let i = 0; i < 26; i++) m[`Key${String.fromCharCode(65 + i)}`] = [0x41 + i, false]
  for (let i = 0; i < 10; i++) { m[`Digit${i}`] = [0x30 + i, false]; m[`Numpad${i}`] = [0x60 + i, false] }
  for (let i = 1; i <= 12; i++) m[`F${i}`] = [0x6f + i, false]
  Object.assign(m, {
    Enter: [0x0d, false], Escape: [0x1b, false], Backspace: [0x08, false], Tab: [0x09, false], Space: [0x20, false],
    ShiftLeft: [0xa0, false], ShiftRight: [0xa1, false], ControlLeft: [0xa2, false], ControlRight: [0xa3, true],
    AltLeft: [0xa4, false], AltRight: [0xa5, true], MetaLeft: [0x5b, true], MetaRight: [0x5c, true], CapsLock: [0x14, false],
    ArrowLeft: [0x25, true], ArrowUp: [0x26, true], ArrowRight: [0x27, true], ArrowDown: [0x28, true],
    Home: [0x24, true], End: [0x23, true], PageUp: [0x21, true], PageDown: [0x22, true], Insert: [0x2d, true], Delete: [0x2e, true],
    Minus: [0xbd, false], Equal: [0xbb, false], BracketLeft: [0xdb, false], BracketRight: [0xdd, false], Backslash: [0xdc, false],
    Semicolon: [0xba, false], Quote: [0xde, false], Comma: [0xbc, false], Period: [0xbe, false], Slash: [0xbf, false], Backquote: [0xc0, false],
    NumpadAdd: [0x6b, false], NumpadSubtract: [0x6d, false], NumpadMultiply: [0x6a, false], NumpadDivide: [0x6f, true], NumpadDecimal: [0x6e, false], NumpadEnter: [0x0d, true]
  } satisfies Record<string, [number, boolean]>)
  return m
})()

/**
 * Applies remote input on THIS machine, only while a grant is active, and remembers every key and
 * button held down so that revoking, disconnecting or ending the session never leaves one stuck.
 */
export class RemoteInput {
  private keys = new Map<string, [number, boolean]>()
  private buttons = new Set<'left' | 'right' | 'middle'>()
  private controller: string | null = null

  constructor(private driver: InputDriver) {}

  get supported() { return this.driver.supported }
  get active() { return this.controller !== null }
  get controlledBy() { return this.controller }

  /** Starts accepting input from this controller. Returns false when this platform cannot inject input. */
  begin(controller: string): boolean {
    if (!this.driver.supported) return false
    this.releaseAll()
    this.controller = controller
    return true
  }
  /** Stops accepting input and releases everything still held. Safe to call repeatedly. */
  end() { this.releaseAll(); this.controller = null }

  apply(from: string, input: ControlInput): void {
    if (this.controller === null || from !== this.controller) return
    switch (input.t) {
      case 'mouse-move': this.driver.mouseMove(input.x, input.y); break
      case 'mouse-button':
        if (input.down) this.buttons.add(input.button); else this.buttons.delete(input.button)
        this.driver.mouseButton(input.button, input.down); break
      case 'wheel': this.driver.wheel(input.dx, input.dy); break
      case 'key': {
        const k = KEYMAP[input.code]
        if (!k) return // unknown key: ignored rather than guessed
        if (input.down) this.keys.set(input.code, k); else this.keys.delete(input.code)
        this.driver.key(k[0], k[1], input.down); break
      }
      case 'text': this.driver.text(input.text); break
    }
  }

  releaseAll() {
    for (const [, [vk, ext]] of this.keys) this.driver.key(vk, ext, false)
    for (const b of this.buttons) this.driver.mouseButton(b, false)
    this.keys.clear(); this.buttons.clear()
  }
  dispose() { this.end(); this.driver.dispose() }
}

/** Platforms without an injector (anything but Windows) can be viewed but not controlled. */
export const unsupportedDriver: InputDriver = {
  supported: false, mouseMove() {}, mouseButton() {}, wheel() {}, key() {}, text() {}, dispose() {}
}

// UNVERIFIED on a real Windows machine: written against the documented SendInput API, no Windows host was
// available. It runs one persistent PowerShell so each event costs a line on stdin, not a process start.
const PS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class MS {
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] public struct U { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public U u; }
  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint n, INPUT[] i, int size);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  static void Send(INPUT i) { SendInput(1, new INPUT[]{ i }, Marshal.SizeOf(typeof(INPUT))); }
  // data is signed on purpose: a wheel scroll down is negative (-120). Casting that to uint in PowerShell throws.
  public static void Mouse(int dx, int dy, int data, uint flags) { var i = new INPUT(); i.type = 0; i.u.mi.dx = dx; i.u.mi.dy = dy; i.u.mi.mouseData = unchecked((uint)data); i.u.mi.dwFlags = flags; Send(i); }
  public static void Key(ushort vk, ushort scan, uint flags) { var i = new INPUT(); i.type = 1; i.u.ki.wVk = vk; i.u.ki.wScan = scan; i.u.ki.dwFlags = flags; Send(i); }
}
"@
[void][MS]::SetProcessDPIAware()  # without it, scaled displays get virtualized coordinates
$lx = 0; $ly = 0
while (($line = [Console]::In.ReadLine()) -ne $null) {
  # One bad line must never kill the helper: with 'Stop' an uncaught error ends the script and every later
  # event would be silently dropped while the video keeps flowing (the "my pointer stopped working" bug).
  try {
    $p = $line.Split(' ')
    switch ($p[0]) {
      'M' { $lx = [int]$p[1]; $ly = [int]$p[2]; [MS]::Mouse($lx, $ly, 0, 0x8001) }  # MOVE | ABSOLUTE (0..65535)
      'B' { $f = [uint32]$p[1]; if (($f -band 0x2a) -ne 0) { [MS]::Mouse($lx, $ly, 0, 0x8001); Start-Sleep -Milliseconds 40 }; [MS]::Mouse(0, 0, 0, $f) }  # a press waits so the window sees the hover first (title-bar buttons need it)
      'W' { if ([int]$p[2] -ne 0) { [MS]::Mouse(0, 0, [int]$p[2], 0x0800) }; if ([int]$p[1] -ne 0) { [MS]::Mouse(0, 0, [int]$p[1], 0x1000) } }
      'K' { [MS]::Key([uint16]$p[1], 0, [uint32]$p[2]) }                             # flags: 1 = extended, 2 = key up
      'T' { foreach ($c in [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p[1])).ToCharArray()) { [MS]::Key(0, [uint16]$c, 4); [MS]::Key(0, [uint16]$c, 6) } }
      'Q' { exit 0 }                                                                 # 'break' would only leave the switch
    }
  } catch { [Console]::Error.WriteLine("input '$line': $($_.Exception.Message)") }
}
`

/** The helper script, exported for the Windows-only test. */
export const INPUT_HELPER_SCRIPT = PS_SCRIPT

const BUTTON_FLAGS = { left: [0x0002, 0x0004], right: [0x0008, 0x0010], middle: [0x0020, 0x0040] } as const

export function createWindowsDriver(): InputDriver {
  const dir = mkdtempSync(join(tmpdir(), 'mirror-studio-'))
  const file = join(dir, 'input.ps1')
  writeFileSync(file, PS_SCRIPT, 'utf8')
  let ps: ChildProcessWithoutNullStreams | null = null
  let disposed = false
  let startedAt = 0
  const start = () => {
    startedAt = Date.now()
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { windowsHide: true })
    p.on('error', (e) => { console.error('[input] helper failed to start:', e.message); if (ps === p) ps = null })
    p.on('exit', (code) => { if (ps === p) ps = null; if (!disposed) console.error(`[input] helper exited (${code}); it restarts on the next event`) })
    p.stdin.on('error', () => { /* helper gone: the next event restarts it */ })
    p.stderr.on('data', (d) => console.error('[input]', String(d).trim()))
    return p
  }
  ps = start()
  const line = (s: string) => {
    if (disposed) return
    // Never stay dead: a crashed helper used to drop all remote input until the app restarted.
    // At most one restart every 2 s, so a missing powershell.exe cannot cause a spawn storm.
    if (!ps && Date.now() - startedAt > 2000) ps = start()
    try { ps?.stdin.write(s + '\n') } catch { /* helper gone */ }
  }
  const drv: InputDriver = {
    supported: true,
    mouseMove: (x, y) => line(`M ${Math.round(x * 65535)} ${Math.round(y * 65535)}`),
    mouseButton: (b, down) => line(`B ${BUTTON_FLAGS[b][down ? 0 : 1]}`),
    // Windows wheel units: 120 per notch. Positive = away from the user (scroll up).
    wheel: (dx, dy) => line(`W ${Math.trunc(dx)} ${Math.trunc(-dy)}`),
    key: (vk, ext, down) => line(`K ${vk} ${(ext ? 1 : 0) | (down ? 0 : 2)}`),
    text: (s) => line(`T ${Buffer.from(s, 'utf8').toString('base64')}`),
    dispose: () => { disposed = true; try { ps?.stdin.end('Q\n') } catch { /* ignore */ } ps?.kill(); ps = null; try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ } }
  }
  return drv
}

export const createDriver = (): InputDriver => (process.platform === 'win32' ? createWindowsDriver() : unsupportedDriver)
