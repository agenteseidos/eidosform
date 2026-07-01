import { describe, it, expect } from 'vitest'
import {
  resolverPlanoAtual,
  aplicarPisoMigracao,
  classificarElegibilidade,
  decidirMotivo,
  type Elegibilidade,
} from './decisao'

const futuro = new Date(Date.now() + 30 * 86400000).toISOString()
const passado = new Date(Date.now() - 86400000).toISOString()

describe('resolverPlanoAtual', () => {
  it('active + plano pago vigente → plano+ciclo', () => {
    expect(resolverPlanoAtual({ plan: 'plus', plan_status: 'active', plan_cycle: 'YEARLY', plan_expires_at: futuro }))
      .toEqual({ plano: 'plus', ciclo: 'YEARLY', indeterminado: false, cancelando: false })
  })
  it('canceling ainda vigente → plano+ciclo + flag cancelando', () => {
    expect(resolverPlanoAtual({ plan: 'starter', plan_status: 'canceling', plan_cycle: 'MONTHLY', plan_expires_at: futuro }))
      .toEqual({ plano: 'starter', ciclo: 'MONTHLY', indeterminado: false, cancelando: true })
  })
  it('active mas EXPIRADO → free e ciclo NULL (não "Grátis anual")', () => {
    expect(resolverPlanoAtual({ plan: 'plus', plan_status: 'active', plan_cycle: 'YEARLY', plan_expires_at: passado }))
      .toEqual({ plano: 'free', ciclo: null, indeterminado: false, cancelando: false })
  })
  it('canceling EXPIRADO → free, sem flag cancelando', () => {
    expect(resolverPlanoAtual({ plan: 'plus', plan_status: 'canceling', plan_cycle: 'YEARLY', plan_expires_at: passado }))
      .toEqual({ plano: 'free', ciclo: null, indeterminado: false, cancelando: false })
  })
  it('free legítimo (active) → free/null', () => {
    expect(resolverPlanoAtual({ plan: 'free', plan_status: 'active', plan_cycle: null, plan_expires_at: null }))
      .toEqual({ plano: 'free', ciclo: null, indeterminado: false, cancelando: false })
  })
  it.each(['overdue', 'cancelled', 'canceled', 'expired', 'chargeback', 'inactive', 'refunded'])(
    'status "%s" → free/null (sem plano vigente)',
    (s) => {
      expect(resolverPlanoAtual({ plan: 'plus', plan_status: s, plan_cycle: 'YEARLY', plan_expires_at: futuro }))
        .toEqual({ plano: 'free', ciclo: null, indeterminado: false, cancelando: false })
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

describe('classificarElegibilidade (janela 20d, anual vigente)', () => {
  const agora = new Date('2026-07-01T12:00:00Z')
  const diasAtras = (n: number) => new Date(agora.getTime() - n * 86400000)
  const base = { plano: 'starter' as const, ciclo: 'YEARLY' as const, cancelando: false, agora, janelaDias: 20 }

  it('anual iniciada há 5 dias → anual_recente (elegível)', () => {
    expect(classificarElegibilidade({ ...base, inicioAnual: diasAtras(5) })).toBe('anual_recente')
  })
  it('anual iniciada há exatamente 20 dias → anual_recente (inclusivo)', () => {
    expect(classificarElegibilidade({ ...base, inicioAnual: diasAtras(20) })).toBe('anual_recente')
  })
  it('anual iniciada há 21 dias → anual_antiga', () => {
    expect(classificarElegibilidade({ ...base, inicioAnual: diasAtras(21) })).toBe('anual_antiga')
  })
  it('pagante MENSAL → mensal (independe de data)', () => {
    expect(classificarElegibilidade({ ...base, ciclo: 'MONTHLY', inicioAnual: null })).toBe('mensal')
  })
  it('cancelando → cancelando (mesmo anual recente)', () => {
    expect(classificarElegibilidade({ ...base, cancelando: true, inicioAnual: diasAtras(5) })).toBe('cancelando')
  })
  it('anual sem início apurável → indeterminada (fail-closed)', () => {
    expect(classificarElegibilidade({ ...base, inicioAnual: null })).toBe('indeterminada')
  })
  it('início no futuro (dado inconsistente) → indeterminada', () => {
    expect(classificarElegibilidade({ ...base, inicioAnual: diasAtras(-3) })).toBe('indeterminada')
  })
  it('pagante sem ciclo legível → indeterminada', () => {
    expect(classificarElegibilidade({ ...base, ciclo: null, inicioAnual: null })).toBe('indeterminada')
  })
  it('free → nao_pagante', () => {
    expect(classificarElegibilidade({ ...base, plano: 'free', inicioAnual: null })).toBe('nao_pagante')
  })
  it('plano null → nao_pagante', () => {
    expect(classificarElegibilidade({ ...base, plano: null, inicioAnual: null })).toBe('nao_pagante')
  })
})

describe('decidirMotivo (matriz aprovada 2026-07-01)', () => {
  const base = {
    flags: [] as string[],
    contaNaoEncontrada: false,
    jaTemConta: false,
    planoAtual: null,
    tier: 'starter' as const,
    elegibilidade: 'nao_pagante' as Elegibilidade,
  }

  it('acima_do_limite tem precedência sobre tudo', () => {
    expect(decidirMotivo({ ...base, flags: ['acima_do_limite', 'requer_analise'] }).motivo).toBe('acima_do_limite')
  })
  it('acima_do_beneficio → requer_analise', () => {
    expect(decidirMotivo({ ...base, flags: ['acima_do_beneficio'] }).motivo).toBe('requer_analise')
  })
  it('conta não encontrada + declarou ter conta → conta_nao_encontrada', () => {
    expect(decidirMotivo({ ...base, contaNaoEncontrada: true, jaTemConta: true }).motivo).toBe('conta_nao_encontrada')
  })
  it('sem conta → assinar (recomenda o tier com piso)', () => {
    expect(decidirMotivo({ ...base, contaNaoEncontrada: true }))
      .toEqual({ motivo: 'assinar', planoRecomendado: 'starter' })
  })
  it('conta Free → upgrade pro tier da necessidade', () => {
    expect(decidirMotivo({ ...base, planoAtual: 'free', tier: 'plus' }))
      .toEqual({ motivo: 'upgrade', planoRecomendado: 'plus' })
  })
  it('pagante anual RECENTE, plano cobre → manter_plano (migra)', () => {
    expect(decidirMotivo({ ...base, planoAtual: 'plus', tier: 'starter', elegibilidade: 'anual_recente' }))
      .toEqual({ motivo: 'manter_plano', planoRecomendado: 'plus' })
  })
  it('pagante anual RECENTE, uso pede tier maior → upgrade (e migra junto)', () => {
    expect(decidirMotivo({ ...base, planoAtual: 'starter', tier: 'plus', elegibilidade: 'anual_recente' }))
      .toEqual({ motivo: 'upgrade', planoRecomendado: 'plus' })
  })
  it('pagante MENSAL → converter_anual (nunca rebaixa o plano atual)', () => {
    expect(decidirMotivo({ ...base, planoAtual: 'plus', tier: 'starter', elegibilidade: 'mensal' }))
      .toEqual({ motivo: 'converter_anual', planoRecomendado: 'plus' })
  })
  it('pagante MENSAL com uso maior → converter_anual pro tier maior', () => {
    expect(decidirMotivo({ ...base, planoAtual: 'starter', tier: 'plus', elegibilidade: 'mensal' }))
      .toEqual({ motivo: 'converter_anual', planoRecomendado: 'plus' })
  })
  it('pagante anual ANTIGA → fora_da_janela (humano avalia)', () => {
    expect(decidirMotivo({ ...base, planoAtual: 'starter', tier: 'starter', elegibilidade: 'anual_antiga' }).motivo)
      .toBe('fora_da_janela')
  })
  it('cancelando → reativar_anual (nunca rebaixa)', () => {
    expect(decidirMotivo({ ...base, planoAtual: 'plus', tier: 'starter', elegibilidade: 'cancelando' }))
      .toEqual({ motivo: 'reativar_anual', planoRecomendado: 'plus' })
  })
  it('pagante com elegibilidade indeterminada → requer_analise', () => {
    expect(decidirMotivo({ ...base, planoAtual: 'starter', tier: 'starter', elegibilidade: 'indeterminada' }).motivo)
      .toBe('requer_analise')
  })
})
