// Cliente de PC auxiliar para probar el telefono sin la interfaz del escritorio: se une como una PC mas,
// puede crear el token de vinculacion y escribe en pantalla todo lo que le llega (diapositivas, laser, trazos, mensajes...).
// Uso: MS_HOST=10.0.0.5 MS_PORT=47800 MS_CODE=ABCD-EFGH MS_NAME="PC auxiliar" node pc-client.cjs
// Por la entrada estandar acepta comandos: `pair` (crea el token y lo escribe como enlace), `present` / `stop` (presentar sin video,
// para que el anfitrion reenvie el laser y los trazos), `send <json>` (cualquier mensaje) y `quit`.
import { MeetingClient } from '../../desktop/src/main/meeting-net'
import { createInterface } from 'node:readline'

const host = process.env.MS_HOST ?? '127.0.0.1'
const port = Number(process.env.MS_PORT ?? 47800)
const code = process.env.MS_CODE ?? ''
const name = process.env.MS_NAME ?? 'PC auxiliar'

const out = (o: unknown) => console.log(JSON.stringify(o))
const client = new MeetingClient('pc')

client.on('message', (m) => {
  if (m.t === 'pair-token') {
    out({ event: 'pair-token', link: `mirrorstudio://pair?ip=${host}&port=${port}&code=${code.replace(/-/g, '')}&token=${m.token}&v=5`, expiresAt: m.expiresAt })
  } else if (m.t === 'welcome') {
    out({ event: 'welcome', you: m.you })
  } else if (m.t === 'state') {
    out({ event: 'state', participants: m.state.participants.map((p) => ({ name: p.name, device: p.device, hand: p.hand, pairedWith: p.pairedWith })), presenter: m.state.presenter })
  } else if (m.t === 'ink' || m.t === 'pointer') {
    // Los trazos y el laser llegan muy seguido: se resumen.
    out({ event: m.t, from: m.from, ...(m.t === 'pointer' ? { x: m.x, y: m.y, on: m.on } : { stroke: m.stroke, points: m.points.length, done: m.done, color: m.color, tool: m.tool }) })
  } else {
    out({ event: m.t, ...m })
  }
})
client.on('closed', (reason) => { out({ event: 'closed', reason }); process.exit(0) })

client.connect(host, port, code, name).then(
  () => out({ event: 'joined', name }),
  (e) => { out({ event: 'error', message: String(e?.message ?? e) }); process.exit(1) }
)

createInterface({ input: process.stdin }).on('line', (line) => {
  const cmd = line.trim()
  if (cmd === 'pair') client.send({ t: 'pair-create' })
  else if (cmd === 'present') client.send({ t: 'present-start', source: 'screen' })
  else if (cmd === 'stop') client.send({ t: 'present-stop' })
  else if (cmd.startsWith('send ')) client.send(JSON.parse(cmd.slice(5)))
  else if (cmd === 'quit') { client.close(); setTimeout(() => process.exit(0), 300) }
})
