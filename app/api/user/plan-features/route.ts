import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { PLANS, PlanName } from '@/lib/plan-limits'

/**
 * GET /api/user/plan-features
 * Retorna as features disponíveis para o plano atual do usuário autenticado.
 * Usado pelo frontend para mostrar/esconder UI de pixel events, webhooks, etc.
 */
export async function GET() {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', user.id)
    .single()

  const planName = (profile?.plan ?? 'free') as PlanName
  const planConfig = PLANS[planName]

  if (!planConfig) {
    return NextResponse.json({ error: 'Plano não encontrado' }, { status: 500 })
  }

  return NextResponse.json({
    plan: planName,
    features: {
      maxResponses: planConfig.maxResponses,
      maxForms: planConfig.maxForms,
      maxUsers: planConfig.maxUsers,
      watermark: planConfig.watermark,
      pixels: planConfig.pixels,
      pixelEvents: planConfig.pixels, // pixel events requer mesmo nível de plano que pixels
      customDomain: planConfig.customDomain,
      apiAccess: planConfig.apiAccess,
      partialResponses: planConfig.partialResponses,
      csvExport: planConfig.csvExport,
      webhooks: planConfig.webhooks,
      redirect: planConfig.redirect,
      emailNotifications: planConfig.emailNotifications,
      prioritySupport: planConfig.prioritySupport,
    },
  })
}
