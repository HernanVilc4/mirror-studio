import { useEffect, useRef, useState } from 'react'
import { useShare, startShare, stopShare } from './sender'
import { useStore, initSessions, sendControl, mapPointToDevice, type Dev } from './sessions'

type Invite = { qr: string; ips: string[]; payload: { host: string; port: number; token: string } }

const STATUS: Record<Dev['status'], { label: string; cls: string }> = {
  pending: { label: 'Esperando aprobación', cls: 'bg-amber-400/15 text-amber-300' },
  connecting: { label: 'Conectando…', cls: 'bg-accent/15 text-blue-300' },
  streaming: { label: 'Transmitiendo', cls: 'bg-ok/15 text-ok' },
  lost: { label: 'Conexión perdida', cls: 'bg-red-400/15 text-red-300' }
}

function Tile({ d }: { d: Dev }) {
  const v = useRef<HTMLVideoElement>(null)
  const [msg, setMsg] = useState('')
  const [control, setControl] = useState(false)
  const [sent, setSent] = useState(0)
  useEffect(() => { if (v.current && d.stream) v.current.srcObject = d.stream }, [d.stream])

  const ctl = !d.info ? { t: 'Esperando datos del teléfono…', c: 'text-muted' }
    : d.info.controlEnabled ? { t: 'Control listo', c: 'text-ok' }
    : d.model === 'win32' || d.model === 'linux' || d.model === 'darwin' ? { t: 'Solo visualización (control de PC aún no disponible)', c: 'text-muted' } : { t: 'Falta activar Accesibilidad en el teléfono', c: 'text-amber-300' }

  const ptr = (action: 'down' | 'move' | 'up', e: React.PointerEvent) => {
    if (!control || !v.current) return
    if (action === 'move' && e.buttons === 0) return
    const r = v.current.getBoundingClientRect()
    const p = mapPointToDevice(e.clientX, e.clientY, { x: r.x, y: r.y, w: r.width, h: r.height }, v.current.videoWidth, v.current.videoHeight)
    if (!p) return
    if (!d.info?.controlEnabled) return setMsg('Puedes ver la pantalla. Para controlarla desde tu PC, activa el permiso correspondiente en Android.')
    setMsg('')
    if (action === 'down') e.currentTarget.setPointerCapture(e.pointerId)
    if (sendControl(d.id, { t: 'pointer', action, id: 0, ...p })) setSent((n) => n + 1)
    else setMsg('Canal de control no disponible')
  }

  return (
    <div className="anim-rise flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 transition-shadow hover:shadow-[0_0_0_1px_var(--color-accent)]">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{d.name}</div>
          <div className="truncate text-xs text-muted">{d.model}</div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${STATUS[d.status].cls}`}>{STATUS[d.status].label}</span>
      </div>
      <video ref={v} autoPlay muted playsInline
        onPointerDown={(e) => ptr('down', e)} onPointerMove={(e) => ptr('move', e)} onPointerUp={(e) => ptr('up', e)}
        className={`max-h-[58vh] w-full rounded-xl bg-black object-contain transition-shadow ${control ? 'cursor-crosshair shadow-[0_0_0_2px_var(--color-accent)]' : ''}`} />
      <div className="flex items-center justify-between text-xs text-muted">
        <span>{d.w ? `${d.w}×${d.h}` : '—'} · {d.fps !== undefined ? `${Math.round(d.fps)} fps` : '—'}{d.rtt !== undefined && ` · rtt ${d.rtt.toFixed(0)} ms`}{d.buf !== undefined && ` · buffer ${d.buf.toFixed(0)} ms`}</span>
        <span className={ctl.c}>{ctl.t}</span>
      </div>
      <div className="flex items-center justify-between">
        <button role="switch" aria-checked={control} onClick={() => setControl(!control)}
          className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${control ? 'bg-accent text-white' : 'bg-line text-muted hover:text-white'}`}>
          {control ? 'Control activado' : 'Activar control'}
        </button>
        <button className="rounded-full px-3 py-1.5 text-sm text-muted hover:bg-line hover:text-white" onClick={() => window.studio.close(d.id)}>Desconectar</button>
      </div>
      {control && <div className="text-xs text-muted">Eventos enviados: {sent}</div>}
      {msg && <div className="anim-pop text-xs text-amber-300">{msg}</div>}
    </div>
  )
}

function Empty({ invite }: { invite: Invite | null }) {
  return (
    <div className="anim-rise col-span-full mx-auto flex max-w-xl flex-col items-center gap-6 py-10 text-center">
      <div className="relative grid h-24 w-24 place-items-center">
        <span className="radar" /><span className="radar [animation-delay:1.2s]" />
        <div className="grid h-14 w-14 place-items-center rounded-full bg-accent/20 text-2xl">📱</div>
      </div>
      <div>
        <h2 className="text-xl font-semibold">Esperando tu teléfono</h2>
        <p className="mt-1 text-sm text-muted">Abre Mirror Studio en el móvil. Verás este equipo en la lista; tócalo y aprueba aquí. También puedes escanear el QR.</p>
      </div>
      {invite && (
        <div className="flex items-center gap-5 rounded-2xl border border-line bg-surface p-4 text-left">
          <img src={invite.qr} width={150} height={150} className="rounded-lg bg-white p-1.5" alt="QR de emparejamiento" />
          <div className="text-xs text-muted">
            <div className="mb-1 text-sm text-white">Conexión manual</div>
            IP: {invite.ips.join(' · ')}<br />Puerto: {invite.payload.port}<br />
            Código: <b className="select-all text-white">{invite.payload.token}</b>
            <div className="mt-2">Un solo uso, caduca en 5 min.</div>
          </div>
        </div>
      )}
    </div>
  )
}

function SharePanel() {
  const { state, message } = useShare()
  const [found, setFound] = useState<string[]>([])
  const [scanning, setScanning] = useState(true)
  const [ip, setIp] = useState('')
  const scan = () => { setScanning(true); window.studio.discover().then(setFound).finally(() => setScanning(false)) }
  useEffect(() => { scan(); const t = setInterval(scan, 6000); return () => clearInterval(t) }, [])
  const busy = state === 'connecting' || state === 'waiting'
  return (
    <div className="anim-rise mx-auto flex max-w-xl flex-col gap-5 p-8">
      <div>
        <h2 className="text-xl font-semibold">Compartir esta pantalla</h2>
        <p className="mt-1 text-sm text-muted">Elige otra PC con Mirror Studio abierto en tu misma red (Wi-Fi, ethernet o hotspot). Se mostrará allí esta pantalla; el otro equipo debe aprobar.</p>
      </div>
      {state === 'sharing' ? (
        <div className="anim-pop flex items-center justify-between rounded-2xl border border-ok/40 bg-ok/10 p-4">
          <span className="text-ok">● Compartiendo tu pantalla</span>
          <button className="rounded-lg bg-line px-3 py-1.5 hover:bg-red-500/30" onClick={() => stopShare('Dejaste de compartir')}>Detener</button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4">
          <div className="flex items-center justify-between text-sm">
            <span>PCs encontradas</span>
            <button className="text-accent disabled:text-muted" disabled={scanning} onClick={scan}>{scanning ? 'Buscando…' : 'Buscar ahora'}</button>
          </div>
          {found.length === 0 && <p className="text-sm text-muted">{scanning ? 'Buscando dispositivos…' : 'No encontramos equipos. Comprueba que estén en la misma red y que el firewall del otro equipo permita el puerto 47800.'}</p>}
          {found.map((f) => (
            <button key={f} disabled={busy} onClick={() => startShare(f, 47800, '')} className="flex items-center justify-between rounded-xl bg-line/60 px-4 py-3 text-left transition-colors hover:bg-line disabled:opacity-50">
              <span>PC · {f}</span><span className="text-sm text-accent">Compartir</span>
            </button>
          ))}
          <div className="mt-2 flex gap-2">
            <input value={ip} onChange={(e) => setIp(e.target.value)} placeholder="IP manual (opcional)" className="flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent" />
            <button disabled={!ip || busy} onClick={() => startShare(ip, 47800, '')} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium disabled:opacity-40">Conectar</button>
          </div>
        </div>
      )}
      {busy && <p className="anim-pop text-sm text-muted">{state === 'waiting' ? 'Esperando que el otro equipo apruebe…' : 'Conectando…'}</p>}
      {message && state !== 'sharing' && <p className="anim-pop text-sm text-amber-300">{message}</p>}
    </div>
  )
}

export function App() {
  const devs = Object.values(useStore((s) => s.devs))
  const [invite, setInvite] = useState<Invite | null>(null)
  const [page, setPage] = useState<'view' | 'share'>('view')
  const refresh = () => window.studio.invite().then(setInvite)
  useEffect(() => { initSessions(); refresh() }, [])
  const pending = devs.filter((d) => d.status === 'pending')
  const live = devs.filter((d) => d.status !== 'pending')
  // MS_SELFTEST=1: share to this same app over loopback and auto-approve, to verify the PC-to-PC path end to end.
  useEffect(() => { window.studio.selftestLoop().then((on) => { if (on) setTimeout(() => startShare('127.0.0.1', 47800, ''), 1500) }) }, [])
  useEffect(() => {
    window.studio.selftest().then((on) => { if (on) pending.forEach((d) => { useStore.getState().patch(d.id, { status: 'connecting' }); window.studio.approve(d.id) }) })
  }, [pending.length])
  // Selftest: one tap on 'Escanear QR' of a phone that reports control enabled.
  const tapped = useRef(false)
  useEffect(() => {
    window.studio.selftest().then((on) => {
      const d = on && live.find((x) => x.info?.controlEnabled && x.model !== 'win32')
      if (d && !tapped.current) { tapped.current = true; sendControl(d.id, { t: 'pointer', action: 'down', id: 0, x: 0.5, y: 0.426 }); setTimeout(() => sendControl(d.id, { t: 'pointer', action: 'up', id: 0, x: 0.5, y: 0.426 }), 120) }
    })
  }, [live.map((d) => d.info?.controlEnabled).join()])
  const streaming = live.filter((d) => d.status === 'streaming').length

  return (
    <div className="flex h-full">
      <aside className="w-52 border-r border-line p-4 text-sm">
        <div className="mb-6 text-lg font-semibold tracking-tight">Mirror Studio</div>
        {(['view', 'share'] as const).map((p) => (
          <button key={p} onClick={() => setPage(p)}
            className={`mb-1 w-full rounded-lg px-3 py-2 text-left transition-colors ${page === p ? 'bg-surface' : 'text-muted hover:bg-surface/60'}`}>
            {p === 'view' ? 'Ver pantallas' : 'Compartir pantalla'}
          </button>
        ))}
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-line px-5 py-3 text-sm">
          <span>Escenario 1</span>
          <span className="flex items-center gap-2 text-muted">
            <span className={`h-2 w-2 rounded-full ${streaming ? 'bg-ok' : 'bg-muted'}`} />{streaming} conectado(s)
          </span>
          <button className="rounded-lg bg-accent px-3 py-1.5 font-medium transition-transform hover:brightness-110 active:scale-95" onClick={refresh}>Nuevo código</button>
        </header>
        {page === 'share' ? <div className="flex-1 overflow-auto"><SharePanel /></div> : (
          <div className="grid flex-1 grid-cols-[repeat(auto-fill,minmax(280px,1fr))] content-start gap-4 overflow-auto p-5">
            {live.map((d) => <Tile key={d.id} d={d} />)}
            {live.length === 0 && <Empty invite={invite} />}
          </div>
        )}
      </main>
      {pending.map((d) => (
        <div key={d.id} className="anim-pop fixed inset-0 grid place-items-center bg-black/60 backdrop-blur-sm">
          <div className="anim-rise w-96 rounded-2xl border border-line bg-surface p-6 shadow-2xl">
            <h2 className="mb-2 text-lg font-semibold">¿Permitir conexión?</h2>
            <p className="mb-5 text-sm text-muted"><b className="text-white">{d.name}</b> ({d.model}) quiere compartir su pantalla. El control remoto se autoriza aparte, en el teléfono.</p>
            <div className="flex justify-end gap-2">
              <button className="rounded-lg px-3 py-1.5 hover:bg-line" onClick={() => window.studio.reject(d.id)}>Rechazar</button>
              <button className="rounded-lg bg-accent px-4 py-1.5 font-medium active:scale-95" onClick={() => { useStore.getState().patch(d.id, { status: 'connecting' }); window.studio.approve(d.id) }}>Permitir</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
