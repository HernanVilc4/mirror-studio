import { describe, it, expect } from 'vitest'
import { parseSignal, parseControl, mapPointToDevice, MAX_MESSAGE_BYTES } from './index'
import { signSdp, verifySdp } from './node'

const hello = { t: 'hello', v: 1, token: 'abc', deviceId: 'd1', name: 'Pixel', model: 'Pixel 8' }

describe('protocol parsing', () => {
  it('accepts valid hello', () => expect(parseSignal(JSON.stringify(hello)).ok).toBe(true))
  it('rejects wrong version', () => expect(parseSignal(JSON.stringify({ ...hello, v: 2 })).ok).toBe(false))
  it('rejects malformed JSON, non-text, oversize and unknown types', () => {
    expect(parseSignal('{nope').ok).toBe(false)
    expect(parseSignal(42).ok).toBe(false)
    expect(parseSignal('x'.repeat(MAX_MESSAGE_BYTES + 1)).ok).toBe(false)
    expect(parseSignal(JSON.stringify({ t: 'evil' })).ok).toBe(false)
  })
  it('rejects out-of-range control coordinates', () => {
    expect(parseControl(JSON.stringify({ t: 'pointer', action: 'down', id: 0, x: 1.5, y: 0 })).ok).toBe(false)
    expect(parseControl(JSON.stringify({ t: 'pointer', action: 'down', id: 0, x: 0.5, y: 0.5 })).ok).toBe(true)
    expect(parseControl(JSON.stringify({ t: 'key', key: 'power' })).ok).toBe(false)
  })
})

describe('sdp signature', () => {
  it('verifies only with the same token and sdp', () => {
    const sig = signSdp('tok', 'v=0')
    expect(verifySdp('tok', 'v=0', sig)).toBe(true)
    expect(verifySdp('other', 'v=0', sig)).toBe(false)
    expect(verifySdp('tok', 'v=1', sig)).toBe(false)
    expect(verifySdp('tok', 'v=0', 'short')).toBe(false)
  })
})

describe('mapPointToDevice', () => {
  const box = { x: 100, y: 50, w: 400, h: 400 }
  it('portrait video letterboxed in square box', () => {
    // 9:16 video → displayed 225x400, centered: x offset 100+87.5
    expect(mapPointToDevice(187.5 + 112.5, 250, box, 1080, 1920)).toEqual({ x: 0.5, y: 0.5 })
    expect(mapPointToDevice(110, 250, box, 1080, 1920)).toBeNull() // letterbox bar
  })
  it('landscape after rotation uses new video size', () => {
    const p = mapPointToDevice(100, 50 + 87.5, box, 1920, 1080)!
    expect(p.x).toBe(0); expect(p.y).toBeCloseTo(0)
  })
  it('degenerate sizes return null', () => expect(mapPointToDevice(0, 0, { x: 0, y: 0, w: 0, h: 0 }, 1, 1)).toBeNull())
})
