import { useEffect, useRef, useState } from 'react'
import {
  canAssign, canKick, canPresent, canRequestControl, formatCode, isValidCode, mapPointToVideo,
  type ControlInput, type Participant, type Role
} from '@mirror-studio/protocol'
import type { CaptureSource } from '../../preload'
import { useUi, selfOf, type Intent } from './store'
import * as C from './controller'

const ROLE_LABEL: Record<Role, string> = { creator: 'Creador', admin: 'Administrador', teacher: 'Docente', participant: 'Participante' }

const btn = 'rounded-xl px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40'
const primary = `${btn} bg-accent text-white hover:brightness-110`
const quiet = `${btn} bg-line text-white hover:bg-line/70`
const field = 'w-full rounded-xl border border-line bg-bg px-3 py-2.5 text-sm outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30'

export function App() {
  const hash = new URLSearchParams(location.hash.slice(1))
  if (hash.has('banner')) return <Banner name={hash.get('banner') ?? ''} id={hash.get('id') ?? ''} />
  return <Main />
}

function Main() {
  const phase = useUi((s) => s.phase)
  useEffect(() => { C.init(); return C.dispose }, [])
  return (
    <div className="flex h-full flex-col">
      <Notices />
      {phase === 'home' && <Home />}
      {phase === 'prep' && <Prep />}
      {phase === 'room' && <Room />}
      <AskDialog />
    </div>
  )
}

// ---- Icons and round controls (Meet-style: icon only, name in tooltip and aria-label) ------------------

type IconName = 'present' | 'cursor' | 'leave' | 'more' | 'stop'
const PATHS: Record<IconName, React.ReactNode> = {
  'present': <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4M12 13V8M9.5 10.5L12 8l2.5 2.5" /></>,
  'stop': <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /><rect x="9" y="7" width="6" height="6" rx="1" /></>,
  'cursor': <path d="M5 3l14 7-6 2-2 6z" />,
  'leave': <path d="M3 14c5-4.5 13-4.5 18 0l-2.4 2.6-3.3-1.4v-2.6a9 9 0 0 0-6.6 0V15.2l-3.3 1.4z" />,
  'more': <><circle cx="12" cy="5" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="12" cy="19" r="1.2" /></>
}
function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{PATHS[name]}</svg>
}
/** Round control. The name lives in the tooltip and aria-label, like Meet's call bar. */
function Round({ label, icon, onClick, tone = 'neutral', pressed, short }: { short?: string; label: string; icon: IconName; onClick: () => void; tone?: 'neutral' | 'danger' | 'accent' | 'leave'; pressed?: boolean }) {
  const tones = { neutral: 'bg-line text-white hover:bg-[#3a3f4a]', danger: 'bg-red-500/90 text-white hover:bg-red-500', accent: 'bg-accent text-white hover:brightness-110', leave: 'bg-red-600 text-white hover:bg-red-500' }
  return (
    <button aria-label={label} title={label} aria-pressed={pressed} onClick={onClick}
      className="group flex flex-col items-center gap-1 focus-visible:outline-none">
      <span className={`grid h-12 place-items-center rounded-full shadow-lg transition-all group-hover:scale-105 group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-accent ${tone === 'leave' ? 'w-16' : 'w-12'} ${tones[tone]}`}><Icon name={icon} /></span>
      <span className="text-[11px] text-muted">{short ?? label}</span>
    </button>
  )
}
const Avatar = ({ name, size = 'h-8 w-8 text-sm' }: { name: string; size?: string }) => (
  <span aria-hidden className={`grid shrink-0 place-items-center rounded-full bg-accent/25 font-medium ${size}`}>{name.slice(0, 1).toUpperCase()}</span>
)

// ---- Shared ----------------------------------------------------------------------------------------

function Notices() {
  const notices = useUi((s) => s.notices)
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed bottom-24 left-1/2 z-50 flex w-[28rem] max-w-[90vw] -translate-x-1/2 flex-col gap-2">
      {notices.map((n) => <div key={n.id} className="anim-pop rounded-xl border border-l-4 border-line border-l-accent bg-surface px-4 py-3 text-sm shadow-xl">{n.text}</div>)}
    </div>
  )
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose?: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus() }, [])
  return (
    <div className="anim-pop fixed inset-0 z-40 grid place-items-center bg-black/60 backdrop-blur-sm" onKeyDown={(e) => e.key === 'Escape' && onClose?.()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="anim-rise w-[28rem] max-w-[92vw] rounded-2xl border border-line bg-surface p-6 shadow-2xl">
        <h2 className="mb-3 text-lg font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  )
}

// ---- Home ------------------------------------------------------------------------------------------

function Home() {
  const { net, found, scanning, myName, set } = useUi()
  const [name, setName] = useState('')
  const [help, setHelp] = useState(false)
  const start = (i: Intent) => C.openPrep(i)
  return (
    <>
      <header className="flex items-center justify-between border-b border-line bg-surface/60 px-6 py-3.5 backdrop-blur">
        <h1 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight"><span aria-hidden className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-white"><Icon name="present" size={18} /></span>Mirror Studio</h1>
        <label className="flex items-center gap-2 whitespace-nowrap text-sm text-muted">Mi nombre
          <input className={`${field} w-44`} value={myName} maxLength={64} onChange={(e) => set({ myName: e.target.value })} />
        </label>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 overflow-auto p-6">
        <section className="grid gap-4 sm:grid-cols-2" aria-label="Crear o unirse">
          <form className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5 shadow-lg shadow-black/20" onSubmit={(e) => { e.preventDefault(); start({ kind: 'host', meetingName: name.trim() || `Reunión de ${myName}` }) }}>
            <h2 className="text-base font-semibold">Crear reunión</h2>
            <label className="text-xs text-muted">Nombre de la reunión
              <input className={`${field} mt-1`} value={name} maxLength={64} placeholder={`Reunión de ${myName || 'mí'}`} onChange={(e) => setName(e.target.value)} />
            </label>
            <button className={primary} type="submit">+ Crear reunión</button>
          </form>
          <ManualJoin onJoin={(ip, port) => start({ kind: 'join', ip, port, label: ip })} />
        </section>

        <section aria-label="Reuniones detectadas" className="rounded-2xl border border-line bg-surface p-5 shadow-lg shadow-black/20">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-base font-semibold">Reuniones detectadas en tu red</h2>
            <button className="text-sm text-accent disabled:text-muted" disabled={scanning} onClick={() => void C.scan()}>{scanning ? 'Buscando…' : 'Buscar ahora'}</button>
          </div>
          {found.length === 0 && (
            <p className="text-sm text-muted">{scanning ? 'Buscando reuniones…' : 'No se detectaron reuniones. Si tu red está dividida en VLAN, usa «Unirse con IP y código».'}</p>
          )}
          <ul className="flex flex-col gap-2">
            {found.map((f) => (
              <li key={`${f.ip}:${f.port}`} className="flex items-center justify-between rounded-xl border border-transparent bg-line/50 px-4 py-3 transition-colors hover:border-accent/50">
                <div className="min-w-0"><div className="truncate font-medium">{f.name}</div><div className="truncate text-xs text-muted">{f.host} · {f.ip} · {f.participants} {f.participants === 1 ? 'persona' : 'personas'}</div></div>
                <button className={primary} onClick={() => start({ kind: 'join', ip: f.ip, port: f.port, label: f.name })}>Unirse</button>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <footer className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line bg-surface/60 px-6 py-2.5 text-xs text-muted">
        <span>{net?.chosen ? <>Red: <b className="text-white">{net.chosen}</b>{net.ifaces.length > 1 && ` (${net.ifaces.length} adaptadores)`}</> : <span className="text-amber-300">Sin red detectada: conecta el cable Ethernet.</span>}</span>
        <span>Firewall: {net?.firewall === 'ok' ? <span className="text-ok">permitido</span> : net?.firewall === 'missing' ? <span className="text-amber-300">falta la regla</span> : 'sin verificar'}</span>
        <button className="text-accent underline" onClick={() => setHelp(true)}>Ayuda de red y firewall</button>
        {net && !net.controllable && <span>Este equipo no admite ser controlado (solo Windows).</span>}
      </footer>
      {help && net && <NetworkHelp onClose={() => setHelp(false)} />}
    </>
  )
}

function ManualJoin({ onJoin }: { onJoin: (ip: string, port: number) => void }) {
  const [addr, setAddr] = useState('')
  const [err, setErr] = useState('')
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const m = addr.trim().match(/^([\w.-]+)(?::(\d{1,5}))?$/)
    if (!m) return setErr('Escribe la IP del anfitrión, por ejemplo 192.168.10.24')
    onJoin(m[1], m[2] ? Number(m[2]) : 47800)
  }
  return (
    <form className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5 shadow-lg shadow-black/20" onSubmit={submit}>
      <h2 className="text-base font-semibold">Unirse con IP y código</h2>
      <label className="text-xs text-muted">IP del anfitrión
        <input className={`${field} mt-1`} value={addr} placeholder="192.168.10.24" inputMode="decimal" onChange={(e) => { setAddr(e.target.value); setErr('') }} aria-invalid={!!err} />
      </label>
      {err && <p role="alert" className="text-xs text-amber-300">{err}</p>}
      <button className={quiet} type="submit">→ Continuar</button>
    </form>
  )
}

function NetworkHelp({ onClose }: { onClose: () => void }) {
  const net = useUi((s) => s.net)!
  return (
    <Modal title="Red y firewall" onClose={onClose}>
      <div className="flex flex-col gap-3 text-sm text-muted">
        <p>Mirror Studio funciona solo por <b className="text-white">cable Ethernet</b> dentro de la misma red. El puerto es <b className="text-white">{net.port}</b> (TCP).</p>
        <p>Direcciones de este equipo: {net.ifaces.length ? net.ifaces.map((i) => <code key={i.address} className="mr-2 rounded bg-bg px-1">{i.name}: {i.address}</code>) : 'ninguna'}</p>
        <p>Si otros equipos no pueden unirse, permite el programa en el firewall de Windows (como administrador, una sola vez):</p>
        <code className="select-all break-all rounded bg-bg p-2 text-xs text-white">{net.firewallCommand}</code>
        <p>Si las PCs están en redes distintas (VLAN), la detección automática no las verá: usa «Unirse con IP y código».</p>
      </div>
      <div className="mt-4 flex justify-end"><button data-autofocus className={primary} onClick={onClose}>Cerrar</button></div>
    </Modal>
  )
}

// ---- Preparation -----------------------------------------------------------------------------------

function Prep() {
  const { intent, myName, busy, error, set } = useUi()
  const [code, setCode] = useState('')
  if (!intent) return null
  const joining = intent.kind === 'join'
  const ok = myName.trim().length > 0 && (!joining || isValidCode(code))
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-5 p-6">
      <h1 className="text-xl font-semibold">{intent.kind === 'host' ? intent.meetingName : intent.label}</h1>
      <form className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5" onSubmit={(e) => { e.preventDefault(); if (ok) void C.enter(code) }}>
        <label className="text-sm">Tu nombre<input className={`${field} mt-1`} value={myName} maxLength={64} onChange={(e) => set({ myName: e.target.value })} /></label>
        {joining && (
          <label className="text-sm">Código de la reunión
            <input className={`${field} mt-1 font-mono tracking-widest`} value={code} placeholder="XXXX-XXXX" autoCapitalize="characters" autoComplete="off" spellCheck={false} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 9))} aria-describedby="code-help" />
            <span id="code-help" className="mt-1 block text-xs text-muted">Te lo da quien creó la reunión. Son 8 caracteres.</span>
          </label>
        )}
        {error && <p role="alert" className="text-sm text-amber-300">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={quiet} onClick={C.cancelPrep}>Cancelar</button>
          <button type="submit" className={primary} disabled={!ok || busy}>{busy ? 'Entrando…' : intent.kind === 'host' ? 'Crear y entrar' : 'Entrar'}</button>
        </div>
      </form>
    </main>
  )
}

// ---- Room ------------------------------------------------------------------------------------------

function Room() {
  const { state, me, hostInfo, presentation, controlView, sharing, rtt, net } = useUi()
  const self = selfOf(useUi.getState())
  const [picker, setPicker] = useState(false)
  if (!state || !self) return null
  const controlling = state.controls.find((c) => c.controller === me)
  const controlled = state.controls.find((c) => c.target === me)
  const presenter = state.participants.find((p) => p.id === state.presenter)
  const name = (id: string) => state.participants.find((p) => p.id === id)?.name ?? '?'
  const isPresenter = state.presenter === me
  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-2 text-sm">
        <div className="min-w-0"><span className="font-semibold">{state.name}</span><span className="ml-3 text-muted">{state.participants.length} {state.participants.length === 1 ? 'persona' : 'personas'}{rtt !== undefined && ` · ${rtt.toFixed(0)} ms`}</span></div>
        {hostInfo && (
          <div className="flex items-center gap-2" aria-label="Datos para unirse">
            <CopyChip label="IP" value={hostInfo.ip ?? hostInfo.ips[0] ?? '?'} />
            <CopyChip label="Código" value={formatCode(hostInfo.code)} mono />
            <CopyChip label="Todo" value={`${hostInfo.ip ?? hostInfo.ips[0] ?? ''} ${formatCode(hostInfo.code)}`} compact />
          </div>
        )}
      </header>
      {controlled && <div role="alert" className="bg-red-900/60 px-5 py-2 text-sm">{name(controlled.controller)} controla este equipo.</div>}
      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col p-4" aria-label="Presentación">
          {controlling && controlView ? <ControlView target={controlling.target} stream={controlView} name={name(controlling.target)} />
            : controlling ? <Placeholder text={`Esperando la pantalla de ${name(controlling.target)}…`} />
            : presentation && presenter ? <Stage stream={presentation} caption={`${presenter.name} presenta`} />
            : isPresenter ? <Placeholder text="Estás presentando tu pantalla. Nadie ve esto hasta que otros se unan." />
            : presenter ? <Placeholder text={`Esperando la pantalla de ${presenter.name}…`} />
            : <Grid people={state.participants} />}
        </section>
        <aside className="w-80 shrink-0 overflow-auto border-l border-line bg-surface/40 p-3" aria-label="Participantes">
          <h2 className="mb-2 px-1 text-sm font-medium text-muted">Participantes</h2>
          <ul className="flex flex-col gap-1">{state.participants.map((p) => <Row key={p.id} p={p} self={self} controlled={state.controls.some((c) => c.target === p.id)} presenting={state.presenter === p.id} />)}</ul>
          {state.controls.length > 0 && (
            <div className="mt-4 rounded-xl border border-line p-3 text-xs">
              <div className="mb-1 font-medium">Controlando</div>
              {state.controls.map((c) => (
                <div key={c.controller + c.target} className="flex items-center justify-between gap-2 py-0.5">
                  <span className="truncate">{name(c.controller)} → {name(c.target)}</span>
                  {(c.controller === me || c.target === me) && <button className="text-red-300 underline" onClick={() => C.revokeControl(c.controller === me ? c.target : c.controller)}>Detener</button>}
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
      <nav className="flex items-center justify-center gap-3 border-t border-line bg-surface/60 p-3.5" aria-label="Controles de la reunión">
        {canPresent(self.role) && (isPresenter || sharing
          ? <Round short="Detener" label="Dejar de presentar" icon="stop" tone="accent" onClick={C.stopPresent} />
          : <Round short="Presentar" label="Presentar pantalla" icon="present" onClick={() => setPicker(true)} />)}
        {controlling && <Round short="Soltar control" label="Dejar de controlar" icon="cursor" tone="danger" onClick={() => C.revokeControl(controlling.target)} />}
        <Round short={self.role === 'creator' ? 'Terminar' : 'Salir'} label={self.role === 'creator' ? 'Terminar reunión para todos' : 'Salir de la reunión'} icon="leave" tone="leave" onClick={C.leave} />
      </nav>
      {picker && <SourcePicker onClose={() => setPicker(false)} />}
    </>
  )
}

/** One value with its own copy button: the IP and the code are usually typed on another PC, one at a time. */
function CopyChip({ label, value, mono, compact }: { label: string; value: string; mono?: boolean; compact?: boolean }) {
  const [done, setDone] = useState(false)
  const copy = () => { void navigator.clipboard.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1500) }) }
  return (
    <button onClick={copy} title={`Copiar ${label.toLowerCase()}: ${value}`} aria-label={`Copiar ${label.toLowerCase()} ${value}`}
      className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-accent ${done ? 'border-ok/60 bg-ok/10 text-ok' : 'border-line bg-line/60 hover:border-accent/60'}`}>
      {!compact && <><span className="text-muted">{label}</span><b className={mono ? 'font-mono tracking-wider' : ''}>{value}</b></>}
      <span className="text-xs text-accent">{done ? '¡Copiado!' : compact ? 'Copiar todo' : 'Copiar'}</span>
    </button>
  )
}
function Placeholder({ text }: { text: string }) {
  return <div className="grid flex-1 place-items-center rounded-2xl border border-dashed border-line text-sm text-muted">{text}</div>
}
function Grid({ people }: { people: Participant[] }) {
  return (
    <div className="grid flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(300px,1fr))] content-start gap-4 overflow-auto">
      {people.length === 1 && <p className="col-span-full rounded-xl border border-dashed border-line px-4 py-3 text-center text-sm text-muted">Eres la única persona por ahora. Comparte la IP y el código de arriba para que otros se unan, o pulsa «Presentar».</p>}
      {people.map((p) => (
        <div key={p.id} className="relative grid aspect-video place-items-center rounded-xl border border-line bg-surface shadow-md shadow-black/20">
          <Avatar name={p.name} size="h-20 w-20 text-3xl" />
          <span className="absolute bottom-2 left-3 max-w-[80%] truncate rounded-md bg-black/40 px-2 py-0.5 text-sm">{p.name}</span>
        </div>
      ))}
    </div>
  )
}
function Stage({ stream, caption }: { stream: MediaStream; caption: string }) {
  const v = useRef<HTMLVideoElement>(null)
  useEffect(() => { if (v.current) v.current.srcObject = stream }, [stream])
  return (
    <figure className="flex min-h-0 flex-1 flex-col gap-2">
      <video ref={v} autoPlay muted playsInline className="min-h-0 w-full flex-1 rounded-xl bg-black object-contain shadow-2xl ring-1 ring-line" />
      <figcaption className="text-xs text-muted">{caption}</figcaption>
    </figure>
  )
}

function Row({ p, self, controlled, presenting }: { p: Participant; self: Participant; controlled: boolean; presenting: boolean }) {
  const [open, setOpen] = useState(false)
  const isMe = p.id === self.id
  const actions: [string, () => void][] = []
  if (!isMe) {
    if (canRequestControl(self.role)) actions.push(['Pedir control de su PC', () => C.requestControl(p.id)])
    if (canAssign(self.role, p.role, 'teacher') && p.role !== 'teacher') actions.push(['Hacer docente', () => C.setRole(p.id, 'teacher')])
    if (canAssign(self.role, p.role, 'admin') && p.role !== 'admin') actions.push(['Hacer administrador', () => C.setRole(p.id, 'admin')])
    if (canAssign(self.role, p.role, 'participant') && p.role !== 'participant') actions.push(['Quitar rol', () => C.setRole(p.id, 'participant')])
    if (canKick(self.role, p.role)) actions.push(['Expulsar', () => C.kick(p.id)])
  }
  return (
    <li className="relative rounded-lg px-2 py-1.5 hover:bg-surface">
      <div className="flex items-center gap-3">
        <Avatar name={p.name} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm">{p.name}{isMe && ' (tú)'}</div>
          {(p.role !== 'participant' || presenting || controlled) && (
            <div className="truncate text-xs text-muted">{[p.role !== 'participant' && ROLE_LABEL[p.role], presenting && 'presentando', controlled && 'controlado'].filter(Boolean).join(' · ')}</div>
          )}
        </div>
        {actions.length > 0 && (
          <button className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-line hover:text-white focus-visible:outline-2 focus-visible:outline-accent" aria-label={`Más acciones para ${p.name}`} title="Más acciones" aria-expanded={open} onClick={() => setOpen(!open)}>
            <Icon name="more" size={18} />
          </button>
        )}
      </div>
      {open && (
        <ul className="anim-pop absolute right-1 top-11 z-20 w-60 rounded-xl border border-line bg-surface p-1 shadow-xl" onMouseLeave={() => setOpen(false)}>
          {actions.map(([label, run]) => <li key={label}><button className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-line" onClick={() => { setOpen(false); run() }}>{label}</button></li>)}
        </ul>
      )}
    </li>
  )
}

function SourcePicker({ onClose }: { onClose: () => void }) {
  const net = useUi((s) => s.net)
  const canAudio = net?.systemAudio ?? false
  const [audio, setAudio] = useState(canAudio)
  const [sources, setSources] = useState<CaptureSource[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    // Listing windows can be slow or fail (no permission, no compositor). Never leave the user stuck.
    const t = setTimeout(() => setFailed(true), 8000)
    window.studio.sources().then((s) => { clearTimeout(t); setSources(s) }).catch(() => { clearTimeout(t); setFailed(true) })
    return () => clearTimeout(t)
  }, [])
  const go = (id: string | null) => { onClose(); void C.present(id, audio && canAudio) }
  return (
    <Modal title="¿Qué quieres presentar?" onClose={onClose}>
      <button data-autofocus className={`${primary} mb-3 w-full`} onClick={() => go(null)}>Pantalla principal</button>
      {!sources && !failed && <p className="text-sm text-muted">Buscando otras pantallas y ventanas…</p>}
      {failed && !sources && <p role="alert" className="text-sm text-amber-300">No se pudo listar las ventanas. Puedes presentar la pantalla principal.</p>}
      {sources && (
        <ul className="grid max-h-64 grid-cols-2 gap-2 overflow-auto">
          {sources.map((s) => (
            <li key={s.id}>
              <button className="w-full rounded-xl border border-line p-2 text-left hover:border-accent focus-visible:outline-2 focus-visible:outline-accent" onClick={() => go(s.id)}>
                <img src={s.thumb} alt="" className="aspect-video w-full rounded bg-black object-contain" />
                <div className="mt-1 truncate text-xs">{s.name}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className={`mt-4 flex items-start gap-2 text-sm ${canAudio ? '' : 'text-muted'}`}>
        <input type="checkbox" className="mt-1" checked={audio && canAudio} disabled={!canAudio} onChange={(e) => setAudio(e.target.checked)} />
        <span>Compartir también el sonido de esta PC
          <span className="block text-xs text-muted">{canAudio ? 'Para que todos oigan el audio de un vídeo o una presentación.' : 'Solo disponible en Windows.'}</span>
        </span>
      </label>
      <div className="mt-4 flex justify-end"><button className={quiet} onClick={onClose}>Cancelar</button></div>
    </Modal>
  )
}

// ---- PC control: the controller's view ---------------------------------------------------------------

function ControlView({ target, stream, name }: { target: string; stream: MediaStream; name: string }) {
  const v = useRef<HTMLVideoElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const down = useRef(new Set<string>())
  const buttons = useRef(new Set<'left' | 'right' | 'middle'>())
  const last = useRef(0)
  useEffect(() => { if (v.current) v.current.srcObject = stream }, [stream])
  useEffect(() => { wrap.current?.focus(); return releaseAll }, [])
  const emit = (i: ControlInput) => C.sendInput(target, i)
  function releaseAll() {
    for (const code of down.current) emit({ t: 'key', code, down: false })
    for (const b of buttons.current) emit({ t: 'mouse-button', button: b, down: false })
    down.current.clear(); buttons.current.clear()
  }
  const point = (e: React.PointerEvent | React.WheelEvent) => {
    const el = v.current; if (!el) return null
    const r = el.getBoundingClientRect()
    return mapPointToVideo(e.clientX, e.clientY, { x: r.x, y: r.y, w: r.width, h: r.height }, el.videoWidth, el.videoHeight)
  }
  const btnOf = (b: number) => (b === 2 ? 'right' : b === 1 ? 'middle' : 'left') as 'left' | 'right' | 'middle'
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div ref={wrap} tabIndex={0} aria-label={`Controlando la PC de ${name}. Presiona Ctrl+Alt+Esc en esa PC para detener.`}
        className="min-h-0 flex-1 cursor-crosshair rounded-xl bg-black outline-2 outline-accent focus:outline"
        onBlur={releaseAll}
        onKeyDown={(e) => { e.preventDefault(); if (e.repeat && !/Arrow|Backspace|Delete|Page/.test(e.code)) return; down.current.add(e.code); emit({ t: 'key', code: e.code, down: true }) }}
        onKeyUp={(e) => { e.preventDefault(); down.current.delete(e.code); emit({ t: 'key', code: e.code, down: false }) }}
        onContextMenu={(e) => e.preventDefault()}>
        <video ref={v} autoPlay muted playsInline className="h-full w-full object-contain"
          onPointerMove={(e) => { const t = performance.now(); if (t - last.current < 16) return; last.current = t; const p = point(e); if (p) emit({ t: 'mouse-move', ...p }) }}
          onPointerDown={(e) => { wrap.current?.focus(); const p = point(e); if (!p) return; e.currentTarget.setPointerCapture(e.pointerId); emit({ t: 'mouse-move', ...p }); buttons.current.add(btnOf(e.button)); emit({ t: 'mouse-button', button: btnOf(e.button), down: true }) }}
          onPointerUp={(e) => { const p = point(e); if (p) emit({ t: 'mouse-move', ...p }); buttons.current.delete(btnOf(e.button)); emit({ t: 'mouse-button', button: btnOf(e.button), down: false }) }}
          onPointerCancel={releaseAll}
          onWheel={(e) => emit({ t: 'wheel', dx: Math.round(e.deltaX), dy: Math.round(e.deltaY) })} />
      </div>
      <p className="text-xs text-muted">Controlas la PC de {name}. Haz clic en la imagen para escribir. Esa persona puede detenerlo en cualquier momento.</p>
    </div>
  )
}

// ---- Consent ---------------------------------------------------------------------------------------

function AskDialog() {
  const { asks, net, phase } = useUi()
  const a = asks[0]
  if (!a || phase !== 'room') return null
  const can = net?.controllable !== false
  return (
    <Modal title="Solicitud de control">
      <p className="mb-2 text-sm"><b>{a.name}</b> quiere controlar tu PC.</p>
      <p className="mb-4 text-sm text-muted">Podrá mover el ratón y usar el teclado, y verá tu pantalla completa. Verás una barra roja arriba mientras dure. Puedes detenerlo cuando quieras con <b>Ctrl+Alt+Esc</b>.</p>
      {!can && <p role="alert" className="mb-3 text-sm text-amber-300">Este equipo no admite control remoto (solo Windows). Se rechazará.</p>}
      <div className="flex justify-end gap-2">
        {/* Focus starts on "Rechazar": pressing Enter by accident must never hand over the PC. */}
        <button data-autofocus className={quiet} onClick={() => C.respondControl(a.controller, false)}>Rechazar</button>
        <button className={primary} disabled={!can} onClick={() => C.respondControl(a.controller, true)}>Permitir</button>
      </div>
    </Modal>
  )
}

/** Always-on-top bar shown by a separate window while this PC is controlled. */
function Banner({ name, id }: { name: string; id: string }) {
  return (
    <div className="flex h-full items-center justify-between gap-3 bg-[#7c2d12] px-4 text-sm text-white" role="alert">
      <span><b>{name}</b> controla esta PC</span>
      <button autoFocus className="rounded-md bg-white px-3 py-1 font-medium text-[#7c2d12]" onClick={() => void window.studio.send({ t: 'control-revoke', other: id })}>Detener control</button>
    </div>
  )
}
