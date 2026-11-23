import { app, nativeTheme, type BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { release } from 'node:os'

export type ThemeSource = 'system' | 'light' | 'dark'
export interface ThemeInfo { source: ThemeSource; dark: boolean; os: string }

/**
 * Window colors of the "Doble Erre" identity. The window paints these before the page loads (cold start),
 * and the OS title-bar buttons (titleBarOverlay) must match the page's own title bar.
 */
export const WINDOW_COLORS = {
  dark: { background: '#0B1020', bar: '#0B1020', symbols: '#E8EBF4' },
  light: { background: '#FFFFFF', bar: '#FFFFFF', symbols: '#0B1020' }
} as const

/** "Windows 11", "Ubuntu"… shown next to the "system theme" option so people know what it follows. */
export function osLabel(platform = process.platform, osRelease = release(), readOsRelease = () => readFileSync('/etc/os-release', 'utf8')): string {
  if (platform === 'win32') return Number(osRelease.split('.')[2] ?? 0) >= 22000 ? 'Windows 11' : 'Windows 10'
  if (platform === 'darwin') return 'macOS'
  if (platform === 'linux') {
    try { return readOsRelease().match(/^NAME="?([^"\n]+)"?/m)?.[1] ?? 'Linux' } catch { return 'Linux' }
  }
  return platform
}

export const isThemeSource = (v: unknown): v is ThemeSource => v === 'system' || v === 'light' || v === 'dark'

const settingsFile = () => join(app.getPath('userData'), 'settings.json')

/** Reads the saved choice and applies it. Electron then also drives the page's prefers-color-scheme. */
export function loadTheme(): void {
  try {
    const saved = JSON.parse(readFileSync(settingsFile(), 'utf8')).theme
    if (isThemeSource(saved)) nativeTheme.themeSource = saved
  } catch { /* first run or unreadable: follow the system */ }
}

export function setTheme(source: ThemeSource): void {
  nativeTheme.themeSource = source
  try { writeFileSync(settingsFile(), JSON.stringify({ theme: source })) } catch { /* not saved: still applied for this run */ }
}

export const themeInfo = (): ThemeInfo => ({ source: nativeTheme.themeSource, dark: nativeTheme.shouldUseDarkColors, os: osLabel() })

/** Keeps the window background and the OS title-bar buttons in the current theme. */
export function paintWindow(win: BrowserWindow): void {
  const c = nativeTheme.shouldUseDarkColors ? WINDOW_COLORS.dark : WINDOW_COLORS.light
  win.setBackgroundColor(c.background)
  try { win.setTitleBarOverlay({ color: c.bar, symbolColor: c.symbols, height: 40 }) } catch { /* platform without overlay */ }
}
