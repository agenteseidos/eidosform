/**
 * Testes da trava de escopo de lançamento (BILLING_MVP_ONLY) + composição com o plano
 * EFETIVO (P2-b, audit 2026-06-09): plano pago expirado conta como free → recompra liberada.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

import { getEffectivePlan } from './plans'

async function load(env: Record<string, string> = {}) {
  vi.resetModules()
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
  return import('./billing-launch-guard')
}

describe('checkLaunchScope (BILLING_MVP_ONLY)', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('default (flag ON): free → starter mensal é permitido', async () => {
    const { checkLaunchScope } = await load()
    expect(checkLaunchScope({ currentPlan: 'free', targetPlan: 'starter', cycle: 'MONTHLY' })).toBeNull()
  })

  it('pagante vigente não muda de plano → 409 PLAN_CHANGE_DISABLED', async () => {
    const { checkLaunchScope } = await load()
    const block = checkLaunchScope({ currentPlan: 'starter', targetPlan: 'plus', cycle: 'MONTHLY' })
    expect(block?.status).toBe(409)
    expect(block?.body.code).toBe('PLAN_CHANGE_DISABLED')
  })

  it('ciclo anual bloqueado no MVP → CYCLE_NOT_AVAILABLE_YET', async () => {
    const { checkLaunchScope } = await load()
    const block = checkLaunchScope({ currentPlan: 'free', targetPlan: 'starter', cycle: 'YEARLY' })
    expect(block?.body.code).toBe('CYCLE_NOT_AVAILABLE_YET')
  })

  it('plano fora de BILLING_ALLOWED_PLANS → PLAN_NOT_AVAILABLE_YET', async () => {
    const { checkLaunchScope } = await load()
    const block = checkLaunchScope({ currentPlan: 'free', targetPlan: 'plus', cycle: 'MONTHLY' })
    expect(block?.body.code).toBe('PLAN_NOT_AVAILABLE_YET')
  })

  it('BILLING_MVP_ONLY=false libera tudo', async () => {
    const { checkLaunchScope } = await load({ BILLING_MVP_ONLY: 'false' })
    expect(checkLaunchScope({ currentPlan: 'starter', targetPlan: 'plus', cycle: 'YEARLY' })).toBeNull()
  })

  // ── P2-b: o call-site (POST/preview) passa o plano EFETIVO, não o cru ──

  it('pagante EXPIRADO conta como free → recompra do starter mensal liberada (P2-b)', async () => {
    const { checkLaunchScope } = await load()
    const effective = getEffectivePlan({ plan: 'starter', plan_expires_at: '2020-01-01T00:00:00Z' })
    expect(effective).toBe('free') // pré-fix: o call-site passava 'starter' cru → 409
    expect(checkLaunchScope({ currentPlan: effective, targetPlan: 'starter', cycle: 'MONTHLY' })).toBeNull()
  })

  it('pagante VIGENTE segue bloqueado mesmo via plano efetivo', async () => {
    const { checkLaunchScope } = await load()
    const effective = getEffectivePlan({ plan: 'starter', plan_expires_at: '2099-01-01T00:00:00Z' })
    expect(effective).toBe('starter')
    expect(checkLaunchScope({ currentPlan: effective, targetPlan: 'plus', cycle: 'MONTHLY' })?.body.code).toBe('PLAN_CHANGE_DISABLED')
  })
})
