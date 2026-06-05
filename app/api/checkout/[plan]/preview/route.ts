/**
 * GET /api/checkout/[plan]/preview?cycle=monthly|yearly
 * Dry-run: calcula o resumo da troca de plano (proration, valor a pagar, próxima
 * cobrança) SEM nenhum efeito colateral — não cria customer/checkout, não edita
 * assinatura, não toca no profile. Usa a MESMA lógica pura (computePlanChange) que o
 * POST de execução, então o que o usuário confirma é o que será executado.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { PLAN_ORDER, type PlanId } from '@/lib/plans'
import { BILLING_FIELD_LABELS, getBillingProfileForUser, getMissingBillingFields } from '@/lib/billing-profile'
import { computePlanChange } from '@/lib/plan-change'
import { type BillingCycle } from '@/lib/asaas'

const VALID_PLANS = new Set<string>(PLAN_ORDER.filter((p) => p !== 'free'))
const VALID_CYCLES = new Set<string>(['MONTHLY', 'YEARLY'])

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ plan: string }> }
) {
  const { plan } = await params
  const cycle = ((req.nextUrl.searchParams.get('cycle') ?? 'monthly').toUpperCase()) as BillingCycle

  if (!VALID_PLANS.has(plan)) {
    return NextResponse.json({ error: 'Plano inválido' }, { status: 400 })
  }
  if (!VALID_CYCLES.has(cycle)) {
    return NextResponse.json({ error: 'Ciclo inválido' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const profile = await getBillingProfileForUser(user.id, user.email)
  if (!profile) {
    return NextResponse.json({ error: 'Perfil não encontrado' }, { status: 404 })
  }

  const missingFields = getMissingBillingFields(profile)

  const change = computePlanChange({
    currentPlan: profile.plan,
    currentCycle: profile.plan_cycle,
    planExpiresAt: profile.plan_expires_at,
    hasActiveSubscription: !!profile.asaasSubscriptionId,
    newPlan: plan as PlanId,
    newCycle: cycle,
  })

  return NextResponse.json({
    ...change,
    missingFields,
    missingFieldLabels: missingFields.map((f) => BILLING_FIELD_LABELS[f]),
  })
}
