import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { PLANS, PlanName, handleDowngrade } from '@/lib/plan-limits'
import { getSubscription } from '@/lib/asaas'
import { expiryFromNextDueDate, calculateExpiryDate, type BillingCycle } from '@/lib/billing-activation'
import { log, logError, logWarn } from '@/lib/logger'

/**
 * GET /api/user/plan-features
 * Retorna as features disponíveis para o plano atual do usuário autenticado.
 * Também verifica expiração do plano — se expirado, reverte para free automaticamente.
 */
export async function GET() {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, plan_cycle, plan_expires_at, plan_status, asaas_subscription_id, responses_used, responses_limit')
    .eq('id', user.id)
    .single()

  let planName = (profile?.plan ?? 'free') as PlanName

  // Verificar expiração do plano
  if (profile?.plan_expires_at && profile.plan !== 'free') {
    const expiresAt = new Date(profile.plan_expires_at)
    const now = new Date()

    if (now > expiresAt) {
      // Antes de reverter: se ainda há sub vinculada, confere o estado REAL no Asaas. A
      // renovação pode ter só atrasado — não derrubar um pagante por isso. Só reverte se a
      // sub não existe mais OU não está ACTIVE. Erro transitório ao consultar → conservador,
      // NÃO reverte agora. (P2, audit Codex 2026-06-08.)
      let shouldRevert = true
      if (profile.asaas_subscription_id) {
        try {
          const sub = (await getSubscription(profile.asaas_subscription_id)) as { status?: string; nextDueDate?: string }
          if (String(sub?.status ?? '').toUpperCase() === 'ACTIVE') {
            shouldRevert = false
            // Sub ACTIVE → renovação a caminho. Estende a expiração pelo nextDueDate real;
            // se ele não der uma data futura válida, cai no fallback now+ciclo (P2, Codex):
            // SEMPRE corrige plan_expires_at, pra outros gates (getEffectivePlan) não verem
            // o plano como Free por causa de um expires_at vencido.
            const next = expiryFromNextDueDate(sub?.nextDueDate) ?? calculateExpiryDate((profile.plan_cycle ?? 'MONTHLY') as BillingCycle)
            try {
              const sc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
              await sc.from('profiles').update({ plan_expires_at: next }).eq('id', user.id)
            } catch (e) {
              logWarn('[plan-features] Falha ao estender plan_expires_at (não-bloqueante)', { error: e instanceof Error ? e.message : String(e) })
            }
            log('[plan-features] Expiração local vencida, mas sub ACTIVE no Asaas — mantendo acesso (renovação atrasada)', { userId: user.id, subscriptionId: profile.asaas_subscription_id })
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          // 404 = a sub NÃO existe mais no Asaas (cancelamento concluído) → reversão é o certo
          // (senão o acesso continuaria pra sempre após o fim do período). Outro erro
          // (5xx/rede) = transitório → conservador, não derruba o pagante agora. (P1, Codex 2026-06-08.)
          if (/error 404/i.test(msg)) {
            shouldRevert = true
            logWarn('[plan-features] Sub 404 no Asaas (cancelada/inexistente) na expiração — revertendo p/ free', { userId: user.id, subscriptionId: profile.asaas_subscription_id })
          } else {
            shouldRevert = false
            logWarn('[plan-features] Falha transitória ao consultar Asaas na expiração — NÃO reverte (conservador, não derruba pagante)', { userId: user.id, error: msg })
          }
        }
      }

      if (shouldRevert) {
        log('[plan-features] Plano expirado — revertendo para free', {
          userId: user.id,
          oldPlan: profile.plan,
          expiredAt: profile.plan_expires_at,
        })

        try {
          const serviceClient = createServiceClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
          )

          // #1: PAUSA OS FORMS PRIMEIRO (handleDowngrade lança se falhar). Só DEPOIS marca free.
          // Se falhar, NÃO marca free — o profile segue pago/expirado e a próxima visita retenta
          // (o bloco de expiração roda de novo porque plan != 'free'). E o cron também pega.
          const downgrade = await handleDowngrade(user.id, process.env.SUPABASE_SERVICE_ROLE_KEY!)
          log('[plan-features] Downgrade on expiry processed', { userId: user.id, pausedForms: downgrade.pausedCount })

          await serviceClient
            .from('profiles')
            .update({
              plan: 'free',
              plan_status: 'expired',
              plan_expires_at: null,
              limit_alert_sent: false,
              annual_started_at: null,
              responses_limit: PLANS.free.maxResponses,
              asaas_subscription_id: null,
            })
            .eq('id', user.id)

          planName = 'free'
        } catch (err) {
          // downgrade falhou → NÃO marca free → mantém acesso pago até retentar. Não derruba
          // o usuário no meio (planName segue o plano pago nesta resposta).
          logError('[plan-features] Falha ao pausar/reverter plano expirado — adiando (retenta na próxima visita/cron)', err)
        }
      }
    }
  }

  const planConfig = PLANS[planName]

  if (!planConfig) {
    return NextResponse.json({ error: 'Plano não encontrado' }, { status: 500 })
  }

  return NextResponse.json({
    plan: planName,
    quota: {
      responsesUsed: profile?.responses_used ?? 0,
      responsesLimit: profile?.responses_limit ?? PLANS.free.maxResponses,
    },
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
