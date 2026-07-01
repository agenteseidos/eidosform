import { PLAN_ORDER, getEffectivePlan, planAtLeast, type PlanId } from '@/lib/plans'

/**
 * Lógica PURA de decisão do fluxo de migração (sem I/O) — extraída da route para ser
 * testável isoladamente. Cobre: resolução do plano atual a partir do status, o piso
 * comercial da recomendação, a elegibilidade do benefício e a matriz de `motivo`.
 *
 * POLÍTICA (Sidney, 2026-07-01): a recriação de formulários feita PELA EQUIPE é benefício
 * de boas-vindas de quem tem assinatura **ANUAL vigente iniciada há ≤ N dias** (default 20).
 * Fora disso a Elen recomenda o caminho (assinar anual / converter ciclo / reativar) — não
 * promete a migração feita-por-nós.
 */

const PLANOS_CONHECIDOS: ReadonlySet<string> = new Set(PLAN_ORDER)

// Status que NÃO têm plano pago vigente → tratados como free (recomenda assinar/upgrade).
// `refunded` é previsto pelo helper de billing (buildFreePlanUpdate) — incluído p/ paridade.
const STATUS_SEM_PLANO: ReadonlySet<string> = new Set([
  'overdue', 'cancelled', 'canceled', 'expired', 'chargeback', 'inactive', 'refunded',
])

const tierIndex = (p: PlanId): number => PLAN_ORDER.indexOf(p)
function maiorTier(a: PlanId, b: PlanId): PlanId {
  return tierIndex(a) >= tierIndex(b) ? a : b
}

/**
 * Resolve o plano EFETIVO de um profile considerando o STATUS. `getEffectivePlan` só cobre
 * plan+expiração; aqui aplicamos o status por cima SEM alterar o helper global (que faz o
 * gating do produto inteiro). Retorna `indeterminado` quando o status/plano é desconhecido
 * (não inventa plano — fail-closed → humano confere). `cancelando` marca plan_status
 * 'canceling' (plano ainda vigente, mas NÃO elegível pro benefício da migração).
 */
export function resolverPlanoAtual(prof: {
  plan?: string | null
  plan_status?: string | null
  plan_cycle?: string | null
  plan_expires_at?: string | null
}): {
  plano: PlanId | null
  ciclo: 'MONTHLY' | 'YEARLY' | null
  indeterminado: boolean
  cancelando: boolean
} {
  const status = String(prof.plan_status ?? '').trim().toLowerCase()
  const cyc = String(prof.plan_cycle ?? '').trim().toUpperCase()
  const ciclo = cyc === 'MONTHLY' || cyc === 'YEARLY' ? (cyc as 'MONTHLY' | 'YEARLY') : null
  const planoRaw = String(prof.plan ?? '').trim().toLowerCase()

  // active / canceling (ainda vigente até expirar) → plano efetivo.
  if (status === 'active' || status === 'canceling') {
    // Plano precisa ser um valor CONHECIDO — não coage silenciosamente pra free
    // (dado corrompido/legado → humano confere em vez de recomendar errado).
    if (!PLANOS_CONHECIDOS.has(planoRaw)) return { plano: null, ciclo: null, indeterminado: true, cancelando: false }
    const plano = getEffectivePlan({ plan: planoRaw, plan_expires_at: prof.plan_expires_at })
    // Se expirou e o plano efetivo virou free, o ciclo do plano pago NÃO vale mais
    // (senão a Elen diria "sua conta está no Grátis anual").
    return {
      plano,
      ciclo: plano === 'free' ? null : ciclo,
      indeterminado: false,
      cancelando: status === 'canceling' && plano !== 'free',
    }
  }

  // Sem plano ativo → free (recomenda assinar/upgrade).
  if (STATUS_SEM_PLANO.has(status)) {
    return { plano: 'free', ciclo: null, indeterminado: false, cancelando: false }
  }

  // Status vazio/desconhecido (inclui o legado 'free', se existir) → não inventa plano.
  return { plano: null, ciclo: null, indeterminado: true, cancelando: false }
}

/**
 * Piso comercial da recomendação: a migração feita pela equipe é benefício de plano PAGO →
 * a recomendação nunca fica abaixo de Starter (nunca "assine o Grátis").
 * Decisão Sidney 2026-07-01.
 */
export function aplicarPisoMigracao(tier: PlanId): PlanId {
  return planAtLeast(tier, 'starter') ? tier : 'starter'
}

/**
 * Elegibilidade da conta PAGANTE pro benefício da migração feita-pela-equipe:
 * - `anual_recente`  — assinatura anual vigente iniciada ≤ janela → ELEGÍVEL.
 * - `anual_antiga`   — anual vigente, mas fora da janela → humano avalia caso a caso.
 * - `mensal`         — pagante mensal → convite pra converter pro anual.
 * - `cancelando`     — pediu cancelamento → convite pra reativar no anual.
 * - `indeterminada`  — não deu pra apurar o início (sem checkout pago rastreável) → humano.
 * - `nao_pagante`    — free/expirado (elegibilidade não se aplica; recomenda assinar/upgrade).
 */
export type Elegibilidade =
  | 'anual_recente'
  | 'anual_antiga'
  | 'mensal'
  | 'cancelando'
  | 'indeterminada'
  | 'nao_pagante'

/**
 * Classifica a elegibilidade a partir do plano resolvido + a data de INÍCIO da assinatura
 * anual vigente (apurada pelo checkout pago mais recente de ciclo YEARLY — I/O fica na route).
 */
export function classificarElegibilidade(args: {
  plano: PlanId | null
  ciclo: 'MONTHLY' | 'YEARLY' | null
  cancelando: boolean
  inicioAnual: Date | null // null = não foi possível apurar
  agora: Date
  janelaDias: number
}): Elegibilidade {
  const { plano, ciclo, cancelando, inicioAnual, agora, janelaDias } = args
  if (!plano || plano === 'free') return 'nao_pagante'
  if (cancelando) return 'cancelando'
  if (ciclo === 'MONTHLY') return 'mensal'
  if (ciclo !== 'YEARLY') return 'indeterminada' // pagante sem ciclo legível → não arrisca
  if (!inicioAnual || Number.isNaN(inicioAnual.getTime())) return 'indeterminada'
  const idadeDias = (agora.getTime() - inicioAnual.getTime()) / 86400000
  if (idadeDias < 0) return 'indeterminada' // data no futuro = dado inconsistente
  return idadeDias <= janelaDias ? 'anual_recente' : 'anual_antiga'
}

export type MotivoArgs = {
  flags: Iterable<string>
  contaNaoEncontrada: boolean
  jaTemConta: boolean
  planoAtual: PlanId | null
  tier: PlanId // já com o piso aplicado
  elegibilidade: Elegibilidade
}

/**
 * Matriz de decisão do `motivo` (enum consumido pela Elen) + plano a recomendar.
 * Precedência: acima_do_limite > requer_analise > conta/assinar > elegibilidade > manter/upgrade.
 * Em `converter_anual`/`reativar_anual` o plano recomendado nunca REBAIXA o atual
 * (max(tier, planoAtual) — a conversa é sobre ciclo/reativação, não downgrade).
 */
export function decidirMotivo(a: MotivoArgs): { motivo: string; planoRecomendado: PlanId } {
  const flags = new Set(a.flags)
  const recomendadoBase = a.planoAtual ? maiorTier(a.tier, a.planoAtual) : a.tier

  if (flags.has('acima_do_limite')) return { motivo: 'acima_do_limite', planoRecomendado: a.tier }
  if (flags.has('requer_analise') || flags.has('acima_do_beneficio')) {
    return { motivo: 'requer_analise', planoRecomendado: a.tier }
  }
  if (a.contaNaoEncontrada) {
    return { motivo: a.jaTemConta ? 'conta_nao_encontrada' : 'assinar', planoRecomendado: a.tier }
  }
  if (a.planoAtual == null) {
    // Defensivo (a route trata indeterminado via flag antes de chegar aqui).
    return { motivo: a.jaTemConta ? 'upgrade' : 'assinar', planoRecomendado: a.tier }
  }
  if (a.planoAtual === 'free') return { motivo: 'upgrade', planoRecomendado: a.tier }

  // Pagante: aplica a política de elegibilidade.
  switch (a.elegibilidade) {
    case 'cancelando':
      return { motivo: 'reativar_anual', planoRecomendado: recomendadoBase }
    case 'mensal':
      return { motivo: 'converter_anual', planoRecomendado: recomendadoBase }
    case 'anual_antiga':
      return { motivo: 'fora_da_janela', planoRecomendado: recomendadoBase }
    case 'indeterminada':
      return { motivo: 'requer_analise', planoRecomendado: a.tier }
    case 'anual_recente':
      return planAtLeast(a.planoAtual, a.tier)
        ? { motivo: 'manter_plano', planoRecomendado: a.planoAtual }
        : { motivo: 'upgrade', planoRecomendado: a.tier }
    default:
      // 'nao_pagante' com plano pago = inconsistência → humano.
      return { motivo: 'requer_analise', planoRecomendado: a.tier }
  }
}
