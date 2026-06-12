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
 * Plano efetivo considerando expiração: retorna 'free' quando um plano pago
 * já passou de `plan_expires_at`. NÃO persiste nada — só resolve o valor em
 * memória. A reversão persistida (downgrade + pausa de forms) continua sendo
 * lazy em /api/user/plan-features.
 *
 * Usar isto em todo gating (player público, /api/responses, etc.) para que um
 * webhook Asaas perdido não deixe o usuário com features pagas indefinidamente.
 */
export function getEffectivePlan(
  profile: { plan?: string | null; plan_expires_at?: string | null } | null | undefined
): PlanId {
  const plan = normalizePlan(profile?.plan)
  if (plan === 'free') return 'free'
  const expiresAt = profile?.plan_expires_at
  if (expiresAt) {
    const exp = new Date(expiresAt).getTime()
    if (!Number.isNaN(exp) && Date.now() > exp) return 'free'
  }
  return plan
}
