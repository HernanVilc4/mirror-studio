// Anfitrion real de MirrorStudio (el mismo codigo del escritorio, sin Electron) para las pruebas del telefono.
// Lo empaqueta y lanza core/protocol/src/test/.../TestHost.kt. Escribe una linea JSON con el puerto y el codigo.
import { MeetingHost, type Conn } from '../../desktop/src/main/meeting'
import { MeetingServer } from '../../desktop/src/main/meeting-net'
import { generateCode, PBKDF2_ITERATIONS } from '@mirror-studio/protocol/src/node'

const code = generateCode()
const meeting = new MeetingHost('Clase de prueba')
meeting.join('Ana', { send() {}, close() {} } as Conn)
const server = new MeetingServer(meeting, code, 'PC-Docente', PBKDF2_ITERATIONS)
// Pruebas automaticas: solo loopback y puerto libre. Con un telefono real: MS_HOST=0.0.0.0 MS_PORT=47800.
server.start(Number(process.env.MS_PORT ?? 0), process.env.MS_HOST ?? '127.0.0.1').then((port) => {
  process.stdout.write(JSON.stringify({ port, code }) + '\n')
})
// Se cierra cuando la prueba cierra su entrada estandar.
process.stdin.on('end', () => { server.stop(); process.exit(0) })
process.stdin.resume()
