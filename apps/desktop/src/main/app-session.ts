import { DEFAULT_PORT, type ClientMessage, type ServerMessage } from '@mirror-studio/protocol'
import { generateCode, PBKDF2_ITERATIONS } from '@mirror-studio/protocol/src/node'
import { MeetingHost } from './meeting'
import { MeetingClient, MeetingServer } from './meeting-net'
import { RemoteInput, type InputDriver, type InjectorHealth } from './input'

/** What the main process pushes to the window. */
export type UiEvent =
  | { t: 'message'; m: ServerMessage }
  | { t: 'rtc-in'; from: string; kind: 'offer' | 'answer' | 'ice'; data: string }
  | { t: 'closed'; reason: string }
  /** Something only this PC's user needs to read (it never comes from the host). */
  | { t: 'notice'; text: string }

/** While this PC is controlled, how often it checks its injector and tells the controller how it is doing. */
export const HEALTH_MS = 2000

/**
 * One meeting on this PC, either hosting it or joined to someone else's. Electron-free so it can be
 * tested end to end. Owns the rule that matters most for safety: remote input runs only while the host
 * says a grant is active, and every held key is released when it stops for ANY reason.
 */
export class AppSession {
  private meeting?: MeetingHost
  private server?: MeetingServer
  private client?: MeetingClient
  private input: RemoteInput
  private me = ''
  /** True when there is no meeting to end: closing the app outside a meeting must not report a 'closed' meeting. */
  private ended = true
  private names = new Map<string, string>()
  private healthTimer: ReturnType<typeof setInterval> | null = null
  private probing = false
  private lastHealth: InjectorHealth['code'] = 'ok'

  /** `onControlled` fires with the controller when someone starts controlling THIS PC, and with null when it stops. */
  constructor(
    driver: InputDriver, private emit: (e: UiEvent) => void, private iterations = PBKDF2_ITERATIONS,
    private onControlled: (by: { id: string; name: string } | null) => void = () => {},
    private healthMs = HEALTH_MS
  ) {
    this.input = new RemoteInput(driver)
  }
  get id() { return this.me }
  get active() { return !!this.meeting || !!this.client }
  get canBeControlled() { return this.input.supported }
  get controlledBy() { return this.input.controlledBy }

  /** Creates a meeting and becomes its creator. */
  async host(meetingName: string, myName: string, port = DEFAULT_PORT, host = '0.0.0.0'): Promise<{ code: string; port: number }> {
    if (this.active) throw new Error('Ya estás en una reunión')
    const code = generateCode()
    const meeting = new MeetingHost(meetingName.slice(0, 64) || 'Reunión')
    const server = new MeetingServer(meeting, code, myName, this.iterations)
    let boundPort: number
    try { boundPort = await server.start(port, host) } catch (e) {
      throw new Error((e as NodeJS.ErrnoException).code === 'EADDRINUSE'
        ? `El puerto ${port} ya está en uso. ¿Hay otra reunión de Mirror Studio abierta en este equipo?`
        : `No se pudo abrir la reunión: ${(e as Error).message}`)
    }
    this.meeting = meeting; this.server = server; this.ended = false
    meeting.on('rtc', (from: string, msg: { kind: 'offer' | 'answer' | 'ice'; data: string }) => this.emit({ t: 'rtc-in', from, kind: msg.kind, data: msg.data }))
    meeting.on('control-ended', (_c: string, target: string) => { if (target === this.me) this.stopControlled() })
    meeting.on('closed', (reason: string) => this.teardown(reason))
    this.me = meeting.join(myName, { send: (m) => this.onMessage(m), close: () => {} })!
    return { code, port: boundPort }
  }

  /** Joins an existing meeting. Rejects with a message fit to show the user. */
  async join(ip: string, port: number, code: string, myName: string): Promise<void> {
    if (this.active) throw new Error('Ya estás en una reunión')
    const client = new MeetingClient()
    // Messages must be hooked before connect resolves (the welcome can arrive in the same tick).
    // A close BEFORE we got in is a failed join, reported by the rejection, not a meeting that ended.
    let joined = false
    client.on('message', (m: ServerMessage) => this.onMessage(m))
    client.on('closed', (reason: string) => { if (joined) this.teardown(reason) })
    this.ended = false
    await client.connect(ip, port, code, myName, this.iterations)
    joined = true
    this.client = client
  }

  send(msg: ClientMessage) {
    // A PC that cannot inject input must never say yes to control.
    if (msg.t === 'control-respond' && msg.accept && !this.input.supported) {
      this.emit({ t: 'message', m: { t: 'notice', text: 'Este equipo no admite control remoto (solo Windows). Se rechazó la solicitud.' } })
      msg = { ...msg, accept: false }
    }
    if (this.meeting) this.meeting.handle(this.me, msg)
    else this.client?.send(msg)
  }

  /** Host only: the media hub in the window answers a participant's WebRTC offer. */
  rtcOut(to: string, kind: 'offer' | 'answer' | 'ice', data: string) { this.meeting?.sendRtc(to, kind, data) }

  leave() {
    if (this.meeting) this.meeting.leave(this.me)
    else this.client?.close()
    this.teardown('Saliste de la reunión')
  }

  private onMessage(m: ServerMessage) {
    switch (m.t) {
      case 'welcome': this.me = m.you; this.remember(m.state.participants); break
      case 'state': this.remember(m.state.participants); break
      case 'control-started':
        if (m.target === this.me) {
          if (this.input.begin(m.controller)) {
            this.onControlled({ id: m.controller, name: this.names.get(m.controller) ?? 'Alguien' })
            this.watchHealth(m.controller)
          } else this.send({ t: 'control-revoke', other: m.controller })
        }
        break
      case 'control-ended': if (m.target === this.me) this.stopControlled(); break
      // Applied here; the window has no use for dozens of mouse moves a second.
      case 'control-input': this.input.apply(m.from, m.input); return
      case 'control-reset':
        // The controller saw its input or the picture stop: fresh injector now (the window re-captures the screen).
        if (m.from === this.input.controlledBy) { this.input.reset(); void this.reportHealth(m.from) }
        break
      case 'closed': this.stopControlled(); break
    }
    this.emit({ t: 'message', m })
  }

  private remember(list: { id: string; name: string }[]) { this.names = new Map(list.map((p) => [p.id, p.name])) }
  private stopControlled() {
    this.stopHealth()
    const was = this.input.active
    this.input.end() // releases every held key and button
    if (was) this.onControlled(null)
  }

  // ---- health of the control of THIS PC ----------------------------------------------------------

  private watchHealth(controller: string) {
    this.stopHealth()
    this.lastHealth = 'ok'
    this.healthTimer = setInterval(() => void this.reportHealth(controller), this.healthMs)
    void this.reportHealth(controller)
  }
  private stopHealth() { if (this.healthTimer) clearInterval(this.healthTimer); this.healthTimer = null }
  /** Probes the injector (restarting it if stuck) and tells the controller, which shows it and can ask for a reset. */
  private async reportHealth(controller: string) {
    if (this.probing) return
    this.probing = true
    try {
      const h = await this.input.probe()
      if (this.input.controlledBy !== controller) return // control ended while probing
      this.send({ t: 'control-status', other: controller, health: { ...h, received: this.input.received } })
      if (h.code !== this.lastHealth) {
        this.lastHealth = h.code
        // The person in front of this PC is the only one who can fix this one.
        if (h.code === 'blocked-admin') {
          this.emit({ t: 'notice', text: `Windows no deja que te controlen mientras ${h.detail && h.detail !== '?' ? `«${h.detail}»` : 'una ventana de administrador'} está delante. Cámbiala o ciérrala.` })
        }
      }
    } catch (e) {
      console.error('[control] health check failed', e)
    } finally { this.probing = false }
  }

  private teardown(reason: string) {
    if (this.ended) return
    this.ended = true
    this.stopControlled() // a dropped cable or a crashed host must not leave keys held
    this.server?.stop(); this.server = undefined
    this.meeting = undefined; this.client = undefined; this.me = ''
    this.emit({ t: 'closed', reason })
  }

  dispose() { this.leave(); this.input.dispose() }
}
