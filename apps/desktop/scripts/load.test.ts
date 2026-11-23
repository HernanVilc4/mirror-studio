// Control-plane load: 35 real sockets, production PBKDF2 cost. Media (video/audio) is NOT measured here.
// Run: npx vitest run scripts/load.test.ts   (prints the numbers it measured)
import { describe, it, expect } from 'vitest'
import { MeetingHost, type Conn } from '../src/main/meeting'
import { MeetingServer, MeetingClient } from '../src/main/meeting-net'
import { generateCode, PBKDF2_ITERATIONS } from '@mirror-studio/protocol/src/node'
import { MAX_PARTICIPANTS, type ServerMessage } from '@mirror-studio/protocol'

describe('35 participants', () => {
  it('all join at once with production key stretching, then a broadcast reaches everyone', async () => {
    const code = generateCode()
    const meeting = new MeetingHost('Carga')
    meeting.join('Ana', { send() {}, close() {} } as Conn)
    const srv = new MeetingServer(meeting, code, 'host', PBKDF2_ITERATIONS)
    const port = await srv.start(0, '127.0.0.1')
    const seen = new Map<number, number>()
    const clients = Array.from({ length: MAX_PARTICIPANTS - 1 }, (_, i) => {
      const c = new MeetingClient(); c.on('message', (m: ServerMessage) => { if (m.t === 'state' && m.state.presenter) seen.set(i, Date.now()) }); return c
    })
    const mem0 = process.memoryUsage().rss, cpu0 = process.cpuUsage(), t0 = Date.now()
    await Promise.all(clients.map((c, i) => c.connect('127.0.0.1', port, code, `p${i}`)))
    const joinMs = Date.now() - t0
    await new Promise((r) => setTimeout(r, 200))
    expect(meeting.size).toBe(MAX_PARTICIPANTS)
    const t1 = Date.now()
    meeting.handle(meeting.state().participants[0].id, { t: 'present-start' })
    for (let i = 0; i < 100 && seen.size < clients.length; i++) await new Promise((r) => setTimeout(r, 10))
    const bcastMs = Math.max(...seen.values()) - t1
    const cpu = process.cpuUsage(cpu0)
    console.log(`LOAD joined=${meeting.size} joinAll=${joinMs}ms broadcastToAll=${bcastMs}ms cpu(user+sys)=${Math.round((cpu.user + cpu.system) / 1000)}ms rssDelta=${Math.round((process.memoryUsage().rss - mem0) / 1e6)}MB (clients and host share this process)`)
    expect(seen.size).toBe(clients.length)
    clients.forEach((c) => c.close()); srv.stop()
  }, 60000)
})
