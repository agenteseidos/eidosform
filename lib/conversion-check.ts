import { resolverPlanoAtual } from '@/lib/migracao/decisao'
import { PLAN_ORDER, planAtLeast, type PlanId } from '@/lib/plans'

export type ConversionDecision = 'converted' | 'not_converted' | 'unknown'
export type ConversionCycle = 'MONTHLY' | 'YEARLY' | null

export type ConversionTarget = {
  type: 'plan_at_least'
  plan: PlanId
  cycle: ConversionCycle
}

export type ConversionProfile = {
  id: string
  plan: string | null
  plan_status: string | null
  plan_cycle: string | null
  plan_expires_at: string | null
}

export function parseConversionTarget(raw: unknown): ConversionTarget | null {
  if (!raw || typeof raw !== 'object') return null
  const target = raw as Record<string, unknown>
  if (target.type !== 'plan_at_least') return null
  const plan = String(target.plan ?? '').trim().toLowerCase()
  if (!(PLAN_ORDER as readonly string[]).includes(plan)) return null
  const cycleRaw = target.cycle == null ? null : String(target.cycle).trim().toUpperCase()
  if (cycleRaw !== null && cycleRaw !== 'MONTHLY' && cycleRaw !== 'YEARLY') return null
  return { type: 'plan_at_least', plan: plan as PlanId, cycle: cycleRaw as ConversionCycle }
}

function avaliarProfile(profile: ConversionProfile, target: ConversionTarget): ConversionDecision {
  const status = String(profile.plan_status ?? '').trim().toLowerCase()
  // Cobrança problemática/encerrada pede fluxo próprio. O follow-up comercial
  // genérico falha fechado, mesmo que resolverPlanoAtual() a reduzisse a free.
  if (status !== 'active' && status !== 'canceling') return 'unknown'

  const resolvido = resolverPlanoAtual(profile)
  if (resolvido.indeterminado || !resolvido.plano) return 'unknown'

  // Um plano pago expirado entre webhooks vira free efetivo. Não o confundir com
  // uma conta realmente free: há histórico de compra e a decisão é conservadora.
  const planoPersistido = String(profile.plan ?? '').trim().toLowerCase()
  if (planoPersistido !== 'free' && resolvido.plano === 'free') return 'unknown'
  if (!planAtLeast(resolvido.plano, target.plan)) return 'not_converted'
  if (target.cycle && !resolvido.ciclo) return 'unknown'
  if (target.cycle && resolvido.ciclo !== target.cycle) return 'not_converted'
  return 'converted'
}

export function decidirConversao(
  profiles: ConversionProfile[],
  target: ConversionTarget,
): ConversionDecision {
  if (!profiles.length) return 'not_converted'
  const decisoes = profiles.map((profile) => avaliarProfile(profile, target))
  if (decisoes.includes('converted')) return 'converted'
  // Telefone compartilhado/duplicado sem conversão conclusiva nunca autoriza envio.
  if (profiles.length > 1) return 'unknown'
  return decisoes[0] ?? 'unknown'
}
