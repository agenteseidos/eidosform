import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSubscription } from '@/lib/asaas'
import { log } from '@/lib/logger'

/**
 * GET /api/checkout/status
 *
 * Returns the current checkout/payment status for the authenticated user.
 *
 * Resolution order:
 * 1. Local DB (profiles + billing_checkouts) — fast, always tried first
 * 2. Asaas fallback — queried when local status is still "pending" and we have
 *    an asaas_subscription_id. Covers the case where the webhook is delayed.
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [{ data: profile }, { data: checkout }] = await Promise.all([
    supabase
      .from('profiles')
      .select('plan, plan_status')
      .eq('id', user.id)
      .single(),
    supabase
      .from('billing_checkouts')
      .select('status, last_event, updated_at, asaas_subscription_id')
      .eq('profile_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const plan = profile?.plan ?? 'free'
  const planStatus = profile?.plan_status ?? null

  // ── Fast path: local DB says active ──
  if (plan !== 'free' && planStatus === 'active') {
    return NextResponse.json({ status: 'success' })
  }

  // ── Fast path: local DB says cancelled/overdue ──
  if (checkout?.status === 'cancelled') {
    return NextResponse.json({ status: 'cancelled' })
  }
  if (checkout?.status === 'overdue') {
    return NextResponse.json({ status: 'expired' })
  }

  // ── Slow path: still pending → ask Asaas directly ──
  const asaasSubId = checkout?.asaas_subscription_id
  if (asaasSubId) {
    try {
      const sub = await getSubscription(asaasSubId)
      const asaasStatus = (sub.status as string)?.toUpperCase()

      // Asaas statuses: ACTIVE, PENDING, INACTIVE, EXPIRED, SUSPENDED
      if (asaasStatus === 'ACTIVE') {
        log('[checkout/status] Asaas fallback: subscription ACTIVE', { subId: asaasSubId })
        return NextResponse.json({ status: 'success' })
      }

      if (asaasStatus === 'INACTIVE' || asaasStatus === 'EXPIRED' || asaasStatus === 'SUSPENDED') {
        log('[checkout/status] Asaas fallback: subscription not active', { subId: asaasSubId, asaasStatus })
        return NextResponse.json({ status: 'expired' })
      }

      // PENDING or unknown → still waiting
      log('[checkout/status] Asaas fallback: still pending', { subId: asaasSubId, asaasStatus })
    } catch (err) {
      // Asaas unavailable — don't break the flow, just fall through
      log('[checkout/status] Asaas fallback failed, continuing with local', {
        subId: asaasSubId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return NextResponse.json({ status: 'pending' })
}
