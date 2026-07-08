/**
 * Testes de lib/identity-match.ts — detector PASSIVO de duplicatas (log-only).
 * Identidade identifica, não prova posse — nunca autoriza merge (auditoria 2026-07-08).
 */
import { describe, it, expect } from 'vitest'
import {
  normalizeEmail,
  normalizePhone,
  phonesMatch,
  extractIdentity,
  identitiesMatch,
} from './identity-match'
import type { QuestionConfig } from './database.types'

describe('normalizeEmail', () => {
  it('normaliza caixa e espaços', () => {
    expect(normalizeEmail('  Sidney@InstitutoEidos.com.BR ')).toBe('sidney@institutoeidos.com.br')
  })
  it('rejeita lixo', () => {
    expect(normalizeEmail('semarroba.com')).toBe(null)
    expect(normalizeEmail('a@b')).toBe(null)
    expect(normalizeEmail(42)).toBe(null)
    expect(normalizeEmail(null)).toBe(null)
  })
})

describe('normalizePhone / phonesMatch', () => {
  it('reduz a dígitos', () => {
    expect(normalizePhone('+55 (83) 99937-8937')).toBe('5583999378937')
  })
  it('rejeita curto/longo demais', () => {
    expect(normalizePhone('1234567')).toBe(null)
    expect(normalizePhone('1'.repeat(16))).toBe(null)
  })
  it('casa com e sem DDI (sufixo comum ≥ 8 dígitos)', () => {
    expect(phonesMatch('5583999378937', '83999378937')).toBe(true)
    expect(phonesMatch('83999378937', '5583999378937')).toBe(true)
    expect(phonesMatch('5583999378937', '5583999378937')).toBe(true)
  })
  it('não casa números diferentes nem sufixos curtos', () => {
    expect(phonesMatch('5583999378937', '5583999378938')).toBe(false)
    expect(phonesMatch('99378937', '78937')).toBe(false)
    expect(phonesMatch(null, '5583999378937')).toBe(false)
  })
})

describe('extractIdentity', () => {
  const questions = [
    { id: 'q1', type: 'short_text' },
    { id: 'q2', type: 'email' },
    { id: 'q3', type: 'phone' },
  ] as Pick<QuestionConfig, 'id' | 'type'>[]

  it('extrai das respostas por TIPO de pergunta', () => {
    const id = extractIdentity(questions, { q1: 'Sidney', q2: 'S@X.com.br', q3: '(83) 99937-8937' }, null)
    expect(id.email).toBe('s@x.com.br')
    expect(id.phone).toBe('83999378937')
  })

  it('cai pros campos ocultos da URL quando as respostas não têm', () => {
    const id = extractIdentity(questions, { q1: 'Sidney' }, { email: 'S@X.com.br', telefone: '83 99937-8937' })
    expect(id.email).toBe('s@x.com.br')
    expect(id.phone).toBe('83999378937')
  })

  it('resposta vence o url_param', () => {
    const id = extractIdentity(questions, { q2: 'resposta@x.com' }, { email: 'param@x.com' })
    expect(id.email).toBe('resposta@x.com')
  })

  it('sem nada → identidade vazia', () => {
    const id = extractIdentity(questions, {}, null)
    expect(id.email).toBe(null)
    expect(id.phone).toBe(null)
  })
})

describe('identitiesMatch', () => {
  it('casa por e-mail OU telefone', () => {
    expect(identitiesMatch({ email: 'a@b.com.br', phone: null }, { email: 'a@b.com.br', phone: null })).toBe(true)
    expect(identitiesMatch({ email: null, phone: '5583999378937' }, { email: null, phone: '83999378937' })).toBe(true)
  })
  it('não casa identidades vazias ou diferentes', () => {
    expect(identitiesMatch({ email: null, phone: null }, { email: null, phone: null })).toBe(false)
    expect(identitiesMatch({ email: 'a@b.com.br', phone: null }, { email: 'c@d.com.br', phone: null })).toBe(false)
  })
})
