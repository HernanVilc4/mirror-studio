import { create } from 'zustand'
import type { SessionState } from '@mirror-studio/protocol'
import type { FoundMeeting, NetInfo } from '../../preload'

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
  sharing: boolean
  /** My own presentation, to show it back to me (the "mirror"). Null while not presenting. */
  localPreview: MediaStream | null
  rtt?: number
  set: (p: Partial<Ui>) => void
}

let n = 0
export const useUi = create<Ui>((set) => ({
  phase: 'home', intent: null, myName: '', busy: false, error: '',
  net: null, found: [], scanning: false, hostInfo: null, state: null, me: '', notices: [], asks: [],
  presentation: null, controlView: null, sharing: false, localPreview: null,
  set: (p) => set(p)
}))

export function notify(text: string) {
  const id = ++n
  useUi.setState((s) => ({ notices: [...s.notices.slice(-3), { id, text }] }))
  setTimeout(() => useUi.setState((s) => ({ notices: s.notices.filter((x) => x.id !== id) })), 6000)
}

export const selfOf = (s: Ui) => s.state?.participants.find((p) => p.id === s.me)
