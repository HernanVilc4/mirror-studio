import { networkInterfaces } from 'node:os'
import { execFile } from 'node:child_process'
import { DEFAULT_PORT } from '@mirror-studio/protocol'
import { probeInfo } from './meeting-net'
import { connect } from 'node:net'

export interface Iface { name: string; address: string; netmask: string; mac: string }
export type NetworkInterfaces = Record<string, Array<{ family: string | number; internal: boolean; address: string; netmask: string; mac: string }> | undefined>

/** Adapters that exist on a PC but never reach the lab: VMs, containers, VPNs, WSL. */
const VIRTUAL = /(vethernet|vmware|virtualbox|vbox|hyper-v|docker|veth|br-|virbr|wsl|tailscale|zerotier|vpn|tun|tap|loopback|bluetooth)/i
const WIRELESS = /(wi-?fi|wlan|wireless|wl[a-z0-9]+)/i

/** Every usable private IPv4 address. Link-local (169.254.x.x, "no DHCP") and loopback are excluded. */
export function listInterfaces(src: NetworkInterfaces = networkInterfaces() as NetworkInterfaces): Iface[] {
  const out: Iface[] = []
  for (const [name, list] of Object.entries(src))
    for (const i of list ?? [])
      if ((i.family === 'IPv4' || i.family === 4) && !i.internal && !i.address.startsWith('169.254.'))
        out.push({ name, address: i.address, netmask: i.netmask, mac: i.mac })
  return out
}

/**
 * Chooses the address to advertise. Wired real adapters beat Wi-Fi, which beats anything virtual.
 * The labs use Ethernet, and VM/VPN adapters are the usual cause of "it advertises the wrong IP".
 */
export function pickInterface(list: Iface[]): Iface | undefined {
  const score = (i: Iface) => (VIRTUAL.test(i.name) ? 0 : WIRELESS.test(i.name) ? 1 : 2)
  return [...list].sort((a, b) => score(b) - score(a))[0]
}

/** Addresses of the /24 around `ip`, without our own. Wider masks rely on mDNS or the manual address. */
export function subnetHosts(ip: string, own: Set<string>): string[] {
  const p = ip.split('.').slice(0, 3).join('.')
  return Array.from({ length: 254 }, (_, n) => `${p}.${n + 1}`).filter((a) => !own.has(a))
}

function openPort(ip: string, port: number, ms = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const s = connect({ host: ip, port, timeout: ms })
    s.once('connect', () => { s.destroy(); resolve(true) })
    s.once('timeout', () => { s.destroy(); resolve(false) })
    s.once('error', () => resolve(false))
  })
}

export interface Found { ip: string; port: number; name: string; host: string; participants: number }

/**
 * Finds meetings on the wired /24 of every real adapter by probing the port, then asking the host for
 * its public info. A TCP probe needs no multicast, so it works where mDNS is blocked. VLAN-split labs
 * will not see each other here: that is what "join with address and code" is for.
 */
export async function scanLan(port = DEFAULT_PORT, src?: NetworkInterfaces): Promise<Found[]> {
  const ifaces = listInterfaces(src).filter((i) => !VIRTUAL.test(i.name))
  const own = new Set(ifaces.map((i) => i.address))
  const ips = [...new Set(ifaces.flatMap((i) => subnetHosts(i.address, own)))]
  const open = (await Promise.all(ips.map(async (ip) => ((await openPort(ip, port)) ? ip : null)))).filter((x): x is string => x !== null)
  const infos = await Promise.all(open.map(async (ip) => { const i = await probeInfo(ip, port); return i ? { ip, port, name: i.name, host: i.host, participants: i.participants } : null }))
  return infos.filter((x): x is Found => x !== null)
}

export type FirewallStatus = 'ok' | 'missing' | 'unknown'
/**
 * Windows only. Looks for an inbound allow rule for this program. Best effort: "unknown" when netsh
 * is not usable (not Windows, or no permission), never a false "ok".
 */
export function firewallStatus(exePath: string): Promise<FirewallStatus> {
  if (process.platform !== 'win32') return Promise.resolve('unknown')
  return new Promise((resolve) => {
    execFile('netsh', ['advfirewall', 'firewall', 'show', 'rule', 'name=all', 'dir=in', 'verbose'], { timeout: 8000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve('unknown')
      const blocks = stdout.split(/\r?\n\r?\n/)
      const mine = blocks.filter((b) => b.toLowerCase().includes(exePath.toLowerCase()))
      resolve(mine.some((b) => /Action:\s+Allow/i.test(b) && /Enabled:\s+Yes/i.test(b)) ? 'ok' : 'missing')
    })
  })
}

/** Command an administrator runs once, shown in the app and in the firewall guide. */
export const firewallCommand = (exePath: string) =>
  `netsh advfirewall firewall add rule name="Mirror Studio" dir=in action=allow program="${exePath}" enable=yes profile=private,domain`
