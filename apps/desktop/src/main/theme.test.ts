import { describe, it, expect } from 'vitest'
import { osLabel, isThemeSource } from './theme'

describe('sistema que sigue el tema «Sistema»', () => {
  it('distingue Windows 11 de Windows 10 por el número de compilación', () => {
    expect(osLabel('win32', '10.0.26300')).toBe('Windows 11')
    expect(osLabel('win32', '10.0.19045')).toBe('Windows 10')
  })
  it('lee el nombre de la distribución Linux', () => {
    expect(osLabel('linux', '', () => 'PRETTY_NAME="Ubuntu 24.04.1 LTS"\nNAME="Ubuntu"\nVERSION_ID="24.04"\n')).toBe('Ubuntu')
    expect(osLabel('linux', '', () => { throw new Error('sin os-release') })).toBe('Linux')
  })
  it('solo acepta los tres temas', () => {
    expect(['system', 'light', 'dark'].every(isThemeSource)).toBe(true)
    expect(isThemeSource('azul')).toBe(false)
  })
})
