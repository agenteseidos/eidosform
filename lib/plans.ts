export const PLAN_ORDER = ['free', 'starter', 'plus', 'professional'] as const

export type PlanId = (typeof PLAN_ORDER)[number]

export function normalizePlan(plan?: string | null): PlanId {
  const normalized = plan?.trim().toLowerCase()
  if (normalized && (PLAN_ORDER as readonly string[]).includes(normalized)) {
    return normalized as PlanId
  }
  return 'free'
}
