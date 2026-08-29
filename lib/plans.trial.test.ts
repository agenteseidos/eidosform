/**
 * Plano `trial` — o que ele É e o que ele NÃO é.
 *
 * Regra: trial tem IDENTIDADE própria na conta (aparece como trial, não é pagante)
 * e ENTITLEMENT de Plus (usa tudo que o Plus usa). Os dois nunca se misturam:
 * portão de produto pergunta o entitlement; checkout e cobrança perguntam a identidade.
 */
import { describe, it, expect } from 'vitest'
import {
  PLAN_ORDER, ACCOUNT_PLANS, BILLABLE_PLANS,
  normalizeAccountPlan, entitlementPlan, isTrialPlan, isBillablePlan,
  getEffectivePlan, getEffectiveAccountPlan, getEffectiveCommercialPlan,
  planAtLeast, CARENCIA_INADIMPLENCIA_DIAS,
} from './plans'

const AGORA = Date.parse('2026-09-10T12:00:00-03:00')
const emUmDia = new Date(AGORA + 86_400_000).toISOString()
const ontem  = new Date(AGORA - 86_400_000).toISOString()

describe('trial fora da hierarquia comercial', () => {
  it('PLAN_ORDER não contém trial — é o que impede /checkout/trial de existir', () => {
    expect(PLAN_ORDER).toEqual(['free', 'starter', 'plus', 'professional'])
    expect(PLAN_ORDER as readonly string[]).not.toContain('trial')
  })

  it('trial não é comprável', () => {
    expect(BILLABLE_PLANS as readonly string[]).not.toContain('trial')
    expect(BILLABLE_PLANS as readonly string[]).not.toContain('free')
    expect(isBillablePlan('trial')).toBe(false)
  })

  it('mas é um plano válido de CONTA', () => {
    expect(ACCOUNT_PLANS as readonly string[]).toContain('trial')
    expect(normalizeAccountPlan('trial')).toBe('trial')
    expect(normalizeAccountPlan('TRIAL ')).toBe('trial')
    expect(isTrialPlan('trial')).toBe(true)
  })

  it('valor desconhecido continua caindo em free', () => {
    expect(normalizeAccountPlan('enterprise')).toBe('free')
    expect(normalizeAccountPlan(null)).toBe('free')
  })
})

describe('entitlement: trial vale Plus em todo portão', () => {
  it('entitlementPlan traduz trial para plus e não mexe no resto', () => {
    expect(entitlementPlan('trial')).toBe('plus')
    expect(entitlementPlan('free')).toBe('free')
    expect(entitlementPlan('starter')).toBe('starter')
    expect(entitlementPlan('professional')).toBe('professional')
  })

  it('passa nos portões de Starter e Plus, e NÃO nos de Professional', () => {
    const e = entitlementPlan('trial')
    expect(planAtLeast(e, 'starter')).toBe(true)       // CPF/CNPJ, Calendly, Sheets
    expect(planAtLeast(e, 'plus')).toBe(true)          // pixels, CAPI, webhooks, bloco HTML
    expect(planAtLeast(e, 'professional')).toBe(false) // api-key e domínio próprio seguem Pro
  })

  it('trial cru NÃO passa em portão nenhum — o erro que o entitlement existe para evitar', () => {
    // planAtLeast usa a hierarquia comercial; 'trial' não está lá e vira free.
    expect(planAtLeast('trial', 'plus')).toBe(false)
  })
})

describe('getEffectivePlan (direitos) x getEffectiveAccountPlan (identidade)', () => {
  const trialVivo   = { plan: 'trial', plan_expires_at: emUmDia, plan_status: 'active', asaas_subscription_id: null }
  const trialVencido = { plan: 'trial', plan_expires_at: ontem,  plan_status: 'active', asaas_subscription_id: null }

  it('trial vigente: direitos de Plus, identidade de trial', () => {
    expect(getEffectivePlan(trialVivo, AGORA)).toBe('plus')
    expect(getEffectiveAccountPlan(trialVivo, AGORA)).toBe('trial')
  })

  it('trial vencido vira free NA HORA, sem carência (não tem assinatura)', () => {
    expect(getEffectivePlan(trialVencido, AGORA)).toBe('free')
    expect(getEffectiveAccountPlan(trialVencido, AGORA)).toBe('free')
  })

  it('a carência de inadimplência NÃO alcança o trial nem com plan_status active', () => {
    const dentroDaCarencia = AGORA + (CARENCIA_INADIMPLENCIA_DIAS - 1) * 86_400_000
    // pagante inadimplente com assinatura viva: segurado pela carência
    const pagante = { plan: 'plus', plan_expires_at: ontem, plan_status: 'active', asaas_subscription_id: 'sub_1' }
    expect(getEffectivePlan(pagante, dentroDaCarencia - 86_400_000)).toBe('plus')
    // trial na mesma situação: cai, porque não há assinatura
    expect(getEffectivePlan(trialVencido, dentroDaCarencia - 86_400_000)).toBe('free')
  })

  it('plano pago segue igual (nenhuma regressão)', () => {
    const plus = { plan: 'plus', plan_expires_at: emUmDia, plan_status: 'active', asaas_subscription_id: 'sub_1' }
    expect(getEffectivePlan(plus, AGORA)).toBe('plus')
    expect(getEffectiveAccountPlan(plus, AGORA)).toBe('plus')
  })
})

describe('checkout: quem está em trial compra como conta nova', () => {
  it('plano COMERCIAL efetivo de um trial vigente é free', () => {
    const trialVivo = { plan: 'trial', plan_expires_at: emUmDia, plan_status: 'active', asaas_subscription_id: null }
    // é o que faz o launch guard tratar como primeira compra e a proração não dar crédito
    expect(getEffectiveCommercialPlan(trialVivo, AGORA)).toBe('free')
    // enquanto os direitos seguem valendo Plus até o último dia
    expect(getEffectivePlan(trialVivo, AGORA)).toBe('plus')
  })

  it('não confunde com pagante: Plus vigente continua Plus no comercial', () => {
    const plus = { plan: 'plus', plan_expires_at: emUmDia, plan_status: 'active', asaas_subscription_id: 'sub_1' }
    expect(getEffectiveCommercialPlan(plus, AGORA)).toBe('plus')
  })
})
