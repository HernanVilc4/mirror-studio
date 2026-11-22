// Node-only helpers (main process / tests). Android must implement the same HMAC-SHA256 -> lowercase hex.
import { createHmac, timingSafeEqual } from 'node:crypto'

export const signSdp = (token: string, sdp: string) => createHmac('sha256', token).update(sdp).digest('hex')
export function verifySdp(token: string, sdp: string, sig: string): boolean {
  const a = Buffer.from(signSdp(token, sdp)); const b = Buffer.from(sig)
  return a.length === b.length && timingSafeEqual(a, b)
}
