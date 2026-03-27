/**
 * lib/plan-limits.ts — Sistema de limites por plano
 * Single source of truth for plan pricing, features, and limits.
 */

import { createClient } from '@/lib/supabase/server'
import { createPublicClient } from '@/lib/supabase/public'
import { sendLimitAlert } from '@/lib/resend'

export type PlanName = 'free' | 'starter' | 'plus' | 'professional'

export interface PlanConfig {
  name: string
  popular?: boolean
  monthlyPrice: number
  yearlyPrice: number
  maxResponses: number   // -1 = unlimited
  maxForms: number       // -1 = unlimited
  maxUsers: number
  watermark: boolean
  pixels: boolean
  customDomain: boolean
  apiAccess: boolean
  partialResponses: boolean
  csvExport: boolean
  webhooks: boolean
  redirect: boolean
  emailNotifications: boolean
  prioritySupport: boolean
  features: string[]
}

export const PLANS: Record<PlanName, PlanConfig> = {
  free: {
    name: 'Free',
    monthlyPrice: 0,
    yearlyPrice: 0,
    maxResponses: 100,
    maxForms: 3,
    maxUsers: 1,
    watermark: true,
    pixels: false,
    customDomain: false,
    apiAccess: false,
    partialResponses: false,
    csvExport: false,
    webhooks: false,
    redirect: false,
    emailNotifications: false,
    prioritySupport: false,
    features: [
      '100 respostas/mês',
      '3 formulários',
      'Questões ilimitadas',
      '1 usuário',
      'Validação CPF/CNPJ',
      'Busca automática de CEP',
      'Lógica condicional',
      'Tela de agradecimento',
      'Suporte por email',
      "Marca d'água EidosForm",
    ],
  },
  starter: {
    name: 'Starter',
    monthlyPrice: 49,
    yearlyPrice: 29,
    maxResponses: 1000,
    maxForms: 10,
    maxUsers: 1,
    watermark: true,
    pixels: false,
    customDomain: false,
    apiAccess: false,
    partialResponses: false,
    csvExport: true,
    webhooks: false,
    redirect: true,
    emailNotifications: false,
    prioritySupport: false,
    features: [
      'Tudo do Free +',
      '1.000 respostas/mês',
      '10 formulários',
      'Redirecionamento após envio',
      'Exportação CSV',
      "Marca d'água EidosForm",
    ],
  },
  plus: {
    name: 'Plus',
    popular: true,
    monthlyPrice: 127,
    yearlyPrice: 97,
    maxResponses: 5000,
    maxForms: -1,
    maxUsers: 1,
    watermark: false,
    pixels: true,
    customDomain: false,
    apiAccess: false,
    partialResponses: true,
    csvExport: true,
    webhooks: true,
    redirect: true,
    emailNotifications: true,
    prioritySupport: true,
    features: [
      'Tudo do Starter +',
      '5.000 respostas/mês',
      'Formulários ilimitados',
      "Sem marca d'água",
      'Respostas parciais',
      'Taxa de abandono por pergunta',
      'Notificação por email',
      'Alerta de limite (80%)',
      'Meta Pixel (Facebook)',
      'Google Ads (Conversões)',
      'Google Tag Manager (GTM)',
      'TikTok Pixel',
      'Webhooks para automações',
      'Suporte prioritário',
    ],
  },
  professional: {
    name: 'Professional',
    monthlyPrice: 257,
    yearlyPrice: 197,
    maxResponses: 15000,
    maxForms: -1,
    maxUsers: 10,
    watermark: false,
    pixels: true,
    customDomain: true,
    apiAccess: true,
    partialResponses: true,
    csvExport: true,
    webhooks: true,
    redirect: true,
    emailNotifications: true,
    prioritySupport: true,
    features: [
      'Tudo do Plus +',
      '15.000 respostas/mês',
      'Até 10 usuários',
      'Domínio personalizado',
      'Acesso à API v1',
      'Chave de API dedicada',
      'Exportação CSV avançada',
      'Suporte prioritário com SLA',
    ],
  },
}

// Legacy alias — keeps backward compatibility
export interface PlanLimits {
  maxResponses: number
  maxForms: number
  watermark: boolean
  pixels: boolean
  customDomain: boolean
  apiAccess: boolean
  maxUsers: number
}

export const PLAN_LIMITS: Record<PlanName, PlanLimits> = Object.fromEntries(
  (Object.entries(PLANS) as [PlanName, PlanConfig][]).map(([key, p]) => [
    key,
    {
      maxResponses: p.maxResponses,
      maxForms: p.maxForms,
      watermark: p.watermark,
      pixels: p.pixels,
      customDomain: p.customDomain,
      apiAccess: p.apiAccess,
      maxUsers: p.maxUsers,
    },
  ])
) as Record<PlanName, PlanLimits>

export function getPlanLimits(plan: PlanName): PlanLimits {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.free
}

export async function checkResponseLimit(userId: string): Promise<{
  allowed: boolean
  usage: number
  limit: number
  plan: PlanName
  nearLimit: boolean
}> {
  const supabase = createPublicClient()

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('plan, responses_used, responses_limit, limit_alert_sent')
    .eq('id', userId)
    .single()

  if (error || !profile) {
    return { allowed: false, usage: 0, limit: 0, plan: 'free', nearLimit: false }
  }

  const plan = (profile.plan ?? 'free') as PlanName
  const usage = profile.responses_used ?? 0
  const limit = profile.responses_limit ?? PLANS[plan]?.maxResponses ?? 100

  if (limit === -1) {
    return { allowed: true, usage, limit, plan, nearLimit: false }
  }

  const allowed = usage < limit
  const nearLimit = !profile.limit_alert_sent && usage >= Math.floor(limit * 0.8)

  if (nearLimit) {
    await supabase
      .from('profiles')
      .update({ limit_alert_sent: true })
      .eq('id', userId)

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
      }).catch(console.error)
    }
  }

  return { allowed, usage, limit, plan, nearLimit }
}

export async function incrementResponseCount(userId: string): Promise<void> {
  const supabase = createPublicClient()
  await supabase.rpc('increment_responses_used', { p_user_id: userId })
}

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
