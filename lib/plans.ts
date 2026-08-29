export const PLAN_ORDER = ['free', 'starter', 'plus', 'professional'] as const

export type PlanId = (typeof PLAN_ORDER)[number]

/**
 * PLAN_ORDER é a ordem COMERCIAL: o que aparece na grade, o que pode ser comprado
 * e a hierarquia de recursos. `trial` NÃO entra aqui de propósito — se entrasse,
 * `/checkout/trial` viraria rota válida (as rotas derivam desta lista) e a hierarquia
 * free < trial < starter diria que o trial tem MENOS recursos que o Starter, o oposto
 * do que ele entrega. (Decisão 28/08/2026, spec v12 §2.)
 */

/** Planos que uma CONTA pode ter, incluindo os que não estão à venda. */
export const ACCOUNT_PLANS = [...PLAN_ORDER, 'trial'] as const
export type AccountPlanId = (typeof ACCOUNT_PLANS)[number]

/** Planos que podem ser COMPRADOS (têm preço). Nunca inclui free nem trial. */
export type BillablePlanId = Exclude<PlanId, 'free'>
export const BILLABLE_PLANS: readonly BillablePlanId[] = ['starter', 'plus', 'professional'] as const

export function isBillablePlan(plan?: string | null): plan is BillablePlanId {
  const n = plan?.trim().toLowerCase()
  return !!n && (BILLABLE_PLANS as readonly string[]).includes(n)
}

/** Normaliza para um plano de CONTA (preserva 'trial'). Desconhecido → 'free'. */
export function normalizeAccountPlan(plan?: string | null): AccountPlanId {
  const normalized = plan?.trim().toLowerCase()
  if (normalized && (ACCOUNT_PLANS as readonly string[]).includes(normalized)) {
    return normalized as AccountPlanId
  }
  return 'free'
}

/**
 * Traduz o plano da CONTA para o plano de DIREITOS (o que a pessoa pode usar).
 * O trial entrega exatamente o Plus. Todo portão de produto deve comparar por aqui;
 * quem decide dinheiro (checkout, proração, NFS-e, dunning, conversão) usa o plano
 * da conta cru, nunca este.
 */
export function entitlementPlan(plan: AccountPlanId | string | null | undefined): PlanId {
  const p = normalizeAccountPlan(plan)
  return p === 'trial' ? 'plus' : p
}

export function isTrialPlan(plan?: string | null): boolean {
  return normalizeAccountPlan(plan) === 'trial'
}

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
export function fimDaCarencia(expiraEmMs: number): number {
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
/**
 * Último instante em que a carência ainda segura o plano — `null` quando não há carência
 * (plano free, sem expiração, ainda não venceu, cancelou, ou sem assinatura viva).
 *
 * Existe para quem precisa DIZER o prazo, não só decidir o acesso: a ficha da Elen usa isto
 * para responder "você tem até tal dia para regularizar" em vez de um "expirado" seco.
 */
export function fimDaCarenciaDe(profile: PerfilParaPlanoEfetivo | null | undefined): number | null {
  if (normalizePlan(profile?.plan) === 'free') return null
  const expiresAt = profile?.plan_expires_at
  if (!expiresAt) return null
  const exp = new Date(expiresAt).getTime()
  if (Number.isNaN(exp)) return null
  if (!(profile?.plan_status === 'active' && profile?.asaas_subscription_id)) return null
  return fimDaCarencia(exp)
}

export function getEffectiveAccountPlan(
  profile: PerfilParaPlanoEfetivo | null | undefined,
  agora: number = Date.now()
): AccountPlanId {
  const plan = normalizeAccountPlan(profile?.plan)
  if (plan === 'free') return 'free'
  const expiresAt = profile?.plan_expires_at
  if (!expiresAt) return plan
  const exp = new Date(expiresAt).getTime()
  if (Number.isNaN(exp) || agora <= exp) return plan

  // Passou da expiração. A carência de INADIMPLÊNCIA ainda pode segurar o plano.
  // O trial NUNCA tem carência: ele não tem assinatura, então cai aqui direto.
  const inadimplenteComAssinaturaViva =
    profile?.plan_status === 'active' && Boolean(profile?.asaas_subscription_id)
  if (inadimplenteComAssinaturaViva && agora < fimDaCarencia(exp)) return plan

  return 'free'
}

/**
 * Plano COMERCIAL efetivo — o que vale para CHECKOUT e PREÇOS.
 * Trial não é plano pago: para comprar, quem está em trial é tratado como conta nova
 * (primeira compra, preço cheio, crédito zero). Sem isto, o trial seria lido como
 * "pagante Plus" pelo launch guard e como "cancelado com saldo" pela proração.
 */
export function getEffectiveCommercialPlan(
  profile: PerfilParaPlanoEfetivo | null | undefined,
  agora: number = Date.now()
): PlanId {
  const p = getEffectiveAccountPlan(profile, agora)
  return p === 'trial' ? 'free' : p
}

/**
 * Plano EFETIVO DE DIREITOS — é o que todo portão de produto deve usar.
 * Devolve o plano comercial equivalente: uma conta em `trial` responde 'plus'.
 * Para saber a IDENTIDADE da conta (é trial? é pagante?), use
 * `getEffectiveAccountPlan`, que preserva 'trial'.
 */
export function getEffectivePlan(
  profile: PerfilParaPlanoEfetivo | null | undefined,
  agora: number = Date.now()
): PlanId {
  return entitlementPlan(getEffectiveAccountPlan(profile, agora))
}
