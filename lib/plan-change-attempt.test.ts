import { describe, it, expect } from 'vitest'
import { decidePlanChangeAttempt } from './plan-change'
import { buildPlanChangeReference, parseExternalReference } from './asaas'

describe('decidePlanChangeAttempt (P0-A: identidade por TENTATIVA, não por alvo)', () => {
  it('sem linha anterior → tentativa NOVA (nonce fresco, sem payment id)', () => {
    expect(decidePlanChangeAttempt(null, 'plus', 'MONTHLY', 'fresh-1')).toEqual({ attemptId: 'fresh-1', savedPaymentId: null })
  })

  it('mesma troca EM ANDAMENTO (recovering) → CONTINUA (reusa attemptId + payment id)', () => {
    const prev = { plan: 'plus', cycle: 'MONTHLY', status: 'recovering', asaas_payment_id: 'pay_1', planchange_attempt_id: 'att_1' }
    expect(decidePlanChangeAttempt(prev, 'plus', 'MONTHLY', 'fresh')).toEqual({ attemptId: 'att_1', savedPaymentId: 'pay_1' })
  })

  it('mesma troca em PENDING → CONTINUA', () => {
    const prev = { plan: 'plus', cycle: 'MONTHLY', status: 'pending', asaas_payment_id: 'pay_1', planchange_attempt_id: 'att_1' }
    expect(decidePlanChangeAttempt(prev, 'plus', 'MONTHLY', 'fresh').attemptId).toBe('att_1')
  })

  it('troca anterior CONCLUÍDA (paid) pro MESMO plano → tentativa NOVA (não reusa avulso velho)', () => {
    const prev = { plan: 'plus', cycle: 'MONTHLY', status: 'paid', asaas_payment_id: 'pay_old', planchange_attempt_id: 'att_old' }
    expect(decidePlanChangeAttempt(prev, 'plus', 'MONTHLY', 'fresh-3')).toEqual({ attemptId: 'fresh-3', savedPaymentId: null })
  })

  it('A→B→A: linha da troca B (outro alvo, paga) → tentativa NOVA pra A (cobra)', () => {
    const prev = { plan: 'starter', cycle: 'MONTHLY', status: 'paid', asaas_payment_id: 'pay_b', planchange_attempt_id: 'att_b' }
    expect(decidePlanChangeAttempt(prev, 'professional', 'MONTHLY', 'fresh-4')).toEqual({ attemptId: 'fresh-4', savedPaymentId: null })
  })

  it('cancelled → tentativa NOVA', () => {
    const prev = { plan: 'plus', cycle: 'MONTHLY', status: 'cancelled', asaas_payment_id: 'pay_x', planchange_attempt_id: 'att_x' }
    expect(decidePlanChangeAttempt(prev, 'plus', 'MONTHLY', 'fresh-5')).toEqual({ attemptId: 'fresh-5', savedPaymentId: null })
  })

  it('alvo igual e in-flight mas SEM attempt id (linha legada) → tentativa NOVA', () => {
    const prev = { plan: 'plus', cycle: 'MONTHLY', status: 'recovering', asaas_payment_id: null, planchange_attempt_id: null }
    expect(decidePlanChangeAttempt(prev, 'plus', 'MONTHLY', 'fresh-6').attemptId).toBe('fresh-6')
  })
})

describe('externalReference com |attempt: não quebra o webhook backstop', () => {
  it('parseExternalReference ignora o attempt e extrai profile/plan/cycle/kind', () => {
    const uuid = '11111111-1111-1111-1111-111111111111'
    const ref = `${buildPlanChangeReference(uuid, 'plus', 'MONTHLY')}|attempt:abc-123`
    const parsed = parseExternalReference(ref)
    expect(parsed.profileId).toBe(uuid)
    expect(parsed.plan).toBe('plus')
    expect(parsed.cycle).toBe('MONTHLY')
    expect(parsed.kind).toBe('planchange')
    expect(parsed.attempt).toBe('abc-123')
  })
})
