import { contextBridge, ipcRenderer } from 'electron'

const on = (ch: string, cb: (...a: any[]) => void) => {
  const h = (_: unknown, ...a: any[]) => cb(...a)
  ipcRenderer.on(ch, h)
  return () => ipcRenderer.off(ch, h)
}

// Narrow, explicit surface: no generic ipcRenderer exposure.
const api = {
  invite: () => ipcRenderer.invoke('invite') as Promise<{ payload: { host: string; port: number; token: string }; ips: string[]; qr: string }>,
  discover: () => ipcRenderer.invoke('discover') as Promise<string[]>,
  hostInfo: () => ipcRenderer.invoke('host-info') as Promise<{ name: string; model: string }>,
  selftest: () => ipcRenderer.invoke('selftest') as Promise<boolean>,
  selftestLoop: () => ipcRenderer.invoke('selftest-loop') as Promise<boolean>,
  approve: (id: string) => ipcRenderer.invoke('approve', id),
  reject: (id: string) => ipcRenderer.invoke('reject', id),
  close: (id: string) => ipcRenderer.invoke('close', id),
  answer: (id: string, sdp: string) => ipcRenderer.invoke('answer', id, sdp),
  ice: (id: string, ice: object) => ipcRenderer.invoke('ice', id, ice),
  onPairingRequest: (cb: (r: { sessionId: string; name: string; model: string }) => void) => on('pairing-request', cb),
  onOffer: (cb: (id: string, sdp: string) => void) => on('offer', cb),
  onIce: (cb: (id: string, m: any) => void) => on('ice', cb),
  onClosed: (cb: (id: string) => void) => on('closed', cb)
}
contextBridge.exposeInMainWorld('studio', api)
export type StudioApi = typeof api
