import { describe, it, expect } from 'vitest'
import { StallWatch, videoLimits } from './media'
import { packFrame, unpackFrame, FRAME_HEADER } from './media-relay'

describe('stall watchdog (black-screen detection)', () => {
  it('fires only when an expected picture stays still for the whole window', () => {
    const w = new StallWatch(6000)
    expect(w.update(true, 0, 0)).toBe(false)
    expect(w.update(true, 0, 5999)).toBe(false)
    expect(w.update(true, 0, 6000)).toBe(true)
  })
  it('moving frames keep resetting it', () => {
    const w = new StallWatch(6000)
    for (let t = 0; t <= 20_000; t += 1000) expect(w.update(true, t / 1000, t)).toBe(false)
  })
  it('not expecting a picture never fires, and expecting again starts a fresh window', () => {
    const w = new StallWatch(6000)
    expect(w.update(false, undefined, 0)).toBe(false)
    expect(w.update(false, undefined, 60_000)).toBe(false)
    expect(w.update(true, 10, 60_000)).toBe(false)
    expect(w.update(true, 10, 65_000)).toBe(false)
    expect(w.update(true, 10, 66_000)).toBe(true)
  })
  it('no stats at all (nothing ever received) counts as still', () => {
    const w = new StallWatch(1000)
    w.update(true, undefined, 0)
    expect(w.update(true, undefined, 1000)).toBe(true)
  })
})

describe('relay frame header', () => {
  it('round-trips', () => {
    const data = new Uint8Array([1, 2, 3])
    const f = unpackFrame(packFrame(2, true, 2560, 1440, 123456789, data))!
    expect(f).toMatchObject({ codec: 2, key: true, width: 2560, height: 1440, timestamp: 123456789 })
    expect([...f.data]).toEqual([1, 2, 3])
    expect(unpackFrame(new Uint8Array(FRAME_HEADER - 1))).toBeNull()
  })
  it('the key flag is byte 1, bit 0: the main process relies on it to skip orphan deltas', () => {
    expect(packFrame(1, true, 2, 2, 0, null)[1] & 1).toBe(1)
    expect(packFrame(1, false, 2, 2, 0, null)[1] & 1).toBe(0)
  })
})

describe('video limits', () => {
  it('small rooms get 60 fps, big rooms fall back to keep the host affordable', () => {
    expect(videoLimits(1)).toEqual({ bitrate: 12_000_000, fps: 60 })
    expect(videoLimits(8).fps).toBe(30)
    expect(videoLimits(35)).toEqual({ bitrate: 2_500_000, fps: 15 })
  })
})
