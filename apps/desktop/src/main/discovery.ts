import { networkInterfaces } from 'node:os'
import { connect } from 'node:net'

export const PORT = 47800

function probe(ip: string, port: number, ms = 350): Promise<boolean> {
  return new Promise((resolve) => {
    const s = connect({ host: ip, port, timeout: ms })
    s.once('connect', () => { s.destroy(); resolve(true) })
    s.once('timeout', () => { s.destroy(); resolve(false) })
    s.once('error', () => resolve(false))
  })
}

/**
 * Finds other Mirror Studio desktops on every local IPv4 /24 (Wi-Fi, ethernet, hotspot, VPN-less LANs).
 * Probing TCP needs no multicast, so it also works where mDNS is blocked. Own addresses are skipped.
 * shortcut: only /24 subnets are scanned; wider masks (/16) need mDNS, add it if users report misses.
 */
export async function scanLan(): Promise<string[]> {
  const own = new Set<string>(); const prefixes = new Set<string>()
  for (const list of Object.values(networkInterfaces()))
    for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) { own.add(i.address); prefixes.add(i.address.split('.').slice(0, 3).join('.')) }
  const ips = [...prefixes].flatMap((p) => Array.from({ length: 254 }, (_, n) => `${p}.${n + 1}`)).filter((ip) => !own.has(ip))
  const hits = await Promise.all(ips.map(async (ip) => ((await probe(ip, PORT)) ? ip : null)))
  return hits.filter((x): x is string => x !== null)
}
