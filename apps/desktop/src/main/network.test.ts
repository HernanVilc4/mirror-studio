import { describe, it, expect, afterEach } from 'vitest'
import { listInterfaces, pickInterface, subnetHosts, scanLan, firewallCommand, parseFirewall, type NetworkInterfaces } from './network'
import { MeetingHost } from './meeting'
import { MeetingServer } from './meeting-net'

const nic = (address: string, mac = '00:11:22:33:44:55') => [{ family: 'IPv4', internal: false, address, netmask: '255.255.255.0', mac }]

describe('interface choice', () => {
  const src: NetworkInterfaces = {
    lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1', netmask: '255.0.0.0', mac: '00' }],
    'vEthernet (WSL)': nic('172.20.0.1'),
    'VMware Network Adapter VMnet8': nic('192.168.37.1'),
    'Wi-Fi': nic('10.0.0.50'),
    Ethernet: nic('192.168.10.24'),
    'Ethernet 2': nic('169.254.12.9'), // no DHCP lease
    v6: [{ family: 'IPv6', internal: false, address: 'fe80::1', netmask: 'ffff::', mac: '00' }]
  }
  it('ignores loopback, IPv6 and link-local addresses', () => {
    expect(listInterfaces(src).map((i) => i.address).sort()).toEqual(['10.0.0.50', '172.20.0.1', '192.168.10.24', '192.168.37.1'])
  })
  it('prefers wired over Wi-Fi over virtual adapters', () => {
    expect(pickInterface(listInterfaces(src))?.address).toBe('192.168.10.24')
    // a VirtualBox host-only adapter named like a real NIC must lose to the real Ethernet
    expect(pickInterface(listInterfaces({ 'Ethernet 3': nic('192.168.56.1', '0a:00:27:00:00:0c'), Ethernet: nic('172.22.1.43') }))?.address).toBe('172.22.1.43')
    expect(pickInterface(listInterfaces({ 'Wi-Fi': nic('10.0.0.50'), 'vEthernet (WSL)': nic('172.20.0.1') }))?.address).toBe('10.0.0.50')
  })
  it('returns undefined with no network', () => expect(pickInterface([])).toBeUndefined())
})

describe('subnet', () => {
  it('lists the /24 without our own address', () => {
    const h = subnetHosts('192.168.10.24', new Set(['192.168.10.24']))
    expect(h).toHaveLength(253)
    expect(h).not.toContain('192.168.10.24')
    expect(h[0]).toBe('192.168.10.1')
  })
})

describe('scanLan', () => {
  let srv: MeetingServer
  afterEach(() => srv?.stop())
  it('finds a running meeting and reads its public info', async () => {
    const m = new MeetingHost('Clase de Redes'); m.join('Ana', { send() {}, close() {} })
    srv = new MeetingServer(m, 'AAAAAAAA', 'PC-1', 1000)
    const port = await srv.start(0, '127.0.0.1')
    // Pretend 127.0.0.x is a wired /24 so the scan probes loopback.
    const found = await scanLan(port, { Ethernet: nic('127.0.0.200') })
    expect(found).toEqual([{ ip: '127.0.0.1', port, name: 'Clase de Redes', host: 'PC-1', participants: 1 }])
  })
  it('finds nothing when no meeting is open', async () => {
    expect(await scanLan(1, { Ethernet: nic('127.0.0.200') })).toEqual([])
  })
})

describe('firewall command', () => {
  it('allows the program on private and domain networks only', () => {
    const c = firewallCommand('C:\\Program Files\\Mirror Studio\\Mirror Studio.exe')
    expect(c).toContain('program="C:\\Program Files\\Mirror Studio\\Mirror Studio.exe"')
    expect(c).toContain('profile=private,domain')
    expect(c).not.toContain('public')
  })
})

describe('firewall rule detection', () => {
  // Spanish Windows 11, port-based rule, as netsh prints it (accents may arrive mangled by the OEM code page).
  const es = 'Nombre de regla:   Mirror Studio\r\n------\r\nHabilitada:   Sí\r\nDirección:   Dentro\r\nProtocolo:   TCP\r\nLocalPort:   47800\r\nAcción:   Permitir\r\n'
  const exe = 'C:/x/app.exe'
  it('accepts a Spanish port rule', () => expect(parseFirewall(es, exe, 47800)).toBe('ok'))
  it('accepts it with mangled accents', () => expect(parseFirewall(es.replace('Sí', 'S\uFFFD').replace('Acción', 'Acci\uFFFDn'), exe, 47800)).toBe('ok'))
  it('ignores a rule for another port', () => expect(parseFirewall(es.replace('47800', '47801'), exe, 47800)).toBe('missing'))
  it('rejects a disabled rule', () => expect(parseFirewall(es.replace('Sí', 'No'), exe, 47800)).toBe('missing'))
  it('accepts an English program rule', () => expect(parseFirewall(`Enabled: Yes\nProgram: ${exe}\nAction: Allow\n`, exe, 47800)).toBe('ok'))
})
