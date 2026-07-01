import { PLAN_ORDER, getEffectivePlan, planAtLeast, type PlanId } from '@/lib/plans'

/**
 * Lógica PURA de decisão do fluxo de migração (sem I/O) — extraída da route para ser
 * testável isoladamente. Cobre: resolução do plano atual a partir do status, o piso
 * comercial da recomendação e a matriz de `motivo`.
 */

const PLANOS_CONHECIDOS: ReadonlySet<string> = new Set(PLAN_ORDER)

// Status que NÃO têm plano pago vigente → tratados como free (recomenda assinar/upgrade).
// `refunded` é previsto pelo helper de billing (buildFreePlanUpdate) — incluído p/ paridade.
const STATUS_SEM_PLANO: ReadonlySet<string> = new Set([
  'overdue', 'cancelled', 'canceled', 'expired', 'chargeback', 'inactive', 'refunded',
])

/**
 * Resolve o plano EFETIVO de um profile considerando o STATUS. `getEffectivePlan` só cobre
 * plan+expiração; aqui aplicamos o status por cima SEM alterar o helper global (que faz o
 * gating do produto inteiro). Retorna `indeterminado` quando o status/plano é desconhecido
 * (não inventa plano — fail-closed → humano confere).
 */
export function resolverPlanoAtual(prof: {
  plan?: string | null
  plan_status?: string | null
  plan_cycle?: string | null
  plan_expires_at?: string | null
}): { plano: PlanId | null; ciclo: 'MONTHLY' | 'YEARLY' | null; indeterminado: boolean } {
  const status = String(prof.plan_status ?? '').trim().toLowerCase()
  const cyc = String(prof.plan_cycle ?? '').trim().toUpperCase()
  const ciclo = cyc === 'MONTHLY' || cyc === 'YEARLY' ? (cyc as 'MONTHLY' | 'YEARLY') : null
  const planoRaw = String(prof.plan ?? '').trim().toLowerCase()

  // active / canceling (ainda vigente até expirar) → plano efetivo.
  if (status === 'active' || status === 'canceling') {
    // Plano precisa ser um valor CONHECIDO — não coage silenciosamente pra free
    // (dado corrompido/legado → humano confere em vez de recomendar errado).
    if (!PLANOS_CONHECIDOS.has(planoRaw)) return { plano: null, ciclo: null, indeterminado: true }
    const plano = getEffectivePlan({ plan: planoRaw, plan_expires_at: prof.plan_expires_at })
    // Se expirou e o plano efetivo virou free, o ciclo do plano pago NÃO vale mais
    // (senão a Elen diria "sua conta está no Grátis anual").
    return { plano, ciclo: plano === 'free' ? null : ciclo, indeterminado: false }
  }

  // Sem plano ativo → free (recomenda assinar/upgrade).
  if (STATUS_SEM_PLANO.has(status)) {
    return { plano: 'free', ciclo: null, indeterminado: false }
  }

  // Status vazio/desconhecido (inclui o legado 'free', se existir) → não inventa plano.
  return { plano: null, ciclo: null, indeterminado: true }
}

/**
 * Piso comercial da migração: a recriação dos formulários feita PELA EQUIPE é benefício de
 * plano PAGO (política aprovada por Sidney). Logo a recomendação nunca fica abaixo de Starter —
 * mesmo que o volume caiba no Grátis, a Elen oferece o Starter (nunca "assine o Grátis").
 * Decisão Sidney 2026-07-01.
 */
export function aplicarPisoMigracao(tier: PlanId): PlanId {
  return planAtLeast(tier, 'starter') ? tier : 'starter'
}

export type MotivoArgs = {
  flags: Iterable<string>
  contaNaoEncontrada: boolean
  jaTemConta: boolean
  planoAtual: PlanId | null
  tier: PlanId // já com o piso aplicado
}

/**
 * Matriz de decisão do `motivo` (enum consumido pela Elen). Precedência:
 * acima_do_limite > requer_analise > conta_nao_encontrada/assinar > manter/upgrade.
 */
export function decidirMotivo(a: MotivoArgs): string {
  const flags = new Set(a.flags)
  if (flags.has('acima_do_limite')) return 'acima_do_limite'
  if (flags.has('requer_analise') || flags.has('acima_do_beneficio')) return 'requer_analise'
  if (a.contaNaoEncontrada) return a.jaTemConta ? 'conta_nao_encontrada' : 'assinar'
  if (a.planoAtual != null) return planAtLeast(a.planoAtual, a.tier) ? 'manter_plano' : 'upgrade'
  return a.jaTemConta ? 'upgrade' : 'assinar'
}
