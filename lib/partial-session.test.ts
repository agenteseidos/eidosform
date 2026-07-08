/**
 * Testes de lib/partial-session.ts — idempotência da criação de parciais.
 *
 * Contexto (fix 2026-07-08): o primeiro save parcial podia acontecer via
 * sendBeacon (sem resposta legível) e o cliente nunca recebia o response_id —
 * o retorno criava response duplicada. A session key do cliente + índice único
 * (form_id, hash) fazem fetch/beacon/submit convergirem pra mesma row; a
 * partial_revision impede que saves fora de ordem regridam respostas
 * (exigência da auditoria Codex: testes explícitos de ordem invertida).
 */
import { describe, it, expect } from 'vitest'
import {
  isValidSessionKey,
  hashSessionKey,
  hashLogPrefix,
  shouldApplyRevision,
  parseRevision,
} from './partial-session'

describe('isValidSessionKey', () => {
  it('aceita UUID v4 (gerador primário do cliente)', () => {
    expect(isValidSessionKey('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
  })

  it('aceita hex de 32 chars (fallback de getRandomValues)', () => {
    expect(isValidSessionKey('a3f9c2e18b4d76052f1e9a8c3b7d4e60')).toBe(true)
  })

  it('rejeita curta demais, longa demais e vazia', () => {
    expect(isValidSessionKey('abc123')).toBe(false)
    expect(isValidSessionKey('a'.repeat(65))).toBe(false)
    expect(isValidSessionKey('')).toBe(false)
  })

  it('rejeita caracteres fora de [A-Za-z0-9-] (injeção/lixo)', () => {
    expect(isValidSessionKey('550e8400-e29b-41d4-a716-44665544000!')).toBe(false)
    expect(isValidSessionKey('550e8400 e29b 41d4 a716 446655440000')).toBe(false)
    expect(isValidSessionKey("'; drop table responses; --")).toBe(false)
  })

  it('rejeita não-strings', () => {
    expect(isValidSessionKey(null)).toBe(false)
    expect(isValidSessionKey(undefined)).toBe(false)
    expect(isValidSessionKey(12345678901234567890)).toBe(false)
    expect(isValidSessionKey({})).toBe(false)
  })
})

describe('hashSessionKey', () => {
  it('é determinístico (mesma key → mesmo hash)', () => {
    const k = '550e8400-e29b-41d4-a716-446655440000'
    expect(hashSessionKey(k)).toBe(hashSessionKey(k))
  })

  it('keys diferentes → hashes diferentes', () => {
    expect(hashSessionKey('550e8400-e29b-41d4-a716-446655440000'))
      .not.toBe(hashSessionKey('550e8400-e29b-41d4-a716-446655440001'))
  })

  it('produz sha256 hex (64 chars)', () => {
    expect(hashSessionKey('a'.repeat(20))).toMatch(/^[0-9a-f]{64}$/)
  })

  it('hashLogPrefix expõe só 8 chars (nunca o hash completo em log)', () => {
    const h = hashSessionKey('550e8400-e29b-41d4-a716-446655440000')
    expect(hashLogPrefix(h)).toBe(h.slice(0, 8))
    expect(hashLogPrefix(h).length).toBe(8)
  })
})

describe('shouldApplyRevision — ordem invertida (obrigatório na auditoria)', () => {
  it('ordem normal: handshake rev1 chega antes, beacon rev2 depois → ambos aplicam', () => {
    expect(shouldApplyRevision(null, 1)).toBe(true) // rev1 sobre row sem revisão
    expect(shouldApplyRevision(1, 2)).toBe(true) // rev2 sobre rev1
  })

  it('ORDEM INVERTIDA: beacon rev2 processado primeiro, handshake rev1 chega depois → rev1 REJEITADA', () => {
    expect(shouldApplyRevision(null, 2)).toBe(true) // beacon rev2 cria/aplica
    expect(shouldApplyRevision(2, 1)).toBe(false) // handshake rev1 atrasado NÃO regride
  })

  it('revisão repetida (retry do mesmo save) não reaplica', () => {
    expect(shouldApplyRevision(3, 3)).toBe(false)
  })

  it('cliente legado (sem revisão) mantém comportamento atual de sobrescrita', () => {
    expect(shouldApplyRevision(null, null)).toBe(true)
    expect(shouldApplyRevision(5, null)).toBe(true)
    expect(shouldApplyRevision(5, undefined)).toBe(true)
  })

  it('row legada (revisão null) aceita qualquer revisão nova', () => {
    expect(shouldApplyRevision(null, 7)).toBe(true)
    expect(shouldApplyRevision(undefined, 1)).toBe(true)
  })
})

describe('parseRevision', () => {
  it('aceita inteiros positivos no intervalo', () => {
    expect(parseRevision(1)).toBe(1)
    expect(parseRevision(42)).toBe(42)
    expect(parseRevision(1_000_000)).toBe(1_000_000)
  })

  it('rejeita zero, negativos, floats, strings e absurdos → null (trata como legado)', () => {
    expect(parseRevision(0)).toBe(null)
    expect(parseRevision(-1)).toBe(null)
    expect(parseRevision(1.5)).toBe(null)
    expect(parseRevision('2')).toBe(null)
    expect(parseRevision(1_000_001)).toBe(null)
    expect(parseRevision(null)).toBe(null)
    expect(parseRevision(undefined)).toBe(null)
    expect(parseRevision(NaN)).toBe(null)
  })
})
