import { execFile } from 'node:child_process'

/**
 * Windows Firewall self-repair.
 *
 * Joining a meeting uses TCP 47800, but WebRTC video uses UDP on dynamic ports. On many lab PCs the TCP part
 * works and the UDP part does not, and people get a black screen. The usual causes, all fixed here:
 *  - The "Windows Security Alert" was cancelled (or the user was not an admin): Windows then adds BLOCK rules
 *    for the program, and a block rule beats any allow rule.
 *  - The allow rule only covers the Private and Domain profiles, but the lab network is classified Public.
 *  - There is no rule for this program at all (portable zip, a rule only for TCP 47800, a moved exe).
 * What cannot be fixed from here (a group policy that ignores local rules, a third-party antivirus firewall)
 * is reported, and the TCP video relay in the window keeps the picture coming anyway.
 */

export type FwProfile = 'Domain' | 'Private' | 'Public'
const PROFILES: FwProfile[] = ['Domain', 'Private', 'Public']

/** Raw facts read from Windows (see DIAG_SCRIPT). Strings as PowerShell prints its enums. */
export interface FirewallDiag {
  rules: { name: string; enabled: string; action: string; profile: string }[]
  profiles: { name: string; enabled: string; local: string }[]
  networks: { alias: string; category: string }[]
}

export interface FirewallAssessment {
  /** ok: nothing to do. repair: fixable with one UAC prompt. policy: locked by group policy, cannot be fixed here. */
  status: 'ok' | 'repair' | 'policy' | 'unknown'
  /** Profiles of the networks this PC is on now. */
  active: FwProfile[]
  /** Human-readable findings, in Spanish (shown in the network help). */
  reasons: string[]
}

const covers = (profile: string, p: FwProfile) => /any|todos/i.test(profile) || new RegExp(`\\b${p}\\b`, 'i').test(profile)
const isTrue = (v: string) => /^(true|1|yes)$/i.test(v.trim())
const categoryToProfile = (c: string): FwProfile | null =>
  /domain/i.test(c) ? 'Domain' : /private/i.test(c) ? 'Private' : /public/i.test(c) ? 'Public' : null

/** Pure decision from the facts. Exported for tests. */
export function assessFirewall(d: FirewallDiag): FirewallAssessment {
  const active = [...new Set(d.networks.map((n) => categoryToProfile(n.category)).filter((p): p is FwProfile => !!p))]
  const check = active.length ? active : PROFILES // unknown network: every profile must work
  const reasons: string[] = []
  let repair = false, policy = false
  for (const p of check) {
    const prof = d.profiles.find((x) => x.name.toLowerCase() === p.toLowerCase())
    if (prof && !isTrue(prof.enabled)) continue // firewall off for this profile: nothing blocks
    const enabled = d.rules.filter((r) => isTrue(r.enabled) && covers(r.profile, p))
    const blocked = enabled.some((r) => /block|bloquear/i.test(r.action))
    const allowed = enabled.some((r) => /allow|permitir/i.test(r.action))
    if (prof && /false/i.test(prof.local)) { policy = true; reasons.push(`La política del dominio ignora las reglas locales en el perfil ${p}.`); continue }
    if (blocked) { repair = true; reasons.push(`Hay una regla que BLOQUEA Mirror Studio en el perfil ${p} (se crea al cancelar el aviso de Windows).`) }
    else if (!allowed) { repair = true; reasons.push(`Falta el permiso de entrada para Mirror Studio en el perfil ${p}.`) }
  }
  return { status: repair ? 'repair' : policy ? 'policy' : 'ok', active, reasons }
}

/** Single-quoted PowerShell literal. */
const psq = (s: string) => `'${s.replace(/'/g, "''")}'`

const DIAG_SCRIPT = (exe: string) => `
$ErrorActionPreference = 'SilentlyContinue'
$exe = ${psq(exe)}
$rules = @(Get-NetFirewallApplicationFilter -Program $exe -PolicyStore ActiveStore | Get-NetFirewallRule | Where-Object { [string]$_.Direction -eq 'Inbound' } |
  ForEach-Object { @{ name = [string]$_.DisplayName; enabled = [string]$_.Enabled; action = [string]$_.Action; profile = [string]$_.Profile } })
$profiles = @(Get-NetFirewallProfile -PolicyStore ActiveStore | ForEach-Object { @{ name = [string]$_.Name; enabled = [string]$_.Enabled; local = [string]$_.AllowLocalFirewallRules } })
$networks = @(Get-NetConnectionProfile | ForEach-Object { @{ alias = [string]$_.InterfaceAlias; category = [string]$_.NetworkCategory } })
@{ rules = $rules; profiles = $profiles; networks = $networks } | ConvertTo-Json -Depth 4 -Compress
`

/**
 * Runs elevated. Removes EVERY inbound/outbound rule for this exact program (block rules included), then adds one
 * allow rule for all profiles, restricted to private addresses: it works on a "Public" lab network without
 * opening the app to the Internet.
 */
const REPAIR_SCRIPT = (exe: string) => `
$ErrorActionPreference = 'Stop'
$exe = ${psq(exe)}
Get-NetFirewallApplicationFilter -Program $exe -PolicyStore PersistentStore -ErrorAction SilentlyContinue | Get-NetFirewallRule -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
Remove-NetFirewallRule -DisplayName 'Mirror Studio' -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName 'Mirror Studio' -Description 'Reuniones y pantalla compartida en red local (creada por Mirror Studio)' -Direction Inbound -Action Allow -Program $exe -Profile Any -RemoteAddress @('LocalSubnet','10.0.0.0/8','172.16.0.0/12','192.168.0.0/16') | Out-Null
exit 0
`

const encode = (script: string) => Buffer.from(script, 'utf16le').toString('base64')

function powershell(args: string[], timeout: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args], { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => resolve({ code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0, out: String(stdout) }))
  })
}

const asArray = <T>(v: T | T[] | null | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v])

/** Reads the firewall state for this program. Never throws: 'unknown' when it cannot tell. */
export async function diagnoseFirewall(exe: string): Promise<FirewallAssessment> {
  if (process.platform !== 'win32') return { status: 'ok', active: [], reasons: [] }
  const r = await powershell(['-EncodedCommand', encode(DIAG_SCRIPT(exe))], 20_000)
  try {
    const j = JSON.parse(r.out.trim()) as Partial<Record<keyof FirewallDiag, unknown>>
    return assessFirewall({ rules: asArray(j.rules) as FirewallDiag['rules'], profiles: asArray(j.profiles) as FirewallDiag['profiles'], networks: asArray(j.networks) as FirewallDiag['networks'] })
  } catch {
    return { status: 'unknown', active: [], reasons: ['No se pudo leer el firewall de Windows.'] }
  }
}

/**
 * Fixes the rules with ONE administrator prompt (UAC). Resolves 'done', 'declined' (the person said no to UAC)
 * or 'failed'.
 */
export async function repairFirewall(exe: string): Promise<'done' | 'declined' | 'failed'> {
  if (process.platform !== 'win32') return 'done'
  const inner = encode(REPAIR_SCRIPT(exe))
  const outer = `try { $p = Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${inner}'; exit $p.ExitCode } catch { exit 1223 }`
  const r = await powershell(['-Command', outer], 120_000)
  return r.code === 0 ? 'done' : r.code === 1223 ? 'declined' : 'failed'
}

export type FirewallState = FirewallAssessment & { repair?: 'done' | 'declined' | 'failed' }

/**
 * Startup routine: diagnose, and if something is fixable, fix it right away (one UAC prompt), then check again.
 * At most one automatic prompt per launch; the network help has a button for another try.
 */
export async function ensureFirewall(exe: string, auto = true): Promise<FirewallState> {
  const first = await diagnoseFirewall(exe)
  if (first.status !== 'repair' || !auto) return first
  const repair = await repairFirewall(exe)
  if (repair !== 'done') return { ...first, repair }
  return { ...(await diagnoseFirewall(exe)), repair }
}
