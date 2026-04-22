import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { PLANS, PlanName } from '@/lib/plan-limits'
import { log, logError } from '@/lib/logger'

/**
 * GET /api/user/plan-features
 * Retorna as features disponíveis para o plano atual do usuário autenticado.
 * Também verifica expiração do plano — se expirado, reverte para free automaticamente.
 */
export async function GET() {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, plan_expires_at, plan_status')
    .eq('id', user.id)
    .single()

  let planName = (profile?.plan ?? 'free') as PlanName

  // Verificar expiração do plano
  if (profile?.plan_expires_at && profile.plan !== 'free') {
    const expiresAt = new Date(profile.plan_expires_at)
    const now = new Date()

    if (now > expiresAt) {
      log('[plan-features] Plano expirado — revertendo para free', {
        userId: user.id,
        oldPlan: profile.plan,
        expiredAt: profile.plan_expires_at,
      })

      // Usar service role client para atualizar o profile
      try {
        const serviceClient = createServiceClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
        )
        await serviceClient
          .from('profiles')
          .update({
            plan: 'free',
            plan_status: 'expired',
            plan_expires_at: null,
            limit_alert_sent: false,
            responses_limit: PLANS.free.maxResponses,
          })
          .eq('id', user.id)
      } catch (err) {
        logError('[plan-features] Erro ao reverter plano expirado', err)
      }

      planName = 'free'
    }
  }

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
      pixelEvents: planConfig.pixels,
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
