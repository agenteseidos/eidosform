/**
 * markActivationEffectsClaimed (mesa 2026-08-03) — pré-ocupa a chave de efeitos
 * da sub criada por executePlanSwitch pra 1ª renovação NÃO disparar "plano
 * ativado" indevido. Invariantes: payload/chave idênticos ao claim, 23505 é
 * silêncio (chave já ocupada = objetivo atingido), erro NUNCA propaga.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/asaas', () => ({}))
vi.mock('@/lib/plan-limits', () => ({ PLANS: {}, handleUpgrade: vi.fn() }))
vi.mock('@/lib/logger', () => ({ log: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }))
vi.mock('@/lib/proration', () => ({ computeProrationBasisDays: vi.fn() }))
vi.mock('@/lib/response-quota', () => ({ buildResponseQuotaPeriodReset: vi.fn(() => ({})) }))

import { markActivationEffectsClaimed } from './billing-activation'
import { logError } from '@/lib/logger'

const inserts: Array<{ table: string; payload: unknown }> = []
let insertError: { code?: string } | null = null
let insertThrows = false

function makeDb() {
  return {
    from(table: string) {
      return {
        insert(payload: unknown) {
          if (insertThrows) return Promise.reject(new Error('db down'))
          inserts.push({ table, payload })
          return Promise.resolve({ error: insertError })
        },
      }
    },
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  inserts.length = 0
  insertError = null
  insertThrows = false
})

describe('markActivationEffectsClaimed', () => {
  it('grava o MESMO shape do claim (chave effects:<sub>:<plan>:<cycle>, ACTIVATION_EFFECTS, processed)', async () => {
    await markActivationEffectsClaimed(makeDb(), 'sub_nova', 'plus', 'MONTHLY')
    expect(inserts).toEqual([{
      table: 'asaas_webhook_events',
      payload: { event_id: 'effects:sub_nova:plus:MONTHLY', event: 'ACTIVATION_EFFECTS', status: 'processed' },
    }])
  })

  it('23505 (chave já ocupada) é silêncio — objetivo já atingido', async () => {
    insertError = { code: '23505' }
    await expect(markActivationEffectsClaimed(makeDb(), 's', 'p', 'c')).resolves.toBeUndefined()
    expect(vi.mocked(logError)).not.toHaveBeenCalled()
  })

  it('exceção do banco NUNCA propaga (degrada pro comportamento antigo, não quebra a troca)', async () => {
    insertThrows = true
    await expect(markActivationEffectsClaimed(makeDb(), 's', 'p', 'c')).resolves.toBeUndefined()
    expect(vi.mocked(logError)).toHaveBeenCalled()
  })
})
