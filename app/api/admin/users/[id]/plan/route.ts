import { NextRequest, NextResponse } from 'next/server'
import { PLAN_ORDER, PlanId } from '@/lib/plans'
import { getAdminSupabase, requireAdmin } from '@/lib/admin-auth'
import { PLANS, handleDowngrade, handleUpgrade } from '@/lib/plan-limits'
import { log } from '@/lib/logger'

function isValidPlan(value: unknown): value is PlanId {
  return typeof value === 'string' && (PLAN_ORDER as readonly string[]).includes(value)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  const { id } = await params

  let body: { plan?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!isValidPlan(body.plan)) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
  }

  const supabase = getAdminSupabase()
  const newPlan = body.plan

  try {
    // Fetch current plan to determine if this is an upgrade or downgrade
    const { data: currentProfile } = await supabase
      .from('profiles')
      .select('plan')
      .eq('id', id)
      .single()

    const currentPlan = (currentProfile?.plan as PlanId) ?? 'free'
    const planConfig = PLANS[newPlan]
    const isDowngrade = PLAN_ORDER.indexOf(newPlan) < PLAN_ORDER.indexOf(currentPlan)

    const { error } = await supabase
      .from('profiles')
      .update({
        plan: newPlan,
        responses_limit: planConfig?.maxResponses ?? 100,
        responses_used: 0,
        limit_alert_sent: false,
        ...(newPlan === 'free'
          ? { plan_status: 'cancelled', plan_expires_at: null, asaas_subscription_id: null }
          : { plan_status: 'active' }),
      })
      .eq('id', id)

    if (error) {
      return NextResponse.json({ error: 'Failed to update user plan' }, { status: 500 })
    }

    // Handle form pausing/unpausing based on plan change
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (serviceKey) {
      try {
        if (isDowngrade) {
          const result = await handleDowngrade(id, serviceKey)
          log('[admin/plan] Downgrade processed', { userId: id, pausedForms: result.pausedCount })
        } else if (newPlan !== 'free') {
          const result = await handleUpgrade(id, serviceKey)
          log('[admin/plan] Upgrade processed', { userId: id, unpausedForms: result.unpausedCount })
        }
      } catch (err) {
        log('[admin/plan] handleUpgrade/handleDowngrade failed (non-blocking)', err as Record<string, unknown>)
      }
    }
  } catch (err) {
    console.error('[admin/plan] Update error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
