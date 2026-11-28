import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ControlHealth, ControlInput, SlideAction } from '@mirror-studio/protocol'

/** Tecla de PowerPoint, Google Slides o Canva para cada orden del telefono vinculado (DECISIONES.md, seccion 4). */
export const SLIDE_KEYS: Record<SlideAction, string> = {
  next: 'ArrowRight', prev: 'ArrowLeft', first: 'Home', last: 'End', black: 'KeyB', white: 'KeyW', start: 'F5', end: 'Escape'
}

/** What the injector can tell about itself: see ControlHealth in the protocol for the codes. */
export type InjectorHealth = Omit<ControlHealth, 'received'>

/** Low-level injection. Implementations must be safe to call after dispose() (no-ops). */
export interface InputDriver {
  readonly supported: boolean
  mouseMove(x: number, y: number): void
  mouseButton(button: 'left' | 'right' | 'middle', down: boolean): void
  wheel(dx: number, dy: number): void
  /** `vk` is a Windows virtual-key code; `extended` marks keys such as arrows and Delete. */
  key(vk: number, extended: boolean, down: boolean): void
  text(s: string): void
  /** Optional health check: can injected input reach the desktop right now? A stuck injector is replaced. */
  probe?(): Promise<InjectorHealth>
  /** Optional: drops the injector and starts a fresh one (the controller saw its input stop working). */
  reset?(): void
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
  private count = 0

  constructor(private driver: InputDriver) {}

  /**
   * Una orden de diapositivas del telefono vinculado a esta PC. No usa begin(): no hay concesion de control ni
   * barra roja, es un permiso mucho mas pequeno (no mueve el raton ni escribe texto). El anfitrion ya garantizo
   * que solo llega del telefono vinculado.
   */
  slide(action: SlideAction): void {
    if (!this.driver.supported) return
    const k = KEYMAP[SLIDE_KEYS[action]]
    if (!k) return
    this.driver.key(k[0], k[1], true)
    this.driver.key(k[0], k[1], false)
  }

  /** Input events received from the current controller. Reported back, so the controller can tell when its input stops arriving. */
  get received() { return this.count }

  get supported() { return this.driver.supported }
  get active() { return this.controller !== null }
  get controlledBy() { return this.controller }

  /** Starts accepting input from this controller. Returns false when this platform cannot inject input. */
  begin(controller: string): boolean {
    if (!this.driver.supported) return false
    this.releaseAll()
    this.controller = controller
    this.count = 0
    return true
  }
  /** Stops accepting input and releases everything still held. Safe to call repeatedly. */
  end() { this.releaseAll(); this.controller = null }

  apply(from: string, input: ControlInput): void {
    if (this.controller === null || from !== this.controller) return
    this.count++
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
  probe(): Promise<InjectorHealth> { return this.driver.probe?.() ?? Promise.resolve({ code: 'ok' }) }

  /** Starts the injector again, then lifts whatever the old one may have left pressed. */
  reset() {
    this.driver.reset?.()
    this.releaseAll()
  }

  dispose() { this.end(); this.driver.dispose() }
}

/** Platforms without an injector (anything but Windows) can be viewed but not controlled. */
export const unsupportedDriver: InputDriver = {
  supported: false, mouseMove() {}, mouseButton() {}, wheel() {}, key() {}, text() {}, dispose() {}
}

// One persistent PowerShell, so each event costs a line on stdin, not a process start. Besides injecting,
// it answers health probes ('P n'): Windows silently drops injected input while an elevated window is in
// front (UIPI) or a secure screen is up (UAC prompt, lock screen, Ctrl+Alt+Del), which looks exactly like
// "my clicks stopped working" from the other PC.
const PS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System; using System.Diagnostics; using System.Runtime.InteropServices;
public static class MS {
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] public struct U { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public U u; }
  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint n, INPUT[] i, int size);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr w, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll")] static extern bool SwitchDesktop(IntPtr d);
  [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr d);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("advapi32.dll")] static extern bool OpenProcessToken(IntPtr p, uint access, out IntPtr t);
  [DllImport("advapi32.dll")] static extern bool GetTokenInformation(IntPtr t, int cls, out int info, int len, out int ret);
  /** SendInput calls Windows refused (it returns 0 when something blocks the input). */
  public static int Refused;
  static void Send(INPUT i) { if (SendInput(1, new INPUT[]{ i }, Marshal.SizeOf(typeof(INPUT))) == 0) Refused++; }
  // 1 elevated, 0 not, -1 unknown. QUERY_LIMITED_INFORMATION + TOKEN_QUERY work on elevated processes too.
  static int Elevated(uint pid) {
    IntPtr p = OpenProcess(0x1000, false, pid); if (p == IntPtr.Zero) return -1;
    try {
      IntPtr t; if (!OpenProcessToken(p, 0x0008, out t)) return -1;
      try { int e, r; return GetTokenInformation(t, 20, out e, 4, out r) ? (e != 0 ? 1 : 0) : -1; } finally { CloseHandle(t); }
    } finally { CloseHandle(p); }
  }
  static readonly bool SelfElevated = Elevated((uint)Process.GetCurrentProcess().Id) == 1;
  /** What would stop injected input right now: "ok", "secure" (UAC prompt, lock screen, Ctrl+Alt+Del) or "admin <process>". */
  public static string Probe() {
    IntPtr d = OpenInputDesktop(0, false, 0x0100); // DESKTOP_SWITCHDESKTOP
    if (d == IntPtr.Zero) return "secure";
    bool shown = SwitchDesktop(d); CloseDesktop(d); // fails while the input desktop is not ours
    if (!shown) return "secure";
    if (SelfElevated) return "ok"; // an elevated injector reaches every window
    uint pid; IntPtr w = GetForegroundWindow();
    if (w == IntPtr.Zero || GetWindowThreadProcessId(w, out pid) == 0 || pid == 0 || Elevated(pid) != 1) return "ok";
    string name = "?"; try { name = Process.GetProcessById((int)pid).ProcessName; } catch {}
    return "admin " + name;
  }
  // data is signed on purpose: a wheel scroll down is negative (-120). Casting that to uint in PowerShell throws.
  public static void Mouse(int dx, int dy, int data, uint flags) { var i = new INPUT(); i.type = 0; i.u.mi.dx = dx; i.u.mi.dy = dy; i.u.mi.mouseData = unchecked((uint)data); i.u.mi.dwFlags = flags; Send(i); }
  public static void Key(ushort vk, ushort scan, uint flags) { var i = new INPUT(); i.type = 1; i.u.ki.wVk = vk; i.u.ki.wScan = scan; i.u.ki.dwFlags = flags; Send(i); }
}
"@
[void][MS]::SetProcessDPIAware()  # without it, scaled displays get virtualized coordinates
[Console]::Out.WriteLine('R'); [Console]::Out.Flush()  # ready: the C# part compiled
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
      'P' { [Console]::Out.WriteLine("P $($p[1]) $([MS]::Refused) $([MS]::Probe())"); [Console]::Out.Flush() }  # health probe
      'Q' { exit 0 }                                                                 # 'break' would only leave the switch
    }
  } catch { [Console]::Error.WriteLine("input '$line': $($_.Exception.Message)") }
}
`

/** The helper script, exported for the Windows-only test. */
export const INPUT_HELPER_SCRIPT = PS_SCRIPT

const BUTTON_FLAGS = { left: [0x0002, 0x0004], right: [0x0008, 0x0010], middle: [0x0020, 0x0040] } as const

/** Reads a probe answer ("<refused> ok|secure|admin <process>"). A growing refusal count means Windows dropped input. */
export function readProbe(answer: string, refusedBefore: number): { health: InjectorHealth; refused: number } {
  const [n, state = 'ok', ...name] = answer.trim().split(' ')
  const refused = Number(n) || 0
  if (state === 'secure') return { health: { code: 'blocked-secure' }, refused }
  if (state === 'admin') return { health: { code: 'blocked-admin', detail: name.join(' ').slice(0, 64) || undefined }, refused }
  return { health: { code: refused > refusedBefore ? 'rejected' : 'ok' }, refused }
}

/**
 * `probeMs`: how long a running helper may take to answer a probe before it counts as stuck and is replaced.
 * `bootMs`: the same for a helper that is still starting (compiling its C# part takes seconds on a slow PC).
 */
export function createWindowsDriver(opts: { probeMs?: number; bootMs?: number } = {}): InputDriver {
  const PROBE_MS = opts.probeMs ?? 3000, BOOT_MS = opts.bootMs ?? 20_000
  const dir = mkdtempSync(join(tmpdir(), 'mirror-studio-'))
  const file = join(dir, 'input.ps1')
  writeFileSync(file, PS_SCRIPT, 'utf8')
  let ps: ChildProcessWithoutNullStreams | null = null
  let disposed = false
  let startedAt = 0
  let ready = false
  let refused = 0
  /** A fresh helper first puts the cursor back here, so a click right after a restart does not land at 0,0. */
  let lastMove = ''
  let seq = 0
  const answers = new Map<number, (answer: string) => void>()

  const start = () => {
    startedAt = Date.now(); ready = false; refused = 0
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { windowsHide: true })
    p.on('error', (e) => { console.error('[input] helper failed to start:', e.message); if (ps === p) ps = null })
    p.on('exit', (code) => { if (ps === p) ps = null; if (!disposed) console.error(`[input] helper exited (${code}); it restarts on the next event or health check`) })
    p.stdin.on('error', () => { /* helper gone: the next event or health check restarts it */ })
    p.stderr.on('data', (d) => console.error('[input]', String(d).trim()))
    let out = ''
    p.stdout.on('data', (d) => {
      out += String(d)
      for (let i = out.indexOf('\n'); i >= 0; i = out.indexOf('\n')) {
        const l = out.slice(0, i).trim(); out = out.slice(i + 1)
        if (ps !== p) continue // a replaced helper's last words
        if (l === 'R') ready = true
        else if (l.startsWith('P ')) {
          const sp = l.indexOf(' ', 2)
          answers.get(Number(sp < 0 ? l.slice(2) : l.slice(2, sp)))?.(sp < 0 ? '' : l.slice(sp + 1))
        }
      }
    })
    if (lastMove) p.stdin.write(lastMove + '\n')
    return p
  }
  const restart = (why: string) => {
    console.error(`[input] restarting the helper: ${why}`)
    const old = ps; ps = null
    try { old?.kill() } catch { /* already gone */ }
    ps = start()
  }
  // Never stay dead, but start at most once every 2 s, so a missing powershell.exe cannot cause a spawn storm.
  const ensure = () => { if (!disposed && !ps && Date.now() - startedAt > 2000) ps = start(); return ps }
  const line = (s: string) => {
    if (disposed) return
    try { ensure()?.stdin.write(s + '\n') } catch { /* helper gone */ }
  }
  ps = start()

  return {
    supported: true,
    mouseMove: (x, y) => { lastMove = `M ${Math.round(x * 65535)} ${Math.round(y * 65535)}`; line(lastMove) },
    mouseButton: (b, down) => line(`B ${BUTTON_FLAGS[b][down ? 0 : 1]}`),
    // Windows wheel units: 120 per notch. Positive = away from the user (scroll up).
    wheel: (dx, dy) => line(`W ${Math.trunc(dx)} ${Math.trunc(-dy)}`),
    key: (vk, ext, down) => line(`K ${vk} ${(ext ? 1 : 0) | (down ? 0 : 2)}`),
    text: (s) => line(`T ${Buffer.from(s, 'utf8').toString('base64')}`),
    probe: () => new Promise<InjectorHealth>((resolve) => {
      const p = disposed ? null : ensure()
      if (!p) { resolve({ code: disposed ? 'ok' : 'restarting' }); return }
      const n = ++seq
      const timer = setTimeout(() => {
        answers.delete(n)
        // Alive but silent: stuck, or it never managed to start, so replace it rather than wait forever.
        // One still compiling its C# part (seconds on a slow PC) is left alone until BOOT_MS.
        const starting = !ready && Date.now() - startedAt < BOOT_MS
        if (!starting && ps === p && !disposed) restart(ready ? 'it stopped answering' : 'it did not start')
        resolve({ code: 'restarting' })
      }, PROBE_MS)
      answers.set(n, (answer) => {
        clearTimeout(timer); answers.delete(n)
        const r = readProbe(answer, refused); refused = r.refused
        resolve(r.health)
      })
      try { p.stdin.write(`P ${n}\n`) } catch { /* the timer replaces it */ }
    }),
    reset: () => { if (!disposed) restart('the controller asked for it') },
    dispose: () => { disposed = true; try { ps?.stdin.end('Q\n') } catch { /* ignore */ } ps?.kill(); ps = null; try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ } }
  }
}

export const createDriver = (): InputDriver => (process.platform === 'win32' ? createWindowsDriver() : unsupportedDriver)
