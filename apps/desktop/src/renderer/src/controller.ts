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
/** Who owns the capture in `screen`: a presentation I asked for, or the primary screen shared because I am being controlled. */
let screenKind: 'present' | 'control' | null = null
let screenSince = 0
let presentTimer = 0
/** What I chose to present, to get it back after someone's remote control forced the whole screen. */
let presentSource: { id: string | null; audio: boolean } | null = null
let scanTimer = 0
let unsub: (() => void) | null = null
let unsubTheme: (() => void) | null = null
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
  ready = boot()
  void window.studio.theme().then((theme) => set({ theme }))
  unsubTheme = window.studio.onTheme((theme) => set({ theme }))
  // Discovery keeps running in the background; an empty list is a valid home screen, so it is not awaited.
  void scan(); scanTimer = window.setInterval(() => ui().phase === 'home' && void scan(), 7000)
}

/**
 * "Main view ready" signal for the brand entrance: the home screen is mounted and can be used once this
 * PC's network info is in (name, address, firewall). It rejects if that fails, and the home shows a retry.
 */
export let ready: Promise<void> = Promise.resolve()
function boot() {
  set({ bootError: '' })
  return window.studio.netInfo()
    .then((net) => set({ net, myName: ui().myName || net.name }))
    .catch((e: unknown) => { set({ bootError: cleanError(e) }); throw e })
}
export function retryBoot() { ready = boot(); ready.catch(() => { /* shown in the home screen */ }) }

export async function setTheme(source: 'system' | 'light' | 'dark') { set({ theme: await window.studio.setTheme(source) }) }
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
  set({ phase: 'home', intent: null, state: null, me: '', hostInfo: null, asks: [], presentation: null, controlView: null, sharing: false, localPreview: null, rtt: undefined })
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
      // Only drop a capture made FOR control. A presentation started a moment ago must survive this late message.
      if (m.target === me && screenKind === 'control') endControlCapture()
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
  const me = ui().me
  if (state.presenter === me) { awaitingPresent = false; clearTimeout(presentTimer) }
  const controlled = state.controls.some((c) => c.target === me)
  if (screen && !awaitingPresent) {
    if (screenKind === 'present' && state.presenter !== me) releaseScreen() // someone else took over, or the host dropped me
    // A control capture starts before the state that lists it can arrive, so give it a moment before judging.
    else if (screenKind === 'control' && !controlled && Date.now() - screenSince > 2500) endControlCapture()
  }
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

function attachScreen(s: MediaStream, kind: 'present' | 'control') {
  releaseScreen(); screen = s; screenKind = kind; screenSince = Date.now()
  const t = s.getVideoTracks()[0]
  t.onended = () => stopPresent()
  const a = s.getAudioTracks()[0] ?? null
  hub?.setLocalScreen(t, a); void guest?.setScreen(t, a)
  // While presenting, the control capture IS what the others see, so I keep seeing it too.
  set({ sharing: true, localPreview: kind === 'present' || ui().state?.presenter === ui().me ? s : null })
}
function releaseScreen() {
  screen?.getTracks().forEach((t) => t.stop()); screen = null; screenKind = null
  hub?.setLocalScreen(null, null); void guest?.setScreen(null, null)
  set({ sharing: false, localPreview: null })
}
/**
 * Control of this PC ended. If I am still presenting, the capture must NOT be dropped (the others would
 * be left with a frozen picture): it becomes my presentation again, then the source I had chosen
 * (a window, my sound) is captured back.
 */
function endControlCapture() {
  const me = ui().me
  if (ui().state?.presenter !== me && !awaitingPresent) { releaseScreen(); return }
  screenKind = 'present'; set({ localPreview: screen })
  const src = presentSource
  if (src && (src.id !== null || src.audio)) {
    captureScreen(src.id, 'detail', src.audio)
      .then((s) => { if (screenKind === 'present' && ui().state?.presenter === ui().me) attachScreen(s, 'present'); else s.getTracks().forEach((t) => t.stop()) })
      .catch(() => { /* keep sharing the whole screen */ })
  }
}

/** `withAudio`: also share this PC's sound (a video's soundtrack, for example). Windows only. */
export async function present(sourceId: string | null, withAudio = false) {
  // Presenting and remote-controlling at once is ambiguous (which one fills the stage?): presenting wins, control ends.
  const me = ui().me
  for (const c of ui().state?.controls ?? []) if (c.controller === me) send({ t: 'control-revoke', other: c.target })
  try {
    const s = await captureScreen(sourceId, 'detail', withAudio)
    if (withAudio && s.getAudioTracks().length === 0) notify('No se pudo capturar el audio de esta PC. Se presenta solo la imagen.')
    presentSource = { id: sourceId, audio: withAudio }
    attachScreen(s, 'present')
    awaitingPresent = true
    send({ t: 'present-start' })
    // If the host never confirms (refused silently, network hiccup) do not stay half-presenting forever.
    clearTimeout(presentTimer)
    presentTimer = window.setTimeout(() => {
      if (!awaitingPresent) return
      awaitingPresent = false
      if (ui().state?.presenter !== ui().me) { releaseScreen(); notify('El anfitrión no confirmó la presentación. Inténtalo otra vez.') }
    }, 6000)
  } catch (e) {
    console.error('captureScreen', e)
    notify(`No se pudo capturar la pantalla: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`)
  }
}
export function stopPresent() {
  presentSource = null
  awaitingPresent = false; clearTimeout(presentTimer)
  if (ui().state?.presenter === ui().me) send({ t: 'present-stop' })
  releaseScreen()
}
/** The controlled PC must show its primary screen: control coordinates are normalized over it. */
async function startControlCapture() {
  try { attachScreen(await captureScreen(null, 'motion'), 'control') } catch {
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

export function dispose() { unsub?.(); unsub = null; unsubTheme?.(); unsubTheme = null; clearInterval(scanTimer) }
