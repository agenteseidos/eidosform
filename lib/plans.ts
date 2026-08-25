export const PLAN_ORDER = ['free', 'starter', 'plus', 'professional'] as const

export type PlanId = (typeof PLAN_ORDER)[number]

export function normalizePlan(plan?: string | null): PlanId {
  const normalized = plan?.trim().toLowerCase()
  if (normalized && (PLAN_ORDER as readonly string[]).includes(normalized)) {
    return normalized as PlanId
  }
  return 'free'
}

/**
 * Compara planos pela hierarquia free < starter < plus < professional.
 * `planAtLeast('starter', 'starter')` → true; `planAtLeast('free', 'starter')` → false.
 * Usar em todo gating por nível de plano (tipos de pergunta, etc.).
 */
export function planAtLeast(plan: string | null | undefined, minimum: PlanId): boolean {
  return PLAN_ORDER.indexOf(normalizePlan(plan)) >= PLAN_ORDER.indexOf(minimum)
}

/**
 * Carência de inadimplência, em dias — FONTE ÚNICA do número.
 *
 * `PRAZO_DIAS` (régua de cobrança) e `OVERDUE_GRACE_DAYS` (rebaixamento) derivam daqui. Eram
 * três literais independentes; o teste que dizia guardar o alinhamento só olhava um deles.
 * Este módulo é folha (zero imports) de propósito — pode ser importado de qualquer lugar.
 */
export const CARENCIA_INADIMPLENCIA_DIAS = 5

/** Perfil, do ponto de vista de quem só quer saber qual plano vale AGORA. */
export type PerfilParaPlanoEfetivo = {
  plan?: string | null
  plan_expires_at?: string | null
  /** 'active' | 'canceling' | 'cancelled' | 'expired' … Ausente ⇒ sem carência (conservador). */
  plan_status?: string | null
  /** Assinatura viva no gateway. Ausente ⇒ sem carência (conservador). */
  asaas_subscription_id?: string | null
}

/**
 * Meia-noite BRT do dia em que a carência termina.
 *
 * `plan_expires_at` é FIM de dia BRT (23:59:59). O rebaixamento, por sua vez, conta dias
 * inteiros a partir da MEIA-NOITE do vencimento. Sem alinhar as duas âncoras, a carência aqui
 * duraria ~24h a mais que a do `expire-plans` — e essa diferença só aparece quando o cron
 * falha, ou seja, exatamente na hora errada.
 */
function fimDaCarencia(expiraEmMs: number): number {
  const diaBRT = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(expiraEmMs)) // 'YYYY-MM-DD'
  return Date.parse(`${diaBRT}T00:00:00-03:00`) + CARENCIA_INADIMPLENCIA_DIAS * 86_400_000
}

/**
 * O plano que vale AGORA. NÃO persiste nada — só resolve o valor em memória.
 *
 * ⚠️ CARÊNCIA (decisão do Sidney, 25/08/2026). Até esta data havia SPLIT-BRAIN: o
 * `/api/user/plan-features` honrava os 5 dias de carência (mostrava "Plus, 5.000") enquanto
 * esta função — usada em ~20 rotas, no formulário público e na cota — devolvia 'free' no
 * segundo seguinte ao vencimento. O cliente inadimplente via no painel um plano que o produto
 * já não entregava, e a régua de cobrança prometia um prazo que nenhum portão respeitava.
 * Decisão: **a carência vale de verdade** — durante os 5 dias o cliente mantém tudo.
 *
 * Duas guardas que impedem isso de virar acesso pago de graça:
 *  1. PRAZO DURO. A carência expira sozinha, por cálculo. Se o `expire-plans` nunca rodar, o
 *     benefício acaba na mesma hora — a falha do cron não vira acesso vitalício.
 *  2. SÓ INADIMPLENTE. Exige assinatura viva (`asaas_subscription_id`) e `plan_status='active'`.
 *     Quem CANCELA fica 'canceling' e NÃO ganha os 5 dias: usa o que pagou e cai no free no dia
 *     seguinte (decisão do Sidney, 25/08). Campo ausente ⇒ sem carência, nunca o contrário:
 *     chamador que não selecionou os campos se comporta como antes desta mudança.
 */
export function getEffectivePlan(
  profile: PerfilParaPlanoEfetivo | null | undefined,
  agora: number = Date.now()
): PlanId {
  const plan = normalizePlan(profile?.plan)
  if (plan === 'free') return 'free'
  const expiresAt = profile?.plan_expires_at
  if (!expiresAt) return plan
  const exp = new Date(expiresAt).getTime()
  if (Number.isNaN(exp) || agora <= exp) return plan

  // Passou da expiração. A carência de INADIMPLÊNCIA ainda pode segurar o plano.
  const inadimplenteComAssinaturaViva =
    profile?.plan_status === 'active' && Boolean(profile?.asaas_subscription_id)
  if (inadimplenteComAssinaturaViva && agora < fimDaCarencia(exp)) return plan

  return 'free'
}
