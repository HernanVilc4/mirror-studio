import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// WCAG 2.x contrast of the real tokens in index.css, for both themes. 4.5 = body text, 3 = icons / large text.
const css = readFileSync(join(__dirname, 'index.css'), 'utf8')
const tokens = (block: string) => Object.fromEntries([...block.matchAll(/--color-([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]))
const dark = tokens(css.match(/@theme\s*{([^}]*)}/)![1])
const light = { ...dark, ...tokens(css.match(/prefers-color-scheme: light\)\s*{\s*:root\s*{([^}]*)}/)![1]) }

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

const TEXT: [string, string][] = [
  ['fg', 'bg'], ['fg', 'surface'], ['fg', 'bar'], ['fg', 'hover'],
  ['muted', 'bg'], ['muted', 'surface'], ['muted', 'bar'], ['muted', 'hover'],
  ['accent', 'bg'], ['accent', 'surface'],
  ['on-primary', 'primary'],
  ['warn', 'bg'], ['warn', 'surface'], ['danger', 'bg'], ['danger', 'surface']
]
const UI: [string, string][] = [['ok', 'surface'], ['ok', 'bg'], ['primary', 'bg'], ['accent', 'hover']]

describe.each([['oscuro', dark], ['claro', light]] as const)('contraste del tema %s', (_name, t) => {
  it.each(TEXT)('texto %s sobre %s ≥ 4.5', (fg, bg) => expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5))
  it.each(UI)('icono %s sobre %s ≥ 3', (fg, bg) => expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(3))
})

it('texto blanco sobre los botones rojos (Salir, Terminar, Detener) ≥ 4.5', () => {
  expect(contrast('#FFFFFF', '#DC2626')).toBeGreaterThanOrEqual(4.5) // red-600
})

it('lee los dos temas completos', () => {
  for (const t of [dark, light]) for (const k of ['bg', 'surface', 'fg', 'muted', 'accent', 'primary', 'on-primary', 'warn', 'danger', 'ok']) expect(t[k]).toMatch(/^#/)
  expect(light.bg).not.toBe(dark.bg)
})
