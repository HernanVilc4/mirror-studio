import type { AssignableRole, ControlInput, ServerMessage, SessionState } from '@mirror-studio/protocol'
import { useUi, notify } from './store'
import { Guest, Hub, captureScreen, type View } from './media'

/**
 * Glue between the main process (meeting events) and the media engine. The window holds no authority:
 * everything it asks for is checked again by the host, so a wrong click or a tampered renderer cannot
 * grant itself anything.
 */
let hub: Hub | null = null
let guest: Guest | null = null
let screen: MediaStream | null = null
let awaitingPresent = false
let scanTimer = 0
let unsub: (() => void) | null = null
let statsTimer = 0

const ui = () => useUi.getState()
const set = (p: Partial<ReturnType<typeof ui>>) => useUi.setState(p)
const send = (m: Parameters<typeof window.studio.send>[0]) => void window.studio.send(m)

// ---- start-up and discovery ----------------------------------------------------------------------

export function init() {
  if (unsub) return
  unsub = window.studio.onEvent((e) => {
    if (e.t === 'message') onMessage(e.m)
    else if (e.t === 'rtc-in') void hub?.onSignal(e.from, e.kind, e.data)
    else if (e.t === 'closed') leaveLocal(e.reason)
  })
  void window.studio.netInfo().then((net) => set({ net, myName: ui().myName || net.name }))
  void scan(); scanTimer = window.setInterval(() => ui().phase === 'home' && void scan(), 7000)
}
export async function scan() {
  set({ scanning: true })
  try { set({ found: await window.studio.discover() }) } finally { set({ scanning: false }) }
}
export const refreshNet = () => window.studio.netInfo().then((net) => set({ net }))

// ---- entering and leaving ------------------------------------------------------------------------

export function openPrep(intent: NonNullable<ReturnType<typeof ui>['intent']>) { set({ intent, phase: 'prep', error: '' }) }
export function cancelPrep() { set({ phase: 'home', intent: null, error: '' }) }

/** Called from the preparation screen. `code` is the session code for joining; hosting generates its own. */
export async function enter(code: string) {
  const { intent, myName } = ui(); if (!intent) return
  set({ busy: true, error: '' })
  try {
    if (intent.kind === 'host') {
      const r = await window.studio.host(intent.meetingName, myName)
      set({ hostInfo: { code: r.code, ip: r.ip, ips: r.ips, port: r.port } })
    } else {
      await window.studio.join(intent.ip, intent.port, code, myName)
    }
    // The room opens when the host's `welcome` arrives (see onMessage).
  } catch (e) {
    set({ error: cleanError(e) })
  } finally { set({ busy: false }) }
}
const cleanError = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function leave() { void window.studio.leave() }
function leaveLocal(reason: string) {
  hub?.close(); hub = null; guest?.close(); guest = null
  releaseScreen(); clearInterval(statsTimer)
  set({ phase: 'home', intent: null, state: null, me: '', hostInfo: null, asks: [], presentation: null, controlView: null, sharing: false, rtt: undefined })
  notify(reason)
  void scan()
}

// ---- events from the host ------------------------------------------------------------------------

function onMessage(m: ServerMessage) {
  switch (m.t) {
    case 'welcome': {
      set({ me: m.you, state: m.state, phase: 'room' })
      startMedia(m.you, m.state)
      break
    }
    case 'state': onState(m.state); break
    case 'control-asked': set({ asks: [...ui().asks, { controller: m.controller, name: m.name }] }); break
    case 'control-started':
      if (m.target === ui().me) void startControlCapture()
      break
    case 'control-ended': {
      set({ asks: ui().asks.filter((a) => a.controller !== m.controller) })
      const me = ui().me
      if (m.target === me && ui().state?.presenter !== me) releaseScreen()
      if (m.target === me || m.controller === me) notify(`Control finalizado: ${m.reason}`)
      break
    }
    case 'notice':
      notify(m.text)
      if (awaitingPresent) { awaitingPresent = false; releaseScreen() } // our request to present was refused
      break
    case 'rtc': void guest?.onSignal(m.kind, m.data); break
    case 'closed': break // the main process follows with a 'closed' UI event
  }
}

function onState(state: SessionState) {
  set({ state })
  hub?.apply(state)
  if (state.presenter === ui().me) awaitingPresent = false
  else if (screen && !awaitingPresent && !state.controls.some((c) => c.target === ui().me)) releaseScreen()
  // Drop asks whose requester left.
  const ids = new Set(state.participants.map((p) => p.id))
  set({ asks: ui().asks.filter((a) => ids.has(a.controller)) })
}

function startMedia(me: string, state: SessionState) {
  const setView = (v: View) => set({ presentation: v.presentation, controlView: v.control })
  if (ui().intent?.kind === 'host') {
    hub = new Hub(me, (to, kind, data) => void window.studio.rtcOut(to, kind, data), setView)
    hub.apply(state)
  } else {
    guest = new Guest((kind, data) => send({ t: 'rtc', kind, data }), setView)
    void guest.start()
    statsTimer = window.setInterval(async () => set({ rtt: (await guest?.stats())?.rtt }), 2000)
  }
}

// ---- actions from the room -----------------------------------------------------------------------

export function kick(target: string) { send({ t: 'kick', target }) }
export function setRole(target: string, role: AssignableRole) { send({ t: 'set-role', target, role }) }

function attachScreen(s: MediaStream) {
  releaseScreen(); screen = s
  const t = s.getVideoTracks()[0]
  t.onended = () => stopPresent()
  const a = s.getAudioTracks()[0] ?? null
  hub?.setLocalScreen(t, a); void guest?.setScreen(t, a)
  set({ sharing: true })
}
function releaseScreen() {
  screen?.getTracks().forEach((t) => t.stop()); screen = null
  hub?.setLocalScreen(null, null); void guest?.setScreen(null, null)
  set({ sharing: false })
}
/** `withAudio`: also share this PC's sound (a video's soundtrack, for example). Windows only. */
export async function present(sourceId: string | null, withAudio = false) {
  try {
    const s = await captureScreen(sourceId, 'detail', withAudio)
    if (withAudio && s.getAudioTracks().length === 0) notify('No se pudo capturar el audio de esta PC. Se presenta solo la imagen.')
    attachScreen(s)
    awaitingPresent = true
    send({ t: 'present-start' })
  } catch (e) {
    console.error('captureScreen', e)
    notify(`No se pudo capturar la pantalla: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`)
  }
}
export function stopPresent() {
  awaitingPresent = false
  if (ui().state?.presenter === ui().me) send({ t: 'present-stop' })
  releaseScreen()
}
/** The controlled PC must show its primary screen: control coordinates are normalized over it. */
async function startControlCapture() {
  try { attachScreen(await captureScreen(null, 'motion')) } catch {
    notify('No se pudo compartir tu pantalla, así que se canceló el control.')
    const c = ui().state?.controls.find((x) => x.target === ui().me)
    if (c) send({ t: 'control-revoke', other: c.controller })
  }
}

export function requestControl(target: string) { send({ t: 'control-request', target }) }
export function respondControl(controller: string, accept: boolean) {
  send({ t: 'control-respond', controller, accept })
  set({ asks: ui().asks.filter((a) => a.controller !== controller) })
}
export function revokeControl(other: string) { send({ t: 'control-revoke', other }) }
export function sendInput(target: string, input: ControlInput) { send({ t: 'control-input', target, input }) }

export function dispose() { unsub?.(); unsub = null; clearInterval(scanTimer) }
