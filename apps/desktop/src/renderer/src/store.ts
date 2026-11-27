import { create } from 'zustand'
import type { ControlHealth, SessionState } from '@mirror-studio/protocol'
import type { FoundMeeting, NetInfo, ThemeInfo } from '../../preload'

export type Phase = 'home' | 'prep' | 'room'
export type Intent = { kind: 'host'; meetingName: string } | { kind: 'join'; ip: string; port: number; label: string }
export interface Notice { id: number; text: string }

export interface Ui {
  phase: Phase
  intent: Intent | null
  myName: string
  busy: boolean
  error: string
  net: NetInfo | null
  found: FoundMeeting[]
  scanning: boolean
  hostInfo: { code: string; ip: string | null; ips: string[]; port: number } | null
  state: SessionState | null
  me: string
  notices: Notice[]
  asks: { controller: string; name: string }[]
  presentation: MediaStream | null
  controlView: MediaStream | null
  /**
   * What the PC I control last reported, when it arrived, and for how many reports in a row the input I
   * sent did not arrive there (`stalled`).
   */
  controlHealth: (ControlHealth & { at: number; stalled: number }) | null
  /** I am presenting (or about to): drives the "Detener" button. A capture made only for being controlled does not count. */
  sharing: boolean
  /** My own presentation, to show it back to me (the "mirror"). Null while not presenting. */
  localPreview: MediaStream | null
  rtt?: number
  /** Links whose video goes through the TCP relay (participant: 0 or 1; host: how many participants). */
  relayCount: number
  /** Current theme and the OS it follows when set to "Sistema" (Windows 10/11, Ubuntu…). */
  theme: ThemeInfo | null
  /** Start-up failed (network info could not be read): shown with a retry button. */
  bootError: string
  set: (p: Partial<Ui>) => void
}

let n = 0
export const useUi = create<Ui>((set) => ({
  phase: 'home', intent: null, myName: '', busy: false, error: '',
  net: null, found: [], scanning: false, hostInfo: null, state: null, me: '', notices: [], asks: [],
  presentation: null, controlView: null, controlHealth: null, sharing: false, localPreview: null, theme: null, bootError: '', relayCount: 0,
  set: (p) => set(p)
}))

export function notify(text: string) {
  const id = ++n
  useUi.setState((s) => ({ notices: [...s.notices.slice(-3), { id, text }] }))
  setTimeout(() => useUi.setState((s) => ({ notices: s.notices.filter((x) => x.id !== id) })), 6000)
}

export const selfOf = (s: Ui) => s.state?.participants.find((p) => p.id === s.me)
