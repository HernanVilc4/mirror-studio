// Node-only. Builds the cross-language test vectors in packages/protocol/vectors/ (see the README there).
// `npm run vectors -w @mirror-studio/protocol` writes them; vectors.test.ts fails when they are stale.
import { createHash } from 'node:crypto'
import { FILE_CHUNK, PHONE_CAPS, PROTOCOL_VERSION, encodeFileChunk, normalizeCode, splitMedia, PC_CAPS } from './index'
import {
  ClientHandshake, HostHandshake, SecureChannel, confirmMac, deriveCodeKey, deriveKeys, transcriptHash, x25519, x25519Public, PBKDF2_ITERATIONS
} from './node'

type Dir = 'client' | 'server' | 'handshake'
export interface ValidCase { name: string; dir: Dir; message: unknown; parsed?: unknown }
export interface InvalidCase { name: string; dir: Dir; message: unknown; why: string }
export interface MessageVectors { protocolVersion: number; area: string; valid: ValidCase[]; invalid: InvalidCase[]; frames?: unknown }

const A = '0b6c1f2e-8a4d-4c3b-9e5f-1a2b3c4d5e6f'
const B = '7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f0a'
const C = 'c3d4e5f6-a7b8-4c9d-8e0f-a1b2c3d4e5f6'
const SESSION = 'f1e2d3c4-b5a6-4978-8a9b-0c1d2e3f4a5b'
const MSG = '4a5b6c7d-8e9f-4a0b-9c1d-2e3f4a5b6c7d'
const POLL = '9e8d7c6b-5a49-4382-a716-05f4e3d2c1b0'
const SHA = createHash('sha256').update('hola').digest('hex')
const TOKEN = 'AAECAwQFBgcICQoLDA0ODw' // base64url of bytes 00..0f

const ok = (name: string, dir: Dir, message: unknown, parsed?: unknown): ValidCase => (parsed === undefined ? { name, dir, message } : { name, dir, message, parsed })
const bad = (name: string, dir: Dir, message: unknown, why: string): InvalidCase => ({ name, dir, message, why })
const area = (name: string, valid: ValidCase[], invalid: InvalidCase[], frames?: unknown): MessageVectors =>
  ({ protocolVersion: PROTOCOL_VERSION, area: name, valid, invalid, ...(frames ? { frames } : {}) })

const participant = (id: string, extra: object = {}) => ({ id, name: 'Alumno 4', role: 'participant', device: 'pc', hand: null, pairedWith: null, ...extra })
const state = (extra: object = {}) => ({
  sessionId: SESSION, name: 'Matemática II',
  participants: [
    { id: A, name: 'Docente', role: 'creator', host: true, device: 'pc', hand: null, pairedWith: B },
    { id: B, name: 'Galaxy de Docente', role: 'participant', device: 'phone', hand: null, pairedWith: A },
    participant(C, { hand: 1 })
  ],
  presenter: A, presenterSource: 'window', controls: [], settings: { chat: 'all', share: 'teachers', locked: false }, ...extra
})
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')

function session(): MessageVectors {
  const hello = { t: 'hello', v: PROTOCOL_VERSION, pub: 'q83vASNFZ4mrze8BI0VniavN7wEjRWeJq83vASNFZ4k=', nonce: 'AAECAwQFBgcICQoLDA0ODw==', name: 'Alumno 4' }
  return area('session', [
    ok('info', 'handshake', { t: 'info' }),
    ok('info-reply (any version parses)', 'handshake', { t: 'info-reply', v: 4, name: 'Matemática II', host: 'PC-DOCENTE', participants: 12 }),
    ok('hello from a PC', 'handshake', { ...hello, device: 'pc', caps: PC_CAPS }),
    ok('hello from a phone', 'handshake', { ...hello, device: 'phone', caps: PHONE_CAPS }),
    ok('hello with no caps', 'handshake', { ...hello, device: 'phone', caps: [] }),
    ok('hello-reply', 'handshake', { t: 'hello-reply', pub: hello.pub, nonce: hello.nonce, salt: 'EBESExQVFhcYGRobHB0eHw==' }),
    ok('confirm', 'handshake', { t: 'confirm', mac: 'ab'.repeat(32) }),
    ok('confirm-ok', 'handshake', { t: 'confirm-ok', mac: 'cd'.repeat(32) }),
    ok('reject: locked room', 'handshake', { t: 'reject', reason: 'La sala está bloqueada' }),
    ok('welcome', 'server', { t: 'welcome', you: C, state: state() }),
    ok('state, nobody presenting', 'server', { t: 'state', state: state({ presenter: null, presenterSource: null }) }),
    ok('state, phone camera', 'server', { t: 'state', state: state({ presenter: B, presenterSource: 'camera' }) }),
    ok('notice', 'server', { t: 'notice', text: 'Docente levantó la mano' }),
    ok('closed', 'server', { t: 'closed', reason: 'El anfitrión terminó la reunión' }),
    ok('kick', 'client', { t: 'kick', target: C }),
    ok('set-role', 'client', { t: 'set-role', target: C, role: 'teacher' }),
    ok('present-start without source defaults to screen', 'client', { t: 'present-start' }, { t: 'present-start', source: 'screen' }),
    ok('present-start window', 'client', { t: 'present-start', source: 'window' }),
    ok('present-start camera', 'client', { t: 'present-start', source: 'camera' }),
    ok('present-stop', 'client', { t: 'present-stop' }),
    ok('leave', 'client', { t: 'leave' }),
    ok('rtc', 'client', { t: 'rtc', kind: 'offer', data: 'v=0' }),
    ok('rtc from host', 'server', { t: 'rtc', kind: 'ice', data: '{}' }),
    ok('media-mode', 'client', { t: 'media-mode', relay: true, reason: 'no-connect' }),
    ok('media-mode from host', 'server', { t: 'media-mode', relay: true })
  ], [
    bad('hello v4', 'handshake', { ...hello, v: 4, device: 'pc', caps: PC_CAPS }, 'v must be 5'),
    bad('hello without device', 'handshake', { ...hello, caps: PC_CAPS }, 'device is required'),
    bad('hello without caps', 'handshake', { ...hello, device: 'pc' }, 'caps is required'),
    bad('hello unknown device', 'handshake', { ...hello, device: 'tablet', caps: [] }, 'device is pc or phone'),
    bad('hello unknown cap', 'handshake', { ...hello, device: 'pc', caps: ['relay', 'mic'] }, 'unknown cap'),
    bad('hello too many caps', 'handshake', { ...hello, device: 'pc', caps: Array(9).fill('files') }, 'caps max 8'),
    bad('hello name too long', 'handshake', { ...hello, name: 'x'.repeat(65), device: 'pc', caps: [] }, 'name max 64'),
    bad('state without settings', 'server', { t: 'state', state: { ...state(), settings: undefined } }, 'settings is required'),
    bad('state without presenterSource', 'server', { t: 'state', state: { ...state(), presenterSource: undefined } }, 'presenterSource is required (nullable)'),
    bad('state bad chat setting', 'server', { t: 'state', state: state({ settings: { chat: 'some', share: 'all', locked: false } }) }, 'chat is all, teachers or off'),
    bad('participant without device', 'server', { t: 'state', state: state({ participants: [{ id: A, name: 'Docente', role: 'creator', hand: null, pairedWith: null }] }) }, 'device is required'),
    bad('participant hand 0', 'server', { t: 'state', state: state({ participants: [participant(C, { hand: 0 })] }) }, 'hand is >= 1 or null'),
    bad('participant hand missing', 'server', { t: 'state', state: state({ participants: [{ id: C, name: 'Alumno 4', role: 'participant', device: 'pc', pairedWith: null }] }) }, 'hand is required (nullable)'),
    bad('participant pairedWith missing', 'server', { t: 'state', state: state({ participants: [{ id: C, name: 'Alumno 4', role: 'participant', device: 'pc', hand: null }] }) }, 'pairedWith is required (nullable)'),
    bad('present-start bad source', 'client', { t: 'present-start', source: 'tab' }, 'source is screen, window or camera'),
    bad('set-role creator', 'client', { t: 'set-role', target: C, role: 'creator' }, 'creator cannot be assigned'),
    bad('unknown t', 'client', { t: 'evil' }, 'unknown message'),
    bad('host-only message from a client', 'client', { t: 'welcome', you: C, state: state() }, 'welcome is host -> client only'),
    bad('client-only message from the host', 'server', { t: 'present-start' }, 'present-start is client -> host only'),
    bad('media-mode relay false', 'client', { t: 'media-mode', relay: false }, 'relay must be true')
  ])
}

function control(): MessageVectors {
  const health = { code: 'blocked-admin', detail: 'Taskmgr', received: 3 }
  return area('control', [
    ok('control-request', 'client', { t: 'control-request', target: C }),
    ok('control-respond', 'client', { t: 'control-respond', controller: A, accept: true }),
    ok('control-revoke', 'client', { t: 'control-revoke', other: A }),
    ok('control-input mouse-move', 'client', { t: 'control-input', target: C, input: { t: 'mouse-move', x: 0.25, y: 1 } }),
    ok('control-input mouse-button', 'client', { t: 'control-input', target: C, input: { t: 'mouse-button', button: 'left', down: true } }),
    ok('control-input wheel', 'client', { t: 'control-input', target: C, input: { t: 'wheel', dx: 0, dy: -120 } }),
    ok('control-input key', 'client', { t: 'control-input', target: C, input: { t: 'key', code: 'KeyA', down: false } }),
    ok('control-input text', 'client', { t: 'control-input', target: C, input: { t: 'text', text: 'ñ' } }),
    ok('control-status', 'client', { t: 'control-status', other: A, health }),
    ok('control-reset', 'client', { t: 'control-reset', target: C }),
    ok('control-asked', 'server', { t: 'control-asked', controller: A, name: 'Docente' }),
    ok('control-started', 'server', { t: 'control-started', controller: A, target: C }),
    ok('control-ended', 'server', { t: 'control-ended', controller: A, target: C, reason: 'Rechazado' }),
    ok('control-input to target', 'server', { t: 'control-input', from: A, input: { t: 'mouse-move', x: 0, y: 0 } }),
    ok('control-status to controller', 'server', { t: 'control-status', from: C, health }),
    ok('control-reset to target', 'server', { t: 'control-reset', from: A })
  ], [
    bad('mouse-move out of range', 'client', { t: 'control-input', target: C, input: { t: 'mouse-move', x: 1.5, y: 0 } }, 'x in 0..1'),
    bad('wheel too big', 'client', { t: 'control-input', target: C, input: { t: 'wheel', dx: 0, dy: 99999 } }, 'dy in -2000..2000'),
    bad('unknown health code', 'client', { t: 'control-status', other: A, health: { ...health, code: 'pwned' } }, 'unknown code'),
    bad('negative received', 'client', { t: 'control-status', other: A, health: { ...health, received: -1 } }, 'received >= 0'),
    bad('control-respond without accept', 'client', { t: 'control-respond', controller: A }, 'accept is required')
  ])
}

function pairing(): MessageVectors {
  return area('pairing', [
    ok('pair-create', 'client', { t: 'pair-create' }),
    ok('pair-claim', 'client', { t: 'pair-claim', token: TOKEN }),
    ok('pair-end', 'client', { t: 'pair-end' }),
    ok('pair-token', 'server', { t: 'pair-token', token: TOKEN, expiresAt: 1795000000000 })
  ], [
    bad('pair-claim without token', 'client', { t: 'pair-claim' }, 'token is required'),
    bad('pair-claim empty token', 'client', { t: 'pair-claim', token: '' }, 'token min 1'),
    bad('pair-claim token too long', 'client', { t: 'pair-claim', token: 'A'.repeat(33) }, 'token max 32'),
    bad('pair-token without expiresAt', 'server', { t: 'pair-token', token: TOKEN }, 'expiresAt is required'),
    bad('pair-token fractional expiresAt', 'server', { t: 'pair-token', token: TOKEN, expiresAt: 1.5 }, 'expiresAt is an integer'),
    bad('pair-token from a client', 'client', { t: 'pair-token', token: TOKEN, expiresAt: 1 }, 'host -> client only')
  ])
}

function slides(): MessageVectors {
  const actions = ['next', 'prev', 'first', 'last', 'black', 'white', 'start', 'end']
  return area('slides', [
    ...actions.map((action) => ok(`slide ${action}`, 'client', { t: 'slide', action })),
    ok('slide to the paired PC', 'server', { t: 'slide', from: B, action: 'next' }),
    ok('slide-state (phase 2)', 'client', { t: 'slide-state', index: 3, total: 12, nextTitle: 'Derivadas', notes: 'Recordar el ejemplo' }),
    ok('slide-state minimal', 'client', { t: 'slide-state', index: 1, total: 1 }),
    ok('slide-state to the paired phone', 'server', { t: 'slide-state', from: A, index: 3, total: 12, nextTitle: 'Derivadas' })
  ], [
    bad('slide-state index 0', 'client', { t: 'slide-state', index: 0, total: 12 }, 'index is 1-based'),
    bad('slide-state notes too long', 'client', { t: 'slide-state', index: 1, total: 1, notes: 'x'.repeat(2001) }, 'notes max 2000'),
    bad('slide-state without total', 'client', { t: 'slide-state', index: 1 }, 'total is required'),
    bad('slide unknown action', 'client', { t: 'slide', action: 'jump' }, 'unknown action'),
    bad('slide without action', 'client', { t: 'slide' }, 'action is required'),
    bad('slide from host without from', 'server', { t: 'slide', action: 'next' }, 'from is required host -> client')
  ])
}

function pointerInk(): MessageVectors {
  const ink = { t: 'ink', stroke: 7, points: [[0.1, 0.2], [0.15, 0.25]], color: 'red', width: 2, tool: 'pen', done: false }
  return area('pointer-ink', [
    ok('pointer', 'client', { t: 'pointer', x: 0.5, y: 0.5, on: true }),
    ok('pointer off', 'client', { t: 'pointer', x: 0, y: 1, on: false }),
    ok('ink', 'client', ink),
    ok('ink highlighter, last piece, no points', 'client', { ...ink, points: [], tool: 'highlighter', color: 'yellow', width: 3, done: true }),
    ok('ink 32 points', 'client', { ...ink, points: Array(32).fill([1, 0]) }),
    ok('ink-undo', 'client', { t: 'ink-undo' }),
    ok('ink-clear', 'client', { t: 'ink-clear' }),
    ok('pointer to the presenter', 'server', { t: 'pointer', from: B, x: 0.5, y: 0.5, on: true }),
    ok('ink to the presenter', 'server', { ...ink, from: B }),
    ok('ink-undo to the presenter', 'server', { t: 'ink-undo', from: B }),
    ok('ink-clear to the presenter', 'server', { t: 'ink-clear', from: B })
  ], [
    bad('pointer out of range', 'client', { t: 'pointer', x: -0.1, y: 0.5, on: true }, 'x in 0..1'),
    bad('pointer without on', 'client', { t: 'pointer', x: 0.5, y: 0.5 }, 'on is required'),
    bad('ink 33 points', 'client', { ...ink, points: Array(33).fill([0, 0]) }, 'points max 32'),
    bad('ink point with 3 numbers', 'client', { ...ink, points: [[0, 0, 0]] }, 'a point is [x, y]'),
    bad('ink point out of range', 'client', { ...ink, points: [[0, 2]] }, 'y in 0..1'),
    bad('ink width 4', 'client', { ...ink, width: 4 }, 'width is 1, 2 or 3'),
    bad('ink width as string', 'client', { ...ink, width: '2' }, 'width is a number'),
    bad('ink unknown color', 'client', { ...ink, color: 'green' }, 'color is red, blue, yellow or black'),
    bad('ink unknown tool', 'client', { ...ink, tool: 'eraser' }, 'tool is pen or highlighter'),
    bad('ink negative stroke', 'client', { ...ink, stroke: -1 }, 'stroke >= 0'),
    bad('ink fractional stroke', 'client', { ...ink, stroke: 1.5 }, 'stroke is an integer'),
    bad('pointer from host without from', 'server', { t: 'pointer', x: 0.5, y: 0.5, on: true }, 'from is required host -> client')
  ])
}

function messaging(): MessageVectors {
  const msg = { t: 'msg', id: MSG, from: C, at: 1795000000000, to: 'all', body: { kind: 'text', text: 'Hola' } }
  return area('messaging', [
    ok('msg-send text to all', 'client', { t: 'msg-send', to: 'all', body: { kind: 'text', text: 'Hola' } }),
    ok('msg-send question to teachers', 'client', { t: 'msg-send', to: 'teachers', body: { kind: 'question', text: '¿Entra en el examen?' } }),
    ok('msg-send link with title', 'client', { t: 'msg-send', to: 'all', body: { kind: 'link', url: 'https://example.org/apuntes', title: 'Apuntes' } }),
    ok('msg-send link without title', 'client', { t: 'msg-send', to: 'teachers', body: { kind: 'link', url: 'http://example.org' } }),
    ok('msg-send file', 'client', { t: 'msg-send', to: 'all', body: { kind: 'file', fileId: 1 } }),
    ok('msg-send poll', 'client', { t: 'msg-send', to: 'all', body: { kind: 'poll', pollId: POLL } }),
    ok('msg-send to people', 'client', { t: 'msg-send', to: [B, C], body: { kind: 'text', text: 'Revisen esto' } }),
    ok('msg-send javascript: link (schema-valid, the host rejects it)', 'client', { t: 'msg-send', to: 'all', body: { kind: 'link', url: 'javascript:alert(1)' } }),
    ok('msg-delete', 'client', { t: 'msg-delete', id: MSG }),
    ok('msg-mark', 'client', { t: 'msg-mark', id: MSG, answered: true }),
    ok('msg-show', 'client', { t: 'msg-show', id: MSG, anonymous: true }),
    ok('room-settings', 'client', { t: 'room-settings', chat: 'teachers', share: 'off', locked: true }),
    ok('mute-chat', 'client', { t: 'mute-chat', target: C, on: true }),
    ok('msg text', 'server', msg),
    ok('msg question, answered', 'server', { ...msg, to: 'teachers', body: { kind: 'question', text: '¿Entra?' }, answered: true }),
    ok('msg question shown anonymously', 'server', { ...msg, from: null, to: 'teachers', body: { kind: 'question', text: '¿Entra?' }, shown: true }),
    ok('msg link', 'server', { ...msg, body: { kind: 'link', url: 'https://example.org', title: 'Ejemplo' } }),
    ok('msg file', 'server', { ...msg, body: { kind: 'file', fileId: 3, name: 'apuntes.pdf', size: 123456, mime: 'application/pdf' } }),
    ok('msg poll', 'server', { ...msg, from: A, body: { kind: 'poll', pollId: POLL } }),
    ok('msg to people', 'server', { ...msg, from: A, to: [C] }),
    ok('msg-history', 'server', { t: 'msg-history', items: [msg] }),
    ok('msg-history empty', 'server', { t: 'msg-history', items: [] }),
    ok('msg-delete from host', 'server', { t: 'msg-delete', id: MSG, by: A })
  ], [
    bad('msg-send text too long', 'client', { t: 'msg-send', to: 'all', body: { kind: 'text', text: 'x'.repeat(1001) } }, 'text max 1000'),
    bad('msg-send empty text', 'client', { t: 'msg-send', to: 'all', body: { kind: 'text', text: '' } }, 'text min 1'),
    bad('msg-send unknown kind', 'client', { t: 'msg-send', to: 'all', body: { kind: 'sticker' } }, 'unknown kind'),
    bad('msg-send unknown destination', 'client', { t: 'msg-send', to: 'admins', body: { kind: 'text', text: 'x' } }, "to is 'all', 'teachers' or ids"),
    bad('msg-send empty id list', 'client', { t: 'msg-send', to: [], body: { kind: 'text', text: 'x' } }, 'ids min 1'),
    bad('msg-send 36 ids', 'client', { t: 'msg-send', to: Array(36).fill(C), body: { kind: 'text', text: 'x' } }, 'ids max 35'),
    bad('msg-send url too long', 'client', { t: 'msg-send', to: 'all', body: { kind: 'link', url: 'https://e.org/' + 'a'.repeat(2000) } }, 'url max 2000'),
    bad('msg-send title too long', 'client', { t: 'msg-send', to: 'all', body: { kind: 'link', url: 'https://e.org', title: 'x'.repeat(121) } }, 'title max 120'),
    bad('msg-send fileId as string', 'client', { t: 'msg-send', to: 'all', body: { kind: 'file', fileId: '1' } }, 'fileId is an integer'),
    bad('msg-send fileId 0', 'client', { t: 'msg-send', to: 'all', body: { kind: 'file', fileId: 0 } }, 'fileId >= 1'),
    bad('msg-send with id (host assigns it)', 'client', { t: 'msg', id: MSG, from: C, at: 1, to: 'all', body: { kind: 'text', text: 'x' } }, 'msg is host -> client only'),
    bad('msg-show without anonymous', 'client', { t: 'msg-show', id: MSG }, 'anonymous is required'),
    bad('msg-mark without answered', 'client', { t: 'msg-mark', id: MSG }, 'answered is required'),
    bad('room-settings partial', 'client', { t: 'room-settings', chat: 'off' }, 'chat, share and locked are required'),
    bad('room-settings bad value', 'client', { t: 'room-settings', chat: 'none', share: 'all', locked: false }, 'chat is all, teachers or off'),
    bad('mute-chat without on', 'client', { t: 'mute-chat', target: C }, 'on is required'),
    bad('msg without at', 'server', { ...msg, at: undefined }, 'at is required'),
    bad('msg file body without name', 'server', { ...msg, body: { kind: 'file', fileId: 3 } }, 'host file body carries name, size, mime'),
    bad('msg-history 201 items', 'server', { t: 'msg-history', items: Array(201).fill(msg) }, 'items max 200'),
    bad('msg-delete from host without by', 'server', { t: 'msg-delete', id: MSG }, 'by is required host -> client')
  ])
}

function hand(): MessageVectors {
  return area('hand', [
    ok('hand up', 'client', { t: 'hand', up: true }),
    ok('hand up with a question', 'client', { t: 'hand', up: true, text: '¿Puede repetir el ejemplo?' }),
    ok('hand down', 'client', { t: 'hand', up: false }),
    ok('hand-lower', 'client', { t: 'hand-lower', target: C }),
    ok('state with the hand queue', 'server', { t: 'state', state: state({ participants: [participant(C, { hand: 1 }), participant(B, { hand: 2, device: 'phone' })] }) })
  ], [
    bad('hand without up', 'client', { t: 'hand' }, 'up is required'),
    bad('hand text too long', 'client', { t: 'hand', up: true, text: 'x'.repeat(201) }, 'text max 200'),
    bad('hand empty text', 'client', { t: 'hand', up: true, text: '' }, 'text min 1 when present'),
    bad('hand-lower without target', 'client', { t: 'hand-lower' }, 'target is required')
  ])
}

function polls(): MessageVectors {
  const create = { t: 'poll-create', question: '¿Qué tema repasamos?', options: ['Límites', 'Derivadas'], multi: false, anonymous: false, showResults: 'live' }
  const st = { t: 'poll-state', pollId: POLL, question: create.question, options: create.options, multi: false, anonymous: false, showResults: 'on-close', closed: false, total: 2 }
  return area('polls', [
    ok('poll-create', 'client', create),
    ok('poll-create 6 options, multi, anonymous, on-close', 'client', { ...create, options: ['a', 'b', 'c', 'd', 'e', 'f'], multi: true, anonymous: true, showResults: 'on-close' }),
    ok('poll-vote', 'client', { t: 'poll-vote', pollId: POLL, choices: [1] }),
    ok('poll-vote multi', 'client', { t: 'poll-vote', pollId: POLL, choices: [0, 5] }),
    ok('poll-close', 'client', { t: 'poll-close', pollId: POLL }),
    ok('poll-state for a voter (results on close)', 'server', st),
    ok('poll-state for the creator', 'server', { ...st, counts: [1, 1], voters: [{ id: B, choices: [0] }, { id: C, choices: [1] }] }),
    ok('poll-state closed', 'server', { ...st, closed: true, counts: [1, 1] })
  ], [
    bad('poll-create one option', 'client', { ...create, options: ['solo'] }, 'options min 2'),
    bad('poll-create seven options', 'client', { ...create, options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }, 'options max 6'),
    bad('poll-create option too long', 'client', { ...create, options: ['a', 'x'.repeat(101)] }, 'option max 100'),
    bad('poll-create question too long', 'client', { ...create, question: 'x'.repeat(301) }, 'question max 300'),
    bad('poll-create bad showResults', 'client', { ...create, showResults: 'never' }, "showResults is 'live' or 'on-close'"),
    bad('poll-vote no choices', 'client', { t: 'poll-vote', pollId: POLL, choices: [] }, 'choices min 1'),
    bad('poll-vote choice 6', 'client', { t: 'poll-vote', pollId: POLL, choices: [6] }, 'choice in 0..5'),
    bad('poll-vote seven choices', 'client', { t: 'poll-vote', pollId: POLL, choices: [0, 1, 2, 3, 4, 5, 0] }, 'choices max 6'),
    bad('poll-state without total', 'server', { ...st, total: undefined }, 'total is required')
  ])
}

function files(): MessageVectors {
  const offer = { t: 'file-offer', name: 'apuntes.pdf', size: 123456, sha256: SHA, mime: 'application/pdf' }
  const payload = new TextEncoder().encode('hola')
  const full = new Uint8Array(FILE_CHUNK).map((_, i) => i & 0xff)
  const frame = (fileId: number, index: number, count: number, p: Uint8Array) => ({ fileId, index, count, payloadHex: hex(p), frameHex: hex(encodeFileChunk(fileId, index, count, p)) })
  const header = (tag: number, fileId: number, index: number, count: number) => {
    const b = Buffer.alloc(13); b[0] = tag; b.writeUInt32BE(fileId, 1); b.writeUInt32BE(index, 5); b.writeUInt32BE(count, 9); return b
  }
  return area('files', [
    ok('file-offer', 'client', offer),
    ok('file-offer 50 MB', 'client', { ...offer, size: 50 * 1024 * 1024 }),
    ok('file-get', 'client', { t: 'file-get', fileId: 3 }),
    ok('file-accept', 'server', { t: 'file-accept', fileId: 3 }),
    ok('file-meta', 'server', { t: 'file-meta', fileId: 3, name: 'apuntes.pdf', size: 123456, sha256: SHA })
  ], [
    bad('file-offer over 50 MB', 'client', { ...offer, size: 50 * 1024 * 1024 + 1 }, 'size max 52428800'),
    bad('file-offer empty file', 'client', { ...offer, size: 0 }, 'size min 1'),
    bad('file-offer uppercase sha256', 'client', { ...offer, sha256: SHA.toUpperCase() }, 'sha256 is 64 lowercase hex'),
    bad('file-offer short sha256', 'client', { ...offer, sha256: SHA.slice(2) }, 'sha256 is 64 lowercase hex'),
    bad('file-offer name too long', 'client', { ...offer, name: 'x'.repeat(201) }, 'name max 200'),
    bad('file-offer mime too long', 'client', { ...offer, mime: 'x'.repeat(101) }, 'mime max 100'),
    bad('file-get fileId as string', 'client', { t: 'file-get', fileId: 'abc' }, 'fileId is an integer'),
    bad('file-get fileId too big', 'client', { t: 'file-get', fileId: 2 ** 31 }, 'fileId max 2^31 - 1'),
    bad('file-meta without sha256', 'server', { t: 'file-meta', fileId: 3, name: 'a.pdf', size: 1 }, 'sha256 is required')
  ], {
    $doc: 'FILE_TAG chunk: [0x02 u8][fileId u32 BE][index u32 BE][count u32 BE][payload <= 49152 bytes]. All but the last chunk carry exactly 49152 bytes.',
    valid: [
      { name: 'single chunk', ...frame(3, 0, 1, payload) },
      { name: 'first of three, full', ...frame(3, 0, 3, full) },
      { name: 'empty payload', ...frame(7, 1, 2, new Uint8Array(0)) }
    ],
    invalid: [
      { name: 'media tag', frameHex: hex(Buffer.concat([header(0x01, 3, 0, 1), payload])), why: 'tag must be 0x02' },
      { name: 'short header', frameHex: hex(header(0x02, 3, 0, 1).subarray(0, 12)), why: 'header is 13 bytes' },
      { name: 'fileId 0', frameHex: hex(header(0x02, 0, 0, 1)), why: 'fileId >= 1' },
      { name: 'count 0', frameHex: hex(header(0x02, 3, 0, 0)), why: 'count >= 1' },
      { name: 'index = count', frameHex: hex(header(0x02, 3, 2, 2)), why: 'index < count' },
      { name: 'count above 50 MB', frameHex: hex(header(0x02, 3, 0, 1068)), why: 'count <= ceil(52428800 / 49152) = 1067' },
      { name: 'payload too large', frameHex: hex(Buffer.concat([header(0x02, 3, 0, 1), Buffer.alloc(FILE_CHUNK + 1)])), why: 'payload <= 49152' }
    ]
  })
}

function media(): MessageVectors {
  const frame = new Uint8Array([0, 1, 2, 3, 4])
  return area('media', [], [], {
    $doc: 'MEDIA_TAG piece: [0x01 u8][stream u8][seq u32 BE][index u16 BE][count u16 BE][payload <= 49152]. Streams: 1 presentation, 2 control, 3 screen.',
    valid: [{ name: 'one-piece frame', stream: 1, seq: 9, frameHex: hex(frame), pieces: splitMedia(1, 9, frame).map(hex) }],
    invalid: []
  })
}

/** A full handshake with fixed keys, nonces, salt and code, every intermediate value, and sealed frames. */
export function handshakeVector() {
  const code = 'K7M2-QX9P', name = 'Galaxy de Ana', salt = 'EBESExQVFhcYGRobHB0eHw=='
  const clientPriv = createHash('sha256').update('mirror-studio vector client').digest()
  const hostPriv = createHash('sha256').update('mirror-studio vector host').digest()
  const clientNonce = 'AAECAwQFBgcICQoLDA0ODw==', hostNonce = 'IDAhMSIyIzMkNCU1JjYnNw=='
  const client = new ClientHandshake(code, name, PBKDF2_ITERATIONS, 'phone', PHONE_CAPS, { privateKey: clientPriv, nonce: clientNonce })
  const host = new HostHandshake(code, salt, PBKDF2_ITERATIONS, { privateKey: hostPriv, nonce: hostNonce })
  const hello = client.hello()
  const reply = host.onHello(hello)!
  const confirm = client.onReply(reply)!
  const done = host.onConfirm(confirm)!
  const cch = client.verifyOk(done.ok)!
  const cpub = x25519Public(clientPriv), hpub = x25519Public(hostPriv)
  const codeKey = deriveCodeKey(code, salt)
  const dh = x25519(clientPriv, hpub)!
  const parts = { cpub: hello.pub, hpub: reply.pub, cnonce: clientNonce, hnonce: hostNonce, name }
  const transcriptInput = JSON.stringify([parts.cpub, parts.hpub, parts.cnonce, parts.hnonce, salt, name])
  const transcript = transcriptHash(parts, salt)
  const keys = deriveKeys(dh, codeKey, transcript)
  const sealed = (dir: 'client->host' | 'host->client', ch: SecureChannel, key: Buffer, plaintext: string) => {
    const frame = ch.seal(plaintext)
    return { direction: dir, counter: 0, keyHex: key.toString('hex'), nonceHex: '000000000000000000000000', plaintext, frameHex: frame.toString('hex') }
  }
  return {
    $doc: [
      'Authenticated handshake (packages/protocol/src/node.ts) with fixed inputs. Byte strings are hex unless the field ends in B64 or is a wire message.',
      'codeKey = PBKDF2-HMAC-SHA256(normalize(code), base64decode(salt), iterations, 32). normalize = uppercase, keep [A-Z0-9].',
      'dh = X25519(clientPrivate, hostPublic). transcript = SHA-256("MS2" || utf8(transcriptInput)), transcriptInput = JSON.stringify([hello.pub, reply.pub, hello.nonce, reply.nonce, salt, hello.name]).',
      'okm = HKDF-SHA256(ikm = dh || codeKey, salt = transcript, info = "ms2-keys", 96 bytes): c2h = okm[0..32], h2c = okm[32..64], confirm = okm[64..96].',
      'clientMac = hex(HMAC-SHA256(confirm, "client" || transcript)) sent in confirm.mac; hostMac the same with "host", in confirm-ok.mac.',
      'Sealed frame: [counter u64 BE][AES-256-GCM ciphertext][16-byte tag], GCM nonce = 4 zero bytes || counter u64 BE. Client seals with c2h, host with h2c. Counters start at 0 per direction.',
      'The hello device/caps are not part of the transcript.'
    ],
    protocolVersion: PROTOCOL_VERSION,
    inputs: {
      code, codeNormalized: normalizeCode(code), iterations: PBKDF2_ITERATIONS, saltB64: salt, name, device: 'phone', caps: PHONE_CAPS,
      clientPrivateKey: clientPriv.toString('hex'), clientNonceB64: clientNonce,
      hostPrivateKey: hostPriv.toString('hex'), hostNonceB64: hostNonce
    },
    messages: { hello, helloReply: reply, confirm, confirmOk: done.ok },
    derived: {
      clientPublicKey: cpub.toString('hex'), hostPublicKey: hpub.toString('hex'),
      codeKey: codeKey.toString('hex'), dh: dh.toString('hex'), transcriptInput, transcript: transcript.toString('hex'),
      c2hKey: keys.c2h.toString('hex'), h2cKey: keys.h2c.toString('hex'), confirmKey: keys.confirm.toString('hex'),
      clientMac: confirmMac(keys.confirm, 'client', transcript), hostMac: confirmMac(keys.confirm, 'host', transcript)
    },
    sealed: [
      sealed('client->host', cch, keys.c2h, JSON.stringify({ t: 'present-start', source: 'camera' })),
      sealed('host->client', done.channel, keys.h2c, JSON.stringify({ t: 'notice', text: 'Ahora eres docente' }))
    ]
  }
}

/** File name (in vectors/) -> content. */
export function buildVectors(): Record<string, unknown> {
  return {
    'session.json': session(),
    'control.json': control(),
    'pairing.json': pairing(),
    'slides.json': slides(),
    'pointer-ink.json': pointerInk(),
    'messaging.json': messaging(),
    'hand.json': hand(),
    'polls.json': polls(),
    'files.json': files(),
    'media.json': media(),
    'handshake.json': handshakeVector()
  }
}
