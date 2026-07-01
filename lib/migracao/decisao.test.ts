import { describe, it, expect } from 'vitest'
import { resolverPlanoAtual, aplicarPisoMigracao, decidirMotivo } from './decisao'

describe('resolverPlanoAtual', () => {
  const futuro = new Date(Date.now() + 30 * 86400000).toISOString()
  const passado = new Date(Date.now() - 86400000).toISOString()

  it('active + plano pago vigente → plano+ciclo', () => {
    expect(resolverPlanoAtual({ plan: 'plus', plan_status: 'active', plan_cycle: 'YEARLY', plan_expires_at: futuro }))
      .toEqual({ plano: 'plus', ciclo: 'YEARLY', indeterminado: false })
  })
  it('canceling ainda vigente → plano+ciclo', () => {
    expect(resolverPlanoAtual({ plan: 'starter', plan_status: 'canceling', plan_cycle: 'MONTHLY', plan_expires_at: futuro }))
      .toEqual({ plano: 'starter', ciclo: 'MONTHLY', indeterminado: false })
  })
  it('active mas EXPIRADO → free e ciclo NULL (não "Grátis anual")', () => {
    expect(resolverPlanoAtual({ plan: 'plus', plan_status: 'active', plan_cycle: 'YEARLY', plan_expires_at: passado }))
      .toEqual({ plano: 'free', ciclo: null, indeterminado: false })
  })
  it('free legítimo (active) → free/null', () => {
    expect(resolverPlanoAtual({ plan: 'free', plan_status: 'active', plan_cycle: null, plan_expires_at: null }))
      .toEqual({ plano: 'free', ciclo: null, indeterminado: false })
  })
  it.each(['overdue', 'cancelled', 'canceled', 'expired', 'chargeback', 'inactive', 'refunded'])(
    'status "%s" → free/null (sem plano vigente)',
    (s) => {
      expect(resolverPlanoAtual({ plan: 'plus', plan_status: s, plan_cycle: 'YEARLY', plan_expires_at: futuro }))
        .toEqual({ plano: 'free', ciclo: null, indeterminado: false })
    }
  )
  it('status desconhecido → indeterminado', () => {
    expect(resolverPlanoAtual({ plan: 'plus', plan_status: 'zorp', plan_cycle: 'YEARLY', plan_expires_at: futuro }).indeterminado).toBe(true)
  })
  it('status legado "free" → indeterminado (fail-closed, não inventa)', () => {
    expect(resolverPlanoAtual({ plan: 'plus', plan_status: 'free', plan_cycle: null, plan_expires_at: null }).indeterminado).toBe(true)
  })
  it('plano inválido com status active → indeterminado (não coage pra free)', () => {
    expect(resolverPlanoAtual({ plan: 'enterprise_x', plan_status: 'active', plan_cycle: 'MONTHLY', plan_expires_at: futuro }).indeterminado).toBe(true)
  })
})

describe('aplicarPisoMigracao', () => {
  it('free vira starter (migração é benefício pago)', () => expect(aplicarPisoMigracao('free')).toBe('starter'))
  it('starter fica starter', () => expect(aplicarPisoMigracao('starter')).toBe('starter'))
  it('plus e professional ficam inalterados', () => {
    expect(aplicarPisoMigracao('plus')).toBe('plus')
    expect(aplicarPisoMigracao('professional')).toBe('professional')
  })
})

describe('decidirMotivo', () => {
  const base = { flags: [] as string[], contaNaoEncontrada: false, jaTemConta: false, planoAtual: null, tier: 'starter' as const }

  it('acima_do_limite tem precedência sobre tudo', () => {
    expect(decidirMotivo({ ...base, flags: ['acima_do_limite', 'requer_analise'] })).toBe('acima_do_limite')
  })
  it('acima_do_beneficio → requer_analise', () => {
    expect(decidirMotivo({ ...base, flags: ['acima_do_beneficio'] })).toBe('requer_analise')
  })
  it('conta não encontrada + declarou ter conta → conta_nao_encontrada', () => {
    expect(decidirMotivo({ ...base, contaNaoEncontrada: true, jaTemConta: true })).toBe('conta_nao_encontrada')
  })
  it('conta não encontrada + SEM conta declarada → assinar', () => {
    expect(decidirMotivo({ ...base, contaNaoEncontrada: true, jaTemConta: false })).toBe('assinar')
  })
  it('conta Free + tier Starter (piso) → upgrade (não "manter no Grátis")', () => {
    expect(decidirMotivo({ ...base, planoAtual: 'free', tier: 'starter' })).toBe('upgrade')
  })
  it('conta Starter cobre tier Starter → manter_plano', () => {
    expect(decidirMotivo({ ...base, planoAtual: 'starter', tier: 'starter' })).toBe('manter_plano')
  })
  it('conta Plus cobre tier Starter → manter_plano', () => {
    expect(decidirMotivo({ ...base, planoAtual: 'plus', tier: 'starter' })).toBe('manter_plano')
  })
  it('conta Starter, uso exige Plus → upgrade', () => {
    expect(decidirMotivo({ ...base, planoAtual: 'starter', tier: 'plus' })).toBe('upgrade')
  })
})
