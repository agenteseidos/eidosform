/**
 * lib/plan-limits.ts — Sistema de limites por plano
 * Sprint Dia 4-5 — EidosForm
 */

import { createClient } from '@/lib/supabase/server'
import { sendLimitAlert } from '@/lib/resend'

export type PlanName = 'free' | 'starter' | 'plus' | 'professional'

export interface PlanLimits {
  maxResponses: number       // -1 = unlimited
  maxForms: number           // -1 = unlimited
  watermark: boolean
  pixels: boolean            // FB Pixel, GTM etc.
  customDomain: boolean
  apiAccess: boolean
  maxUsers: number
}

export const PLAN_LIMITS: Record<PlanName, PlanLimits> = {
  free: {
    maxResponses: 100,
    maxForms: 3,
    watermark: true,
    pixels: false,
    customDomain: false,
    apiAccess: false,
    maxUsers: 1,
  },
  starter: {
    maxResponses: 1000,
    maxForms: 10,
    watermark: true,
    pixels: false,
    customDomain: false,
    apiAccess: false,
    maxUsers: 1,
  },
  plus: {
    maxResponses: 5000,
    maxForms: -1,
    watermark: false,
    pixels: true,
    customDomain: false,
    apiAccess: false,
    maxUsers: 1,
  },
  professional: {
    maxResponses: 15000,
    maxForms: -1,
    watermark: false,
    pixels: true,
    customDomain: true,
    apiAccess: true,
    maxUsers: 10,
  },
}

export function getPlanLimits(plan: PlanName): PlanLimits {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.free
}

/**
 * Checa se o usuário pode aceitar mais uma resposta.
 * Retorna { allowed, usage, limit }
 */
export async function checkResponseLimit(userId: string): Promise<{
  allowed: boolean
  usage: number
  limit: number
  plan: PlanName
  nearLimit: boolean
}> {
  const supabase = await createClient()

  // Busca perfil do usuário
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('plan, response_count, limit_alert_sent')
    .eq('id', userId)
    .single()

  if (error || !profile) {
    // Fallback: negar por segurança
    return { allowed: false, usage: 0, limit: 0, plan: 'free', nearLimit: false }
  }

  const plan = (profile.plan ?? 'free') as PlanName
  const limits = getPlanLimits(plan)
  const usage = profile.response_count ?? 0
  const limit = limits.maxResponses

  // Unlimited
  if (limit === -1) {
    return { allowed: true, usage, limit, plan, nearLimit: false }
  }

  const allowed = usage < limit
  const nearLimit = !profile.limit_alert_sent && usage >= Math.floor(limit * 0.8)

  // Se atingiu 80%, marca flag e envia alerta
  if (nearLimit) {
    await supabase
      .from('profiles')
      .update({ limit_alert_sent: true })
      .eq('id', userId)

    // Busca email do usuário para notificação
    const { data: userData } = await supabase
      .from('profiles')
      .select('email, full_name')
      .eq('id', userId)
      .single()

    if (userData?.email) {
      await sendLimitAlert({
        to: userData.email,
        name: userData.full_name ?? 'usuário',
        usage,
        limit,
        plan,
      }).catch(console.error) // não bloqueia o fluxo
    }
  }

  return { allowed, usage, limit, plan, nearLimit }
}

/**
 * Incrementa contador de respostas do usuário
 */
export async function incrementResponseCount(userId: string): Promise<void> {
  const supabase = await createClient()
  await supabase.rpc('increment_response_count', { user_id: userId })
}

/**
 * Verifica se usuário pode criar mais um form
 */
export async function checkFormLimit(userId: string): Promise<{ allowed: boolean; usage: number; limit: number }> {
  const supabase = await createClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', userId)
    .single()

  const plan = (profile?.plan ?? 'free') as PlanName
  const limits = getPlanLimits(plan)

  if (limits.maxForms === -1) return { allowed: true, usage: 0, limit: -1 }

  const { count } = await supabase
    .from('forms')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)

  const usage = count ?? 0
  return { allowed: usage < limits.maxForms, usage, limit: limits.maxForms }
}
