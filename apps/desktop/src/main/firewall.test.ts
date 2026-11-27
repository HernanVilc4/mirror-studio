import { describe, it, expect } from 'vitest'
import { assessFirewall, type FirewallDiag } from './firewall'

const on = (name: string) => ({ name, enabled: 'True', local: 'NotConfigured' })
const base = (o: Partial<FirewallDiag>): FirewallDiag => ({ rules: [], profiles: [on('Domain'), on('Private'), on('Public')], networks: [{ alias: 'Ethernet', category: 'Public' }], ...o })

describe('firewall assessment', () => {
  it('ok with an enabled allow rule for every profile', () => {
    expect(assessFirewall(base({ rules: [{ name: 'Mirror Studio', enabled: 'True', action: 'Allow', profile: 'Any' }] })).status).toBe('ok')
  })
  it('the old installer rule (Private, Domain) does not cover a Public lab network: repair', () => {
    const a = assessFirewall(base({ rules: [{ name: 'Mirror Studio', enabled: 'True', action: 'Allow', profile: 'Domain, Private' }] }))
    expect(a.status).toBe('repair'); expect(a.active).toEqual(['Public'])
  })
  it('a block rule (cancelled Windows alert) wins over an allow: repair', () => {
    const a = assessFirewall(base({ rules: [
      { name: 'Mirror Studio', enabled: 'True', action: 'Allow', profile: 'Any' },
      { name: 'mirror studio.exe', enabled: 'True', action: 'Block', profile: 'Public' }
    ] }))
    expect(a.status).toBe('repair'); expect(a.reasons[0]).toMatch(/BLOQUEA/)
  })
  it('disabled rules do not count', () => {
    expect(assessFirewall(base({ rules: [{ name: 'Mirror Studio', enabled: 'False', action: 'Allow', profile: 'Any' }] })).status).toBe('repair')
  })
  it('no rule at all: repair; firewall off for the active profile: ok', () => {
    expect(assessFirewall(base({})).status).toBe('repair')
    expect(assessFirewall(base({ profiles: [on('Domain'), on('Private'), { name: 'Public', enabled: 'False', local: 'NotConfigured' }] })).status).toBe('ok')
  })
  it('a domain policy that ignores local rules cannot be fixed from the app', () => {
    expect(assessFirewall(base({ profiles: [{ name: 'Public', enabled: 'True', local: 'False' }] })).status).toBe('policy')
  })
  it('unknown network category: every profile must be allowed', () => {
    const a = assessFirewall(base({ networks: [], rules: [{ name: 'x', enabled: 'True', action: 'Allow', profile: 'Private' }] }))
    expect(a.status).toBe('repair'); expect(a.reasons.length).toBe(2)
  })
  it('Spanish PowerShell output (Permitir / Bloquear)', () => {
    expect(assessFirewall(base({ rules: [{ name: 'x', enabled: 'True', action: 'Bloquear', profile: 'Any' }] })).status).toBe('repair')
  })
})
