import { contextBridge, ipcRenderer } from 'electron'
import type { ClientMessage } from '@mirror-studio/protocol'
import type { UiEvent } from '../main/app-session'
import type { ThemeInfo, ThemeSource } from '../main/theme'

export type { ThemeInfo, ThemeSource }

export interface NetInfo {
  ifaces: { name: string; address: string }[]; chosen: string | null; port: number
  firewall: 'ok' | 'missing' | 'unknown'; firewallCommand: string; controllable: boolean; systemAudio: boolean; name: string
}
export interface FoundMeeting { ip: string; port: number; name: string; host: string; participants: number }
export interface CaptureSource { id: string; name: string; type: 'screen' | 'window'; thumb: string }

// Narrow, explicit surface: no generic ipcRenderer exposure.
const api = {
  netInfo: () => ipcRenderer.invoke('net-info') as Promise<NetInfo>,
  discover: () => ipcRenderer.invoke('discover') as Promise<FoundMeeting[]>,
  host: (meetingName: string, myName: string) =>
    ipcRenderer.invoke('host', meetingName, myName) as Promise<{ code: string; port: number; ips: string[]; ip: string | null }>,
  join: (ip: string, port: number, code: string, myName: string) => ipcRenderer.invoke('join', ip, port, code, myName) as Promise<void>,
  send: (msg: ClientMessage) => ipcRenderer.invoke('send', msg) as Promise<void>,
  rtcOut: (to: string, kind: 'offer' | 'answer' | 'ice', data: string) => ipcRenderer.invoke('rtc-out', to, kind, data) as Promise<void>,
  leave: () => ipcRenderer.invoke('leave') as Promise<void>,
  sources: () => ipcRenderer.invoke('sources') as Promise<CaptureSource[]>,
  pickSource: (id: string | null, audio: boolean) => ipcRenderer.invoke('pick-source', id, audio) as Promise<void>,
  theme: () => ipcRenderer.invoke('theme') as Promise<ThemeInfo>,
  setTheme: (source: ThemeSource) => ipcRenderer.invoke('set-theme', source) as Promise<ThemeInfo>,
  onTheme: (cb: (t: ThemeInfo) => void) => {
    const h = (_: unknown, t: ThemeInfo) => cb(t)
    ipcRenderer.on('theme', h)
    return () => ipcRenderer.off('theme', h)
  },
  onEvent: (cb: (e: UiEvent) => void) => {
    const h = (_: unknown, e: UiEvent) => cb(e)
    ipcRenderer.on('ui', h)
    return () => ipcRenderer.off('ui', h)
  }
}
contextBridge.exposeInMainWorld('studio', api)
export type StudioApi = typeof api
