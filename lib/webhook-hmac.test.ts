import { describe, it, expect } from 'vitest'
import { createHmac } from 'crypto'
import { verifyAsaasSignature } from './webhook-hmac'

const SECRET = 'test-secret'

function sign(payload: string, ts: number, secret = SECRET) {
  const hash = createHmac('sha256', secret).update(payload).digest('hex')
  return `timestamp=${ts}&hash=${hash}`
}

describe('verifyAsaasSignature', () => {
  it('accepts a fresh, valid signature', () => {
    const payload = '{"event":"PAYMENT_CONFIRMED"}'
    const ts = Math.floor(Date.now() / 1000)
    expect(verifyAsaasSignature(payload, sign(payload, ts), SECRET)).toBe(true)
  })

  it('rejects a missing header', () => {
    expect(verifyAsaasSignature('{}', null, SECRET)).toBe(false)
  })

  it('rejects malformed header', () => {
    expect(verifyAsaasSignature('{}', 'not-a-valid-header', SECRET)).toBe(false)
  })

  it('rejects header missing hash', () => {
    expect(verifyAsaasSignature('{}', `timestamp=${Math.floor(Date.now() / 1000)}`, SECRET)).toBe(false)
  })

  it('rejects header missing timestamp', () => {
    expect(verifyAsaasSignature('{}', 'hash=deadbeef', SECRET)).toBe(false)
  })

  it('rejects timestamp older than 5 minutes', () => {
    const payload = '{"event":"X"}'
    const ts = Math.floor(Date.now() / 1000) - (6 * 60)
    expect(verifyAsaasSignature(payload, sign(payload, ts), SECRET)).toBe(false)
  })

  it('rejects timestamp in the future', () => {
    const payload = '{"event":"X"}'
    const ts = Math.floor(Date.now() / 1000) + 60
    expect(verifyAsaasSignature(payload, sign(payload, ts), SECRET)).toBe(false)
  })

  it('rejects wrong hash', () => {
    const payload = '{"event":"X"}'
    const ts = Math.floor(Date.now() / 1000)
    const tampered = sign('{"event":"Y"}', ts)
    expect(verifyAsaasSignature(payload, tampered, SECRET)).toBe(false)
  })

  it('rejects wrong secret', () => {
    const payload = '{"event":"X"}'
    const ts = Math.floor(Date.now() / 1000)
    expect(verifyAsaasSignature(payload, sign(payload, ts, 'other-secret'), SECRET)).toBe(false)
  })

  it('rejects non-numeric timestamp', () => {
    expect(verifyAsaasSignature('{}', 'timestamp=abc&hash=deadbeef', SECRET)).toBe(false)
  })

  it('rejects malformed hex hash without throwing', () => {
    const ts = Math.floor(Date.now() / 1000)
    expect(verifyAsaasSignature('{}', `timestamp=${ts}&hash=zzzz`, SECRET)).toBe(false)
  })
})
