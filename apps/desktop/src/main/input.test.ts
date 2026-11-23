import { describe, it, expect } from 'vitest'
import { RemoteInput, KEYMAP, type InputDriver } from './input'

function fake(supported = true) {
  const calls: string[] = []
  const d: InputDriver = {
    supported,
    mouseMove: (x, y) => calls.push(`move ${x} ${y}`),
    mouseButton: (b, down) => calls.push(`btn ${b} ${down ? 'down' : 'up'}`),
    wheel: (dx, dy) => calls.push(`wheel ${dx} ${dy}`),
    key: (vk, ext, down) => calls.push(`key ${vk}${ext ? 'e' : ''} ${down ? 'down' : 'up'}`),
    text: (s) => calls.push(`text ${s}`),
    dispose: () => calls.push('dispose')
  }
  return { d, calls }
}

describe('RemoteInput', () => {
  it('ignores input until begin() and from anyone but the controller', () => {
    const { d, calls } = fake(); const r = new RemoteInput(d)
    r.apply('prof', { t: 'mouse-move', x: 0.1, y: 0.2 })
    expect(calls).toEqual([])
    expect(r.begin('prof')).toBe(true)
    r.apply('eve', { t: 'mouse-move', x: 0.1, y: 0.2 })
    expect(calls).toEqual([])
    r.apply('prof', { t: 'mouse-move', x: 0.1, y: 0.2 })
    expect(calls).toEqual(['move 0.1 0.2'])
  })
  it('refuses on platforms that cannot inject input', () => {
    const { d } = fake(false); const r = new RemoteInput(d)
    expect(r.begin('prof')).toBe(false)
    expect(r.active).toBe(false)
  })
  it('releases held keys and buttons when control ends, and not the ones already released', () => {
    const { d, calls } = fake(); const r = new RemoteInput(d)
    r.begin('prof')
    r.apply('prof', { t: 'key', code: 'ControlLeft', down: true })
    r.apply('prof', { t: 'key', code: 'KeyC', down: true })
    r.apply('prof', { t: 'key', code: 'KeyC', down: false })
    r.apply('prof', { t: 'mouse-button', button: 'left', down: true })
    calls.length = 0
    r.end()
    expect(calls.sort()).toEqual(['btn left up', 'key 162 up'].sort()) // Ctrl and left button only
    expect(r.active).toBe(false)
    calls.length = 0
    r.end() // idempotent
    expect(calls).toEqual([])
  })
  it('stops applying input after end()', () => {
    const { d, calls } = fake(); const r = new RemoteInput(d)
    r.begin('prof'); r.end()
    r.apply('prof', { t: 'key', code: 'KeyA', down: true })
    expect(calls).toEqual([])
  })
  it('clears leftovers when a new controller starts', () => {
    const { d, calls } = fake(); const r = new RemoteInput(d)
    r.begin('a'); r.apply('a', { t: 'key', code: 'ShiftLeft', down: true })
    calls.length = 0
    r.begin('b')
    expect(calls).toEqual(['key 160 up'])
  })
  it('drops keys that are not in the allowed map', () => {
    const { d, calls } = fake(); const r = new RemoteInput(d)
    r.begin('prof')
    r.apply('prof', { t: 'key', code: 'LaunchApp1', down: true })
    r.apply('prof', { t: 'key', code: 'Power', down: true })
    expect(calls).toEqual([])
  })
  it('maps extended keys', () => {
    const { d, calls } = fake(); const r = new RemoteInput(d)
    r.begin('prof'); r.apply('prof', { t: 'key', code: 'ArrowUp', down: true })
    expect(calls).toEqual(['key 38e down'])
    expect(KEYMAP.KeyA).toEqual([0x41, false])
    expect(KEYMAP.F5).toEqual([0x74, false])
  })
  it('dispose releases and shuts the driver', () => {
    const { d, calls } = fake(); const r = new RemoteInput(d)
    r.begin('prof'); r.apply('prof', { t: 'mouse-button', button: 'right', down: true }); calls.length = 0
    r.dispose()
    expect(calls).toEqual(['btn right up', 'dispose'])
  })
})
