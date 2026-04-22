/**
 * lib/plan-limits.ts — Sistema de limites por plano
 * Single source of truth for plan pricing, features, and limits.
 */

import { createClient } from '@/lib/supabase/server'
import { createPublicClient } from '@/lib/supabase/public'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { sendLimitAlert } from '@/lib/resend'
import { PlanId } from '@/lib/plans'
import { logError } from '@/lib/logger'

/** @deprecated Use PlanId from lib/plans.ts */
export type PlanName = PlanId

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
  whatsappNotifications: boolean
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
    whatsappNotifications: false,
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
    maxForms: 100,
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
    whatsappNotifications: false,
    prioritySupport: false,
    features: [
      'Tudo do Free +',
      '1.000 respostas/mês',
      '100 formulários',
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
    whatsappNotifications: true,
    prioritySupport: true,
    features: [
      'Tudo do Starter +',
      '5.000 respostas/mês',
      'Formulários ilimitados',
      "Sem marca d'água",
      'Respostas parciais',
      'Taxa de abandono por pergunta',
      'Notificação por email',
      'Notificação por WhatsApp',
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
    whatsappNotifications: true,
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
      'Notificação por WhatsApp',
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
      }).catch((err) => logError('Failed to send limit alert', err))
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

/**
 * Handle plan downgrade — pause forms above free tier limit
 *
 * When a user's plan expires or is cancelled:
 * 1. Unpause ALL forms first (clean slate)
 * 2. Get published forms with their response counts
 * 3. Keep the 3 forms with FEWEST responses active
 * 4. Forms with 100+ responses are NEVER kept active → always paused
 * 5. Pause all remaining forms
 *
 * Tie-breaking: random among forms with equal response counts.
 * Uses service role client to bypass RLS during webhook processing.
 */
export async function handleDowngrade(
  userId: string,
  serviceRoleKey: string
): Promise<{ pausedCount: number }> {
  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey
  )

  const freeLimit = PLANS.free.maxForms // 3
  const responseThreshold = 100 // Forms with 100+ responses are always paused

  // Step 1: Unpause all forms for this user
  await supabase
    .from('forms')
    .update({ paused: false })
    .eq('user_id', userId)

  // Step 2: Get all published forms for this user
  const { data: publishedForms } = await supabase
    .from('forms')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'published')

  if (!publishedForms || publishedForms.length <= freeLimit) {
    return { pausedCount: 0 }
  }

  // Step 3: Count responses per form via RPC or direct query
  const formIds = publishedForms.map((f: { id: string }) => f.id)
  const { data: responseCounts } = await supabase
    .from('responses')
    .select('form_id')
    .in('form_id', formIds)

  // Build response count map
  const countMap = new Map<string, number>()
  for (const f of formIds) {
    countMap.set(f, 0)
  }
  if (responseCounts) {
    for (const r of responseCounts) {
      const fid = (r as { form_id: string }).form_id
      countMap.set(fid, (countMap.get(fid) ?? 0) + 1)
    }
  }

  // Step 4: Separate eligible (< 100 responses) from always-paused (100+ responses)
  type FormWithCount = { id: string; responseCount: number }
  const eligible: FormWithCount[] = []
  const alwaysPaused: string[] = []

  for (const [id, count] of countMap.entries()) {
    if (count >= responseThreshold) {
      alwaysPaused.push(id)
    } else {
      eligible.push({ id, responseCount: count })
    }
  }

  // Step 5: Sort eligible by response count ascending (fewest first)
  // Randomize among ties using Fisher-Yates on groups with same count
  eligible.sort((a, b) => a.responseCount - b.responseCount)

  // Apply stable random tie-breaking within groups of equal response count
  // Shuffle groups of equal counts to randomize which forms survive when ties exist
  let i = 0
  while (i < eligible.length) {
    let j = i + 1
    while (j < eligible.length && eligible[j].responseCount === eligible[i].responseCount) {
      j++
    }
    // Shuffle the group [i, j) using crypto-quality randomness (Fisher-Yates)
    if (j - i > 1) {
      for (let k = j - 1; k > i; k--) {
        const range = k - i + 1
        const buf = new Uint32Array(1)
        crypto.getRandomValues(buf)
        const swapIdx = i + (buf[0] % range)
        ;[eligible[k], eligible[swapIdx]] = [eligible[swapIdx], eligible[k]]
      }
    }
    i = j
  }

  // Step 6: Keep the first `freeLimit` eligible forms active, pause the rest
  const toKeepActive = eligible.slice(0, freeLimit).map((f) => f.id)
  const toPauseFromEligible = eligible.slice(freeLimit).map((f) => f.id)

  // Combine: always-paused (100+ responses) + eligible beyond limit
  const idsToPause = [...alwaysPaused, ...toPauseFromEligible]

  // Safety: also pause any that ended up not in toKeepActive
  // (ensures forms active ≤ freeLimit)
  const activeSet = new Set(toKeepActive)
  for (const f of publishedForms) {
    if (!activeSet.has((f as { id: string }).id) && !idsToPause.includes((f as { id: string }).id)) {
      idsToPause.push((f as { id: string }).id)
    }
  }

  if (idsToPause.length === 0) {
    return { pausedCount: 0 }
  }

  const { error } = await supabase
    .from('forms')
    .update({ paused: true })
    .in('id', idsToPause)

  if (error) {
    logError('[handleDowngrade] Failed to pause forms', error)
  }

  return { pausedCount: idsToPause.length }
}

/**
 * Handle plan upgrade — unpause all forms
 *
 * When a user upgrades/reactivates their plan, unpause all forms.
 */
export async function handleUpgrade(
  userId: string,
  serviceRoleKey: string
): Promise<{ unpausedCount: number }> {
  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey
  )

  const { data: pausedForms } = await supabase
    .from('forms')
    .select('id')
    .eq('user_id', userId)
    .eq('paused', true)

  if (!pausedForms || pausedForms.length === 0) {
    return { unpausedCount: 0 }
  }

  await supabase
    .from('forms')
    .update({ paused: false })
    .eq('user_id', userId)
    .eq('paused', true)

  return { unpausedCount: pausedForms.length }
}

/**
 * Count paused forms for a user
 */
export async function countPausedForms(userId: string): Promise<number> {
  const supabase = createPublicClient()

  const { count } = await supabase
    .from('forms')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('paused', true)

  return count ?? 0
}
