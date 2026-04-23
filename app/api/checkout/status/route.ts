import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSubscription, getCustomerSubscriptions } from '@/lib/asaas'
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
      .select('plan, plan_status, asaas_customer_id')
      .eq('id', user.id)
      .single(),
    supabase
      .from('billing_checkouts')
      .select('status, last_event, updated_at, asaas_subscription_id, asaas_customer_id')
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

  // ── Fast path: checkout record says paid ──
  if (checkout?.status === 'paid') {
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
  const asaasCustomerId = checkout?.asaas_customer_id ?? profile?.asaas_customer_id

  // 1. Try by subscription ID if available
  if (asaasSubId) {
    try {
      const sub = await getSubscription(asaasSubId)
      const asaasStatus = (sub.status as string)?.toUpperCase()

      if (asaasStatus === 'ACTIVE') {
        log('[checkout/status] Asaas fallback: subscription ACTIVE', { subId: asaasSubId })
        return NextResponse.json({ status: 'success' })
      }

      if (asaasStatus === 'INACTIVE' || asaasStatus === 'EXPIRED' || asaasStatus === 'SUSPENDED') {
        log('[checkout/status] Asaas fallback: subscription not active', { subId: asaasSubId, asaasStatus })
        return NextResponse.json({ status: 'expired' })
      }

      log('[checkout/status] Asaas fallback: still pending', { subId: asaasSubId, asaasStatus })
    } catch (err) {
      log('[checkout/status] Asaas fallback failed, trying customer lookup', {
        subId: asaasSubId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // 2. Try by customer ID — covers hosted checkout where subscription ID
  //    is only populated by the webhook (which may not have arrived yet)
  if (asaasCustomerId) {
    try {
      const subs = await getCustomerSubscriptions(asaasCustomerId)
      const active = subs?.find?.((s: { status: string }) =>
        (s.status as string)?.toUpperCase() === 'ACTIVE'
      )
      if (active) {
        log('[checkout/status] Asaas customer fallback: found ACTIVE subscription', {
          customerId: asaasCustomerId,
          subId: active.id,
        })
        // Backfill subscription ID locally for future fast lookups
        if (!asaasSubId) {
          await supabase
            .from('billing_checkouts')
            .update({ asaas_subscription_id: active.id })
            .eq('profile_id', user.id)
            .is('asaas_subscription_id', null)
          await supabase
            .from('profiles')
            .update({ asaas_subscription_id: active.id })
            .eq('id', user.id)
        }
        return NextResponse.json({ status: 'success' })
      }
      log('[checkout/status] Asaas customer fallback: no active subscription', { customerId: asaasCustomerId })
    } catch (err) {
      log('[checkout/status] Asaas customer fallback failed', {
        customerId: asaasCustomerId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return NextResponse.json({ status: 'pending' })
}
