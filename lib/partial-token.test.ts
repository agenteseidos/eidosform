import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { signPartialToken, verifyPartialToken } from './partial-token'

// A1 (auditoria 2026-06-10): prova de posse de resposta parcial anônima.
// Sem isto, qualquer um com o response_id (UUID) podia sobrescrever a parcial.

const RID = '11111111-1111-4111-8111-111111111111'
const OTHER_RID = '22222222-2222-4222-8222-222222222222'

describe('partial-token', () => {
  const prev = process.env.PARTIAL_TOKEN_SECRET
  beforeEach(() => { process.env.PARTIAL_TOKEN_SECRET = 'test-partial-secret' })
  afterEach(() => {
    if (prev === undefined) delete process.env.PARTIAL_TOKEN_SECRET
    else process.env.PARTIAL_TOKEN_SECRET = prev
  })

  it('aceita o token emitido para o mesmo response_id', () => {
    const token = signPartialToken(RID)
    expect(verifyPartialToken(token, RID)).toBe(true)
  })

  it('rejeita o token de OUTRO response_id (anti-IDOR)', () => {
    const token = signPartialToken(OTHER_RID)
    expect(verifyPartialToken(token, RID)).toBe(false)
  })

  it('rejeita token ausente ou vazio', () => {
    expect(verifyPartialToken(undefined, RID)).toBe(false)
    expect(verifyPartialToken(null, RID)).toBe(false)
    expect(verifyPartialToken('', RID)).toBe(false)
  })

  it('rejeita token forjado / aleatório', () => {
    expect(verifyPartialToken('deadbeef'.repeat(8), RID)).toBe(false)
    expect(verifyPartialToken('not-a-hex-token', RID)).toBe(false)
  })

  it('rejeita quando o response_id é vazio', () => {
    const token = signPartialToken(RID)
    expect(verifyPartialToken(token, '')).toBe(false)
  })

  it('o token muda quando o secret muda (não é verificável com chave errada)', () => {
    const token = signPartialToken(RID)
    process.env.PARTIAL_TOKEN_SECRET = 'outro-secret'
    expect(verifyPartialToken(token, RID)).toBe(false)
  })

  it('é determinístico para o mesmo (id, secret)', () => {
    expect(signPartialToken(RID)).toBe(signPartialToken(RID))
  })
})
