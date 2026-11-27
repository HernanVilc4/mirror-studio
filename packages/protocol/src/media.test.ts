import { describe, it, expect } from 'vitest'
import { splitMedia, MediaAssembler, MEDIA_PIECE, MEDIA_TAG, ClientMessage, ServerMessage } from './index'

describe('media framing (TCP video relay)', () => {
  it('splits and reassembles frames of any size', () => {
    for (const size of [0, 1, MEDIA_PIECE - 1, MEDIA_PIECE, MEDIA_PIECE + 1, 5 * MEDIA_PIECE + 17]) {
      const frame = Uint8Array.from({ length: size }, (_, i) => i % 251)
      const a = new MediaAssembler()
      let out: { stream: number; frame: Uint8Array } | null = null
      for (const p of splitMedia(2, 42, frame)) { expect(p.length).toBeLessThan(64 * 1024); out = a.push(p) }
      expect(out?.stream).toBe(2)
      expect(Buffer.from(out!.frame).equals(Buffer.from(frame))).toBe(true)
    }
  })
  it('a newer frame drops an unfinished older one, and a late older piece is ignored', () => {
    const a = new MediaAssembler()
    const old = splitMedia(1, 1, new Uint8Array(2 * MEDIA_PIECE))
    const neu = splitMedia(1, 2, new Uint8Array(10).fill(3))
    expect(a.push(old[0])).toBeNull()
    expect(a.push(neu[0])?.frame.length).toBe(10)
    expect(a.push(old[1])).toBeNull()
  })
  it('streams are independent', () => {
    const a = new MediaAssembler()
    const s1 = splitMedia(1, 5, new Uint8Array(MEDIA_PIECE + 1))
    expect(a.push(s1[0])).toBeNull()
    expect(a.push(splitMedia(2, 9, new Uint8Array(3))[0])?.stream).toBe(2)
    expect(a.push(s1[1])?.frame.length).toBe(MEDIA_PIECE + 1)
  })
  it('rejects malformed pieces', () => {
    const a = new MediaAssembler()
    expect(() => a.push(new Uint8Array([MEDIA_TAG, 1, 0]))).toThrow()
    const bad = new Uint8Array(12); bad[0] = MEDIA_TAG; bad[7] = 5; bad[9] = 2 // index 5 of 2
    expect(() => a.push(bad)).toThrow()
    const huge = new Uint8Array(12); huge[0] = MEDIA_TAG; huge[8] = 0xff; huge[9] = 0xff // 65535 pieces
    expect(() => a.push(huge)).toThrow()
  })
  it('media-mode parses in both directions and only as relay: true', () => {
    expect(ClientMessage.safeParse({ t: 'media-mode', relay: true, reason: 'no-connect' }).success).toBe(true)
    expect(ServerMessage.safeParse({ t: 'media-mode', relay: true }).success).toBe(true)
    expect(ClientMessage.safeParse({ t: 'media-mode', relay: false }).success).toBe(false)
  })
})
