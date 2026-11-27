import { useEffect, useRef, useState } from 'react'
import {
  canAssign, canKick, canPresent, canRequestControl, formatCode, isValidCode, mapPointToVideo,
  type ControlInput, type Participant, type Role
} from '@mirror-studio/protocol'
import type { CaptureSource } from '../../preload'
import { useUi, selfOf, notify, type Intent } from './store'
import * as C from './controller'
import { Isotipo, Wordmark, cssColorToHex } from './brand/brand'

const ROLE_LABEL: Record<Role, string> = { creator: 'Creador', admin: 'Administrador', teacher: 'Docente', participant: 'Participante' }

const btn = 'rounded-xl px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40'
const primary = `${btn} bg-primary text-on-primary hover:opacity-90`
const quiet = `${btn} bg-hover text-fg hover:bg-line`
const field = 'w-full rounded-xl border border-line bg-bg px-3 py-2.5 text-sm outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30'

export function App() {
  const hash = new URLSearchParams(location.hash.slice(1))
  if (hash.has('banner')) return <Banner name={hash.get('banner') ?? ''} id={hash.get('id') ?? ''} />
  return <Main />
}

/** The brand entrance plays once per cold start: not when leaving a meeting, restoring the window or re-rendering. */
let introPlayed = false

function Main() {
  const phase = useUi((s) => s.phase)
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<HTMLDivElement>(null)
  useEffect(() => { C.init(); return C.dispose }, [])
  useEffect(() => {
    if (introPlayed || !host.current || !view.current) return
    introPlayed = true
    const ac = new AbortController()
    const dark = matchMedia('(prefers-color-scheme: dark)').matches
    // Destination: the mark in the home header. Its real color ends the morph, so only one mark is ever seen.
    const anchor = view.current.querySelector<HTMLElement>('[data-brand-anchor]')
    const destinationInk = (anchor && cssColorToHex(getComputedStyle(anchor).color)) || (dark ? '#FFFFFF' : '#0B1020')
    MirrorStudioIntro.play({
      host: host.current, main: view.current, anchor, ready: C.ready, signal: ac.signal,
      focusTarget: view.current.querySelector<HTMLElement>('[data-focus-start]'),
      background: dark ? '#0B1020' : '#FFFFFF', ink: dark ? '#FFFFFF' : '#0B1020', destinationInk
    }).catch(() => { /* AbortError on close; a boot failure is already shown by the home screen with its retry */ })
    return () => { ac.abort(); introPlayed = false }
  }, [])
  return (
    <div ref={host} className="relative h-full">
    <div ref={view} className="flex h-full flex-col">
      <TitleBar />
      <Notices />
      {phase === 'home' && <Home />}
      {phase === 'prep' && <Prep />}
      {phase === 'room' && <Room />}
      <AskDialog />
    </div>
    </div>
  )
}

// ---- Icons and round controls (Meet-style: icon only, name in tooltip and aria-label) ------------------

type IconName = 'present' | 'cursor' | 'leave' | 'more' | 'stop' | 'plus' | 'arrow' | 'refresh' | 'copy' | 'check' | 'help' | 'x' | 'users' | 'expand' | 'shrink' | 'eye' | 'eye-off' | 'link' | 'network' | 'shield' | 'login' | 'monitor' | 'sun' | 'moon'
const PATHS: Record<IconName, React.ReactNode> = {
  'present': <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4M12 13V8M9.5 10.5L12 8l2.5 2.5" /></>,
  'stop': <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /><rect x="9" y="7" width="6" height="6" rx="1" /></>,
  'cursor': <path d="M5 3l14 7-6 2-2 6z" />,
  'leave': <path d="M3 14c5-4.5 13-4.5 18 0l-2.4 2.6-3.3-1.4v-2.6a9 9 0 0 0-6.6 0V15.2l-3.3 1.4z" />,
  'plus': <path d="M12 5v14M5 12h14" />,
  'arrow': <path d="M5 12h14M13 6l6 6-6 6" />,
  'refresh': <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />,
  'copy': <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></>,
  'check': <path d="M5 12.5l4.5 4.5L19 7.5" />,
  'help': <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.6 2.6 0 1 1 3.7 2.4c-.8.4-1.2 1-1.2 1.8M12 17h.01" /></>,
  'x': <path d="M6 6l12 12M18 6L6 18" />,
  'monitor': <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>,
  'sun': <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  'moon': <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  'network': <><rect x="9" y="3" width="6" height="5" rx="1" /><rect x="3" y="16" width="6" height="5" rx="1" /><rect x="15" y="16" width="6" height="5" rx="1" /><path d="M12 8v4M6 16v-2h12v2" /></>,
  'shield': <><path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z" /><path d="M9 12l2 2 4-4" /></>,
  'login': <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l4-4-4-4M14 12H4" />,
  'users': <><circle cx="9" cy="8" r="3.2" /><path d="M3 19c.8-3.2 3.2-5 6-5s5.2 1.8 6 5" /><circle cx="17" cy="9" r="2.4" /><path d="M16.5 14.2c2.3.2 4 1.8 4.5 4.8" /></>,
  'expand': <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  'shrink': <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />,
  'eye': <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  'eye-off': <path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.2 6.2A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.8-1.8M9.9 9.9a3 3 0 0 0 4.2 4.2" />,
  'link': <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  'more': <><circle cx="12" cy="5" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="12" cy="19" r="1.2" /></>
}
function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{PATHS[name]}</svg>
}
/** Round control. The name lives in the tooltip and aria-label, like Meet's call bar. */
function Round({ label, icon, onClick, tone = 'neutral', pressed, short }: { short?: string; label: string; icon: IconName; onClick: () => void; tone?: 'neutral' | 'danger' | 'accent' | 'leave'; pressed?: boolean }) {
  const tones = { neutral: 'bg-hover text-fg hover:bg-line', danger: 'bg-red-500/90 text-white hover:bg-red-500', accent: 'bg-primary text-on-primary hover:opacity-90', leave: 'bg-red-600 text-white hover:bg-red-500' }
  return (
    <button aria-label={label} title={label} aria-pressed={pressed} onClick={onClick}
      className="group flex flex-col items-center gap-1 focus-visible:outline-none">
      <span className={`${tone === 'accent' ? 'live-ring' : ''} grid h-12 place-items-center rounded-full shadow-lg transition-all group-hover:scale-105 group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-accent ${tone === 'leave' ? 'w-16' : 'w-12'} ${tones[tone]}`}><Icon name={icon} /></span>
      <span className="text-[11px] text-muted">{short ?? label}</span>
    </button>
  )
}
const Avatar = ({ name, size = 'h-8 w-8 text-sm' }: { name: string; size?: string }) => (
  <span aria-hidden className={`grid shrink-0 place-items-center rounded-full bg-accent/25 font-medium ${size}`}>{name.slice(0, 1).toUpperCase()}</span>
)

type Motion = 'slide' | 'turn' | 'spin' | 'pop'
/** Button with an icon that moves on hover, so the action explains itself: arrows slide, plus turns, refresh spins. */
function Btn({ icon, motion, spinning, className, children, ...rest }: { icon: IconName; motion?: Motion; spinning?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} className={`group inline-flex items-center justify-center gap-2 ${className ?? ''}`}>
      <span aria-hidden className={`ico ${motion ? `ico-${motion}` : ''} ${spinning ? 'ico-spinning' : ''}`}><Icon name={icon} size={16} /></span>
      {children}
    </button>
  )
}

// ---- Shared ----------------------------------------------------------------------------------------

/** Replaces the OS title bar: the OS keeps only its minimize/maximize/close buttons on the right (titleBarOverlay). */
function TitleBar() {
  const { phase, state } = useUi()
  return (
    <div className="drag flex h-10 shrink-0 items-center gap-2.5 border-b border-line bg-bar pl-3 pr-[150px] text-xs text-fg">
      <Isotipo size={22} />
      <Wordmark height={11} />
      {phase === 'room' && state && <span className="truncate text-muted">· {state.name}</span>}
      <span className="flex-1" />
      <ThemeSwitch />
    </div>
  )
}

/**
 * Changing theme sweeps the window on the brand's diagonal (View Transitions), starting at the control that was
 * pressed. Everything up-right of that line is new from the first frame, which matches the OS window buttons in
 * the corner (the system recolors those at once). We wait for the page's prefers-color-scheme to follow Electron.
 */
function switchTheme(source: 'system' | 'light' | 'dark', from?: HTMLElement) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduce || !('startViewTransition' in document)) return void C.setTheme(source)
  const mq = matchMedia('(prefers-color-scheme: dark)')
  const t = document.startViewTransition(async () => {
    await C.setTheme(source)
    const th = useUi.getState().theme
    if (th && th.dark !== mq.matches) {
      await new Promise<void>((done) => { const f = () => { mq.removeEventListener('change', f); done() }; mq.addEventListener('change', f); setTimeout(f, 400) })
    }
  })
  const r = from?.getBoundingClientRect()
  const W = innerWidth, H = innerHeight, M = W + H
  const cx = r ? r.left + r.width / 2 : W, cy = r ? r.top + r.height / 2 : 0
  // Revealed area: x - y >= k. k starts on the pressed control and ends past the bottom-left corner.
  const band = (k: number) => `polygon(${k - M}px ${-M}px, ${W + 2 * M}px ${-M}px, ${W + 2 * M}px ${H + M}px, ${k + H + M}px ${H + M}px)`
  void t.ready.then(() => document.documentElement.animate(
    { clipPath: [band(cx - cy), band(-H - 40)] },
    { duration: 650, easing: 'cubic-bezier(.65,0,.35,1)', pseudoElement: '::view-transition-new(root)' }
  ))
}

/**
 * Light/dark switch split on a diagonal (the two inks of the brand), plus "follow the system", which names the
 * OS it follows (Windows 11, Ubuntu…) and is highlighted while active.
 */
function ThemeSwitch() {
  const theme = useUi((s) => s.theme)
  if (!theme) return null
  const { dark, os } = theme
  const system = theme.source === 'system'
  return (
    <div className="flex items-center gap-2">
      <button onClick={(e) => switchTheme('system', e.currentTarget)} aria-pressed={system}
        title={system ? `Sigue el tema de ${os} (ahora ${dark ? 'oscuro' : 'claro'})` : `Seguir el tema de ${os}`}
        className={`group flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent ${system ? 'border-accent/60 bg-accent/10 text-fg' : 'border-line text-muted hover:border-accent/40 hover:text-fg'}`}>
        <span aria-hidden className="ico ico-pop"><Icon name="monitor" size={13} /></span>{os}
        {system && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />}
      </button>
      <button role="switch" aria-checked={dark} data-dark={dark} onClick={(e) => switchTheme(dark ? 'light' : 'dark', e.currentTarget)}
        aria-label="Tema oscuro" title={dark ? 'Tema oscuro · pulsa para claro' : 'Tema claro · pulsa para oscuro'}
        className="theme-switch focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
        <span aria-hidden className="theme-switch__ink" />
        {/* The other option is always visible on its own half: the moon on midnight, the sun on white. */}
        <span aria-hidden className="theme-switch__hint theme-switch__hint--moon"><Icon name="moon" size={11} /></span>
        <span aria-hidden className="theme-switch__hint theme-switch__hint--sun"><Icon name="sun" size={11} /></span>
        <span aria-hidden className="theme-switch__thumb">
          <span className="theme-switch__sun"><Icon name="sun" size={13} /></span>
          <span className="theme-switch__moon"><Icon name="moon" size={13} /></span>
        </span>
      </button>
    </div>
  )
}

/** `glass` sits on video (always dark); `plain` sits on the app's own surfaces and follows the theme. */
function IconBtn({ icon, label, onClick, tone = 'glass', motion = 'pop' }: { icon: IconName; label: string; onClick: () => void; tone?: 'glass' | 'danger' | 'plain'; motion?: Motion }) {
  return (
    <button aria-label={label} title={label} onClick={onClick}
      className={`group grid h-9 w-9 place-items-center rounded-full backdrop-blur transition-colors focus-visible:outline-2 focus-visible:outline-accent ${tone === 'danger' ? 'bg-red-600/90 text-white hover:bg-red-500' : tone === 'plain' ? 'bg-hover text-fg hover:bg-line' : 'bg-black/55 text-white hover:bg-black/80'}`}>
      <span aria-hidden className={`ico ico-${motion}`}><Icon name={icon} size={18} /></span>
    </button>
  )
}

/** Fullscreen for one element (the stage), not the whole window, like Meet. */
function useFullscreen<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [on, setOn] = useState(false)
  useEffect(() => {
    const f = () => setOn(!!ref.current && document.fullscreenElement === ref.current)
    document.addEventListener('fullscreenchange', f)
    return () => document.removeEventListener('fullscreenchange', f)
  }, [])
  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void ref.current?.requestFullscreen().catch(() => notify('No se pudo pasar a pantalla completa.'))
  }
  return { ref, on, toggle }
}

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
  const { net, found, scanning, myName, set, bootError } = useUi()
  const [name, setName] = useState('')
  const [help, setHelp] = useState(false)
  const start = (i: Intent) => C.openPrep(i)
  const fw = net?.firewall
  return (
    <div className="home-bg relative flex min-h-0 flex-1 flex-col">
      <main className="flex flex-1 flex-col items-center overflow-auto px-6 pb-8">
        <header className="flex flex-col items-center gap-3 pb-6 pt-10 text-center">
          <div className="relative grid place-items-center">
            <span aria-hidden className="hero-glow" />
            {/* Box in the symbol's 372×271 proportion: the brand entrance lands exactly on it. */}
            <span data-brand-anchor className="relative block text-fg" style={{ width: 112, height: (112 * 271) / 372 }}><Isotipo size={112} micro={false} /></span>
          </div>
          <h1 className="mt-3 text-fg"><Wordmark height={30} /></h1>
          <p className="anim-rise text-sm text-muted" style={{ animationDelay: '.4s' }}>Presenta tu pantalla y controla PCs de tu red local, sin Internet.</p>
          <label className="anim-rise group mt-2 flex items-center gap-2 rounded-full border border-line bg-surface/80 py-1 pl-1 pr-4 shadow-lg shadow-black/20 transition-colors focus-within:border-accent" style={{ animationDelay: '.5s' }}>
            <Avatar name={myName || '?'} size="h-8 w-8 text-sm" />
            <span className="text-xs text-muted">Te verán como</span>
            <input aria-label="Mi nombre" className="w-44 bg-transparent text-sm font-medium outline-none" value={myName} maxLength={64} onChange={(e) => set({ myName: e.target.value })} />
          </label>
        </header>

        <div className="flex w-full max-w-3xl flex-col gap-5">
          {bootError && (
            <div role="alert" className="card flex items-center gap-3 border-warn/50 p-4 text-sm">
              <span className="text-warn"><Icon name="shield" size={20} /></span>
              <p className="flex-1">No se pudo preparar el espacio de trabajo: {bootError}</p>
              <Btn icon="refresh" motion="spin" className={quiet} onClick={C.retryBoot}>Reintentar</Btn>
            </div>
          )}
          <section className="grid gap-5 sm:grid-cols-2" aria-label="Crear o unirse">
            <form className="card anim-rise flex flex-col gap-3 p-5" style={{ animationDelay: '.55s' }}
              onSubmit={(e) => { e.preventDefault(); start({ kind: 'host', meetingName: name.trim() || `Reunión de ${myName}` }) }}>
              <CardHead icon="plus" title="Crear reunión" hint="Serás el anfitrión: otros se unen con tu IP y código." />
              <input data-focus-start aria-label="Nombre de la reunión" className={field} value={name} maxLength={64} placeholder={`Reunión de ${myName || 'mí'}`} onChange={(e) => setName(e.target.value)} />
              <Btn icon="plus" motion="turn" className={`${primary} mt-auto`} type="submit">Crear reunión</Btn>
            </form>
            <ManualJoin onJoin={(ip, port) => start({ kind: 'join', ip, port, label: ip })} />
          </section>

          <section aria-label="Reuniones detectadas" className="card anim-rise p-5" style={{ animationDelay: '.65s' }}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="relative grid h-9 w-9 place-items-center rounded-xl bg-accent/15 text-accent">
                  {scanning && <span aria-hidden className="radar rounded-xl" />}
                  <Icon name="network" size={18} />
                </span>
                <div>
                  <h2 className="text-base font-semibold">Reuniones en tu red</h2>
                  <p className="text-xs text-muted">{scanning ? 'Buscando…' : found.length ? `${found.length} ${found.length === 1 ? 'reunión encontrada' : 'reuniones encontradas'}` : 'Se busca sola cada pocos segundos'}</p>
                </div>
              </div>
              <IconBtn icon="refresh" motion="spin" tone="plain" label="Buscar ahora" onClick={() => void C.scan()} />
            </div>
            {found.length === 0 ? (
              <div className="grid place-items-center gap-2 rounded-xl border border-dashed border-line px-4 py-6 text-center">
                <p className="text-sm text-muted">{scanning ? 'Buscando reuniones…' : 'Aún no hay reuniones abiertas en esta red.'}</p>
                {!scanning && <p className="max-w-md text-xs text-muted">Si las PCs están en redes separadas (VLAN), únete con la IP y el código.</p>}
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {found.map((f, n) => (
                  <li key={`${f.ip}:${f.port}`} className="meeting-row anim-rise flex items-center gap-3 rounded-xl border border-line/60 bg-line/40 px-3 py-2.5" style={{ animationDelay: `${n * 60}ms` }}>
                    <span className="relative"><Avatar name={f.host} size="h-10 w-10 text-base" /><span aria-hidden className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface bg-ok" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{f.name}</div>
                      <div className="flex items-center gap-2 truncate text-xs text-muted">
                        <span>{f.host}</span><span className="rounded-md bg-bg/70 px-1.5 py-0.5 font-mono">{f.ip}</span>
                        <span className="inline-flex items-center gap-1"><Icon name="users" size={12} />{f.participants}</span>
                      </div>
                    </div>
                    <Btn icon="login" motion="slide" className={primary} onClick={() => start({ kind: 'join', ip: f.ip, port: f.port, label: f.name })}>Unirse</Btn>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>

      <footer className="flex flex-wrap items-center gap-2 border-t border-line bg-bar/90 px-5 py-2 text-xs backdrop-blur">
        <StatusPill tone={net?.chosen ? 'ok' : 'warn'} icon="network">
          {net?.chosen ? <>Red <b className="font-mono text-fg">{net.chosen}</b>{net.ifaces.length > 1 && <span className="text-muted"> · {net.ifaces.length} adaptadores</span>}</> : 'Sin red: conecta esta PC a una red local (cable o Wi-Fi)'}
        </StatusPill>
        <StatusPill tone={fw === 'ok' ? 'ok' : fw === 'missing' ? 'warn' : 'idle'} icon="shield" onClick={fw === 'ok' ? undefined : () => setHelp(true)}>
          Firewall {fw === 'ok' ? 'permitido' : fw === 'missing' ? 'bloqueado: ver cómo abrirlo' : 'sin verificar'}
        </StatusPill>
        {net && !net.controllable && <StatusPill tone="idle" icon="cursor">No admite ser controlado (solo Windows)</StatusPill>}
        <span className="flex-1" />
        <Btn icon="help" motion="pop" className="rounded-full px-3 py-1.5 text-accent hover:bg-accent/10" onClick={() => setHelp(true)}>Ayuda de red</Btn>
      </footer>
      {help && net && <NetworkHelp onClose={() => setHelp(false)} />}
    </div>
  )
}

function CardHead({ icon, title, hint }: { icon: IconName; title: string; hint: string }) {
  return (
    <div className="flex items-start gap-3">
      <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent ring-1 ring-accent/25"><Icon name={icon} size={20} /></span>
      <div><h2 className="text-base font-semibold">{title}</h2><p className="text-xs text-muted">{hint}</p></div>
    </div>
  )
}

/** One status in the footer: a colored dot says ok / needs attention at a glance. */
function StatusPill({ tone, icon, onClick, children }: { tone: 'ok' | 'warn' | 'idle'; icon: IconName; onClick?: () => void; children: React.ReactNode }) {
  const dot = tone === 'ok' ? 'bg-ok' : tone === 'warn' ? 'bg-warn animate-pulse' : 'bg-muted'
  const cls = `flex items-center gap-2 rounded-full border px-3 py-1.5 ${tone === 'warn' ? 'border-warn/40 bg-warn/10 text-warn' : 'border-line bg-surface/70 text-muted'}`
  const body = <><span aria-hidden className={`h-2 w-2 rounded-full ${dot}`} /><Icon name={icon} size={14} /><span>{children}</span></>
  return onClick
    ? <button className={`${cls} transition-colors hover:border-warn/70 focus-visible:outline-2 focus-visible:outline-accent`} onClick={onClick}>{body}</button>
    : <span className={cls}>{body}</span>
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
    <form className="card anim-rise flex flex-col gap-3 p-5" style={{ animationDelay: '.6s' }} onSubmit={submit}>
      <CardHead icon="login" title="Unirse con IP y código" hint="Pide al anfitrión su IP; el código va en el paso siguiente." />
      <input aria-label="IP del anfitrión" className={`${field} font-mono`} value={addr} placeholder="192.168.10.24" inputMode="decimal" onChange={(e) => { setAddr(e.target.value); setErr('') }} aria-invalid={!!err} />
      {err && <p role="alert" className="text-xs text-warn">{err}</p>}
      <Btn icon="arrow" motion="slide" className={`${quiet} mt-auto`} type="submit">Continuar</Btn>
    </form>
  )
}

function NetworkHelp({ onClose }: { onClose: () => void }) {
  const net = useUi((s) => s.net)!
  return (
    <Modal title="Red y firewall" onClose={onClose}>
      <div className="flex flex-col gap-3 text-sm text-muted">
        <p>MirrorStudio funciona entre PCs de la <b className="text-fg">misma red local</b>: cable Ethernet, Wi-Fi o un mismo hotspot (el cable es lo más estable). El puerto es <b className="text-fg">{net.port}</b> (TCP).</p>
        <p>Direcciones de este equipo: {net.ifaces.length ? net.ifaces.map((i) => <code key={i.address} className="mr-2 rounded bg-bg px-1">{i.name}: {i.address}</code>) : 'ninguna'}</p>
        <p>
          Firewall de esta PC: {net.firewallChecking ? <b className="text-fg">comprobando…</b> : net.firewall === 'ok' ? <b className="text-ok">listo</b> : net.firewall === 'missing' ? <b className="text-warn">bloquea el vídeo</b> : <b className="text-fg">no se pudo comprobar</b>}.
          {' '}Mirror Studio lo revisa al abrirse y, si algo bloquea, lo arregla pidiendo permiso de administrador una vez. Si aun así el vídeo rápido (UDP) no pasa, la imagen se envía sola por el modo compatible (TCP).
        </p>
        {net.firewallReasons.length > 0 && <ul className="list-disc pl-5 text-xs">{net.firewallReasons.map((r) => <li key={r}>{r}</li>)}</ul>}
        {net.firewall === 'missing' && <div><button className={primary} onClick={() => void C.repairFirewall()}>Reparar firewall</button></div>}
        <p>A mano (como administrador, una sola vez):</p>
        <code className="select-all whitespace-pre-wrap break-all rounded bg-bg p-2 text-xs text-fg">{net.firewallCommand}</code>
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
        {error && <p role="alert" className="text-sm text-warn">{error}</p>}
        <div className="flex justify-end gap-2">
          <Btn icon="x" motion="pop" type="button" className={quiet} onClick={C.cancelPrep}>Cancelar</Btn>
          <Btn icon="arrow" motion="slide" type="submit" className={primary} disabled={!ok || busy}>{busy ? 'Entrando…' : intent.kind === 'host' ? 'Crear y entrar' : 'Entrar'}</Btn>
        </div>
      </form>
    </main>
  )
}

// ---- Room ------------------------------------------------------------------------------------------

function Room() {
  const { state, me, hostInfo, presentation, controlView, sharing, rtt, localPreview, relayCount } = useUi()
  const self = selfOf(useUi.getState())
  const [picker, setPicker] = useState(false)
  const [side, setSide] = useState(true)
  if (!state || !self) return null
  const controlling = state.controls.find((c) => c.controller === me)
  const controlled = state.controls.find((c) => c.target === me)
  const presenter = state.participants.find((p) => p.id === state.presenter)
  const name = (id: string) => state.participants.find((p) => p.id === id)?.name ?? '?'
  const isPresenter = state.presenter === me
  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-2 text-sm">
        <div className="min-w-0"><span className="font-semibold">{state.name}</span><span className="ml-3 text-muted">{state.participants.length} {state.participants.length === 1 ? 'persona' : 'personas'}{rtt !== undefined && ` · ${rtt.toFixed(0)} ms`}</span>{relayCount > 0 && <span className="ml-2 rounded-full border border-warn/40 bg-warn/10 px-2 py-0.5 text-[11px] text-warn" title="El firewall bloquea el vídeo por UDP; la imagen va por la conexión TCP de la reunión.">{hostInfo ? `modo compatible (TCP) · ${relayCount}` : 'modo compatible (TCP)'}</span>}</div>
        <div className="flex items-center gap-2">
          {hostInfo && (
            <div className="flex items-center gap-2" aria-label="Datos para unirse">
              <CopyChip label="IP" value={hostInfo.ip ?? hostInfo.ips[0] ?? '?'} />
              <CopyChip label="Código" value={formatCode(hostInfo.code)} mono />
              <CopyButton what="IP y código" text={`${hostInfo.ip ?? hostInfo.ips[0] ?? ''} ${formatCode(hostInfo.code)}`} icon="link" boxed />
            </div>
          )}
          <button aria-label={side ? 'Ocultar participantes' : 'Mostrar participantes'} title={side ? 'Ocultar participantes' : 'Mostrar participantes'} aria-expanded={side} onClick={() => setSide(!side)}
            className={`group relative grid h-9 w-9 place-items-center rounded-xl border transition-colors focus-visible:outline-2 focus-visible:outline-accent ${side ? 'border-accent/50 bg-accent/15 text-accent' : 'border-line bg-line/60 hover:border-accent/50'}`}>
            <span aria-hidden className="ico ico-pop"><Icon name="users" size={18} /></span>
            <span aria-hidden className="absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-on-primary">{state.participants.length}</span>
          </button>
        </div>
      </header>
      {controlled && <div role="alert" className="bg-red-600 px-5 py-2 text-sm text-white">{name(controlled.controller)} controla este equipo.</div>}
      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col p-4" aria-label="Presentación">
          {controlling && controlView ? <ControlView target={controlling.target} stream={controlView} name={name(controlling.target)} />
            : controlling ? <Placeholder text={`Esperando la pantalla de ${name(controlling.target)}…`} />
            : presentation && presenter ? <Stage stream={presentation} caption={`${presenter.name} presenta`} />
            : isPresenter ? <SelfPresenting stream={localPreview} />
            : presenter ? <Placeholder text={`Esperando la pantalla de ${presenter.name}…`} />
            : <Grid people={state.participants} />}
        </section>
        <aside hidden={!side} className="side-in w-80 shrink-0 overflow-auto border-l border-line bg-surface/40 p-3" aria-label="Participantes">
          <h2 className="mb-2 px-1 text-sm font-medium text-muted">Participantes</h2>
          <ul className="flex flex-col gap-1">{state.participants.map((p) => <Row key={p.id} p={p} self={self} controlled={state.controls.some((c) => c.target === p.id)} presenting={state.presenter === p.id} />)}</ul>
          {state.controls.length > 0 && (
            <div className="mt-4 rounded-xl border border-line p-3 text-xs">
              <div className="mb-1 font-medium">Controlando</div>
              {state.controls.map((c) => (
                <div key={c.controller + c.target} className="flex items-center justify-between gap-2 py-0.5">
                  <span className="flex min-w-0 items-center gap-1.5 truncate"><b className="truncate font-medium">{name(c.controller)}</b><span aria-label="controla a" className="ico-flow text-accent"><Icon name="arrow" size={14} /></span><b className="truncate font-medium">{name(c.target)}</b></span>
                  {(c.controller === me || c.target === me) && <Btn icon="x" motion="pop" className="rounded-lg px-2 py-1 text-danger hover:bg-red-500/15" onClick={() => C.revokeControl(c.controller === me ? c.target : c.controller)}>Detener</Btn>}
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

/** Copies `text`. No words: the copy glyph says it, then a check pops in with a ring burst. */
function CopyButton({ what, text, icon = 'copy', boxed }: { what: string; text: string; icon?: IconName; boxed?: boolean }) {
  const [done, setDone] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text)
      .then(() => { setDone(true); setTimeout(() => setDone(false), 1400) })
      .catch(() => notify('No se pudo copiar al portapapeles.'))
  }
  return (
    <button onClick={copy} aria-label={done ? `${what} copiado` : `Copiar ${what}`} title={done ? '¡Copiado!' : `Copiar ${what}`}
      className={`group relative grid place-items-center transition-colors focus-visible:outline-2 focus-visible:outline-accent ${boxed ? 'h-9 w-9 rounded-xl border' : 'h-8 w-8 rounded-lg'} ${done ? 'border-ok/60 bg-ok/20 text-ok' : boxed ? 'border-line bg-line/60 text-accent hover:border-accent/60' : 'text-accent hover:bg-accent/15'}`}>
      <span key={String(done)} aria-hidden className={done ? 'anim-check' : 'ico ico-copy'}><Icon name={done ? 'check' : icon} size={16} /></span>
      {done && <span aria-hidden className="burst" />}
    </button>
  )
}
/** A value people type on another PC (IP, code), with its own copy button. */
function CopyChip({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-line bg-line/60 py-0.5 pl-3 pr-0.5 text-sm">
      <span className="text-muted">{label}</span><b className={mono ? 'font-mono tracking-wider' : ''}>{value}</b>
      <CopyButton what={label} text={value} />
    </div>
  )
}
/** What I am presenting, shown back to me, with Meet's "mirror" switch: sharing this very window makes an infinite mirror. */
function SelfPresenting({ stream }: { stream: MediaStream | null }) {
  const [mirror, setMirror] = useState(() => { try { return localStorage.getItem('mirror') !== 'off' } catch { return true } })
  const toggle = (on: boolean) => { setMirror(on); try { localStorage.setItem('mirror', on ? 'on' : 'off') } catch { /* storage blocked */ } }
  if (stream && mirror) return <Stage stream={stream} caption="Así ven los demás tu presentación." live mirror={{ on: true, toggle: () => toggle(false) }} />
  return (
    <div className="grid flex-1 place-items-center rounded-2xl border border-dashed border-line">
      <div className="anim-rise flex flex-col items-center gap-3 text-center">
        <span className="live-dot" aria-hidden />
        <p className="text-base font-medium">Estás presentando</p>
        <p className="max-w-sm text-sm text-muted">Ocultaste tu propia vista para evitar el efecto de espejo infinito. Los demás siguen viendo tu pantalla.</p>
        {stream && <Btn icon="eye" motion="pop" className={quiet} onClick={() => toggle(true)}>Ver lo que presento</Btn>}
      </div>
    </div>
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
          <span className="absolute bottom-2 left-3 max-w-[80%] truncate rounded-md bg-bg/80 px-2 py-0.5 text-sm text-fg">{p.name}</span>
        </div>
      ))}
    </div>
  )
}
function Stage({ stream, caption, mirror, live }: { stream: MediaStream; caption: string; mirror?: { on: boolean; toggle: () => void }; live?: boolean }) {
  const v = useRef<HTMLVideoElement>(null)
  const fs = useFullscreen<HTMLDivElement>()
  useEffect(() => { if (v.current) v.current.srcObject = stream }, [stream])
  return (
    <figure className="flex min-h-0 flex-1 flex-col gap-2">
      <div ref={fs.ref} className="group/stage relative flex min-h-0 flex-1 overflow-hidden rounded-xl bg-black shadow-2xl ring-1 ring-line">
        <video ref={v} autoPlay muted playsInline className="h-full w-full object-contain" />
        <div className="absolute right-3 top-3 flex gap-2 opacity-0 transition-opacity focus-within:opacity-100 group-hover/stage:opacity-100">
          {mirror && <IconBtn icon="eye-off" label="Ocultar mi vista (evita el espejo infinito)" onClick={mirror.toggle} />}
          <IconBtn icon={fs.on ? 'shrink' : 'expand'} label={fs.on ? 'Salir de pantalla completa' : 'Pantalla completa'} onClick={fs.toggle} />
        </div>
      </div>
      <figcaption className="flex items-center gap-2 text-xs text-muted">{live && <span className="live-dot small" aria-hidden />}{caption}</figcaption>
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
          <button className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-accent" aria-label={`Más acciones para ${p.name}`} title="Más acciones" aria-expanded={open} onClick={() => setOpen(!open)}>
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
      {failed && !sources && <p role="alert" className="text-sm text-warn">No se pudo listar las ventanas. Puedes presentar la pantalla principal.</p>}
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
      <div className="mt-4 flex justify-end"><Btn icon="x" motion="pop" className={quiet} onClick={onClose}>Cancelar</Btn></div>
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
  const problem = useControlProblem(target, name, v)
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
  const fs = useFullscreen<HTMLDivElement>()
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div ref={fs.ref} className="relative flex min-h-0 flex-1 flex-col">
      {/* Outside the key-capturing area: this PC's own app stays usable while controlling the other one. */}
      <div className="anim-rise absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-black/70 py-1 pl-4 pr-1 text-xs text-white opacity-80 shadow-xl backdrop-blur transition-opacity hover:opacity-100">
        <span className="live-dot small" aria-hidden />Controlando <b>{name}</b>
        <IconBtn icon="refresh" motion="spin" label="Reintentar el control (si los clics o la imagen dejaron de responder)" onClick={() => C.resetControl(target)} />
        <IconBtn icon={fs.on ? 'shrink' : 'expand'} label={fs.on ? 'Salir de pantalla completa' : 'Pantalla completa'} onClick={fs.toggle} />
        <IconBtn icon="x" tone="danger" label="Dejar de controlar" onClick={() => C.revokeControl(target)} />
      </div>
      {problem && (
        <div role="status" className="anim-rise absolute left-1/2 top-14 z-10 w-max max-w-[90%] -translate-x-1/2 rounded-xl border border-amber-400/30 bg-amber-950/85 px-4 py-2 text-center text-xs text-amber-100 shadow-xl backdrop-blur">
          {problem}
        </div>
      )}
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
          // The button was released where this view could not see it (another window took the pointer): release it there too.
          onLostPointerCapture={() => { for (const b of buttons.current) emit({ t: 'mouse-button', button: b, down: false }); buttons.current.clear() }}
          onWheel={(e) => emit({ t: 'wheel', dx: Math.round(e.deltaX), dy: Math.round(e.deltaY) })} />
      </div>
      </div>
      <p className="text-xs text-muted">Controlas la PC de {name}. Haz clic en la imagen para escribir. Esa persona puede detenerlo en cualquier momento.</p>
    </div>
  )
}

/**
 * Why my control of the other PC may not be working right now, from its health reports and from what I see,
 * or null when all is well. Problems a reset can fix are retried automatically (rate-limited in the controller).
 */
function useControlProblem(target: string, name: string, video: React.RefObject<HTMLVideoElement | null>): string | null {
  const health = useUi((s) => s.controlHealth)
  const [now, setNow] = useState(() => Date.now())
  const lastFrame = useRef(Date.now())
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  // Every new frame of the other screen. My moves show up in it (its cursor moves), so moving while no frame
  // arrives means the picture froze, which looks exactly like "my clicks stopped working".
  useEffect(() => {
    const el = video.current; if (!el) return
    let alive = true, h = 0
    const tick = () => { lastFrame.current = Date.now(); if (alive) h = el.requestVideoFrameCallback(tick) }
    h = el.requestVideoFrameCallback(tick)
    return () => { alive = false; el.cancelVideoFrameCallback(h) }
  }, [video])

  const w = C.controlWatch()
  const who = `la PC de ${name}`
  let text: string | null = null, fixable = false
  if (now - w.since > 7000 && (!health || now - health.at > 7000)) { text = `${cap(who)} no responde. Reintentando…`; fixable = true }
  else if (health?.code === 'blocked-admin') text = `Windows bloquea el control: en ${who} hay una ventana de administrador delante${health.detail && health.detail !== '?' ? ` («${health.detail}»)` : ''}. Pídele que la cambie o la cierre.`
  else if (health?.code === 'blocked-secure') text = `${cap(who)} muestra una pantalla protegida de Windows (aviso de administrador, bloqueo o Ctrl+Alt+Supr). El control vuelve cuando se cierre.`
  else if (health?.code === 'restarting') text = `Reiniciando el control en ${who}…`
  else if (health?.code === 'rejected') { text = `Windows rechazó tus clics en ${who}. Reintentando…`; fixable = true }
  else if ((health?.stalled ?? 0) >= 2) { text = `Tus clics no llegan a ${who}. Reintentando…`; fixable = true }
  else if (now - w.since > 6000 && now - w.lastMove < 3000 && now - lastFrame.current > 4000) { text = 'La imagen se congeló. Recuperando…'; fixable = true }

  useEffect(() => { if (fixable) C.resetControl(target, true); else if (!text) C.noteControlHealthy() }, [fixable, text, now, target])
  if (fixable && w.autoResets >= C.MAX_AUTO_RESETS) return `${text?.replace(/ (Reintentando|Recuperando)…$/, '')} No se recupera solo: pulsa Reintentar (↻) o deja el control y vuelve a pedirlo.`
  return text
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

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
      {!can && <p role="alert" className="mb-3 text-sm text-warn">Este equipo no admite control remoto (solo Windows). Se rechazará.</p>}
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
  // Problems only the person here can fix (an admin window in front blocks the control) show up in this bar:
  // it stays on top, while the main window is likely hidden behind that very window.
  const [problem, setProblem] = useState('')
  useEffect(() => {
    let t = 0
    const off = window.studio.onEvent((e) => {
      if (e.t !== 'notice') return
      setProblem(e.text); clearTimeout(t); t = window.setTimeout(() => setProblem(''), 10_000)
    })
    return () => { off(); clearTimeout(t) }
  }, [])
  return (
    <div className="flex h-full items-center justify-between gap-3 bg-[#7c2d12] px-4 text-sm text-white" role="alert">
      {problem ? <span className="line-clamp-2 text-xs leading-tight" title={problem}>{problem}</span> : <span><b>{name}</b> controla esta PC</span>}
      <button autoFocus className="rounded-md bg-white px-3 py-1 font-medium text-[#7c2d12]" onClick={() => void window.studio.send({ t: 'control-revoke', other: id })}>Detener control</button>
    </div>
  )
}
