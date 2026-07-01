import { NextRequest, NextResponse } from 'next/server'
import { PLAN_ORDER, PlanId } from '@/lib/plans'
import { getAdminSupabase, requireAdmin } from '@/lib/admin-auth'
import { PLANS, handleDowngrade, handleUpgrade } from '@/lib/plan-limits'
import { cancelSubscription } from '@/lib/asaas'
import { log, logError, logWarn } from '@/lib/logger'

function isValidPlan(value: unknown): value is PlanId {
  return typeof value === 'string' && (PLAN_ORDER as readonly string[]).includes(value)
}

/**
 * Validates and normalises the optional expiresAt input.
 * Returns either:
 *  - { ok: true, value: ISO string | null }
 *  - { ok: false, error: human-readable message }
 *
 * Accepted values:
 *  - undefined → no change to current expiration (we preserve it)
 *  - null      → clear the expiration (plan never expires)
 *  - ISO string in the future → set expiration to that date
 */
function parseExpiresAt(input: unknown):
  | { ok: true; value: string | null | undefined }
  | { ok: false; error: string } {
  if (input === undefined) return { ok: true, value: undefined }
  if (input === null) return { ok: true, value: null }
  if (typeof input !== 'string') {
    return { ok: false, error: 'expiresAt must be an ISO 8601 string or null' }
  }
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) {
    return { ok: false, error: 'expiresAt is not a valid date' }
  }
  if (date.getTime() <= Date.now()) {
    return { ok: false, error: 'expiresAt must be in the future' }
  }
  return { ok: true, value: date.toISOString() }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  const { id } = await params

  let body: { plan?: unknown; expiresAt?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!isValidPlan(body.plan)) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
  }

  const expiresAtParsed = parseExpiresAt(body.expiresAt)
  if (!expiresAtParsed.ok) {
    return NextResponse.json({ error: expiresAtParsed.error }, { status: 400 })
  }

  const supabase = getAdminSupabase()
  const newPlan = body.plan

  try {
    // Fetch current plan to determine if this is an upgrade or downgrade
    const { data: currentProfile } = await supabase
      .from('profiles')
      .select('plan, asaas_subscription_id')
      .eq('id', id)
      .single()

    const currentPlan = (currentProfile?.plan as PlanId) ?? 'free'
    const currentSub = (currentProfile as { asaas_subscription_id?: string | null } | null)?.asaas_subscription_id ?? null
    const planConfig = PLANS[newPlan]
    const isDowngrade = PLAN_ORDER.indexOf(newPlan) < PLAN_ORDER.indexOf(currentPlan)

    // P1 (audit Codex 2026-06-08): admin NÃO pode trocar PAGO→PAGO (plano diferente) de um
    // usuário com assinatura no Asaas — o profile mudaria de plano mas a sub continuaria
    // cobrando o valor antigo (divergência/subcobrança). Esta rota admin só deve: mover p/
    // free (cancela a sub, tratado abaixo), conceder plano a quem NÃO tem sub (grant manual),
    // ou ajustar o MESMO plano (ex.: expiresAt). Troca paga→paga de quem tem sub vai pelo
    // fluxo normal de upgrade/downgrade do usuário (que edita a sub no Asaas).
    if (newPlan !== 'free' && newPlan !== currentPlan && currentSub) {
      return NextResponse.json(
        { error: 'Usuário tem assinatura ativa no Asaas. Troca paga→paga pelo admin causaria divergência de cobrança. Mova para free primeiro (cancela a assinatura) ou use o fluxo de upgrade/downgrade do usuário.' },
        { status: 409 }
      )
    }

    // P0 (audit Codex 2026-06-08): ao mover pra FREE, cancelar a assinatura no Asaas ANTES
    // de limpar o asaas_subscription_id local. Sem isto, o profile vira free/cancelled mas a
    // cobrança recorrente segue ATIVA no gateway (cobrança fantasma). FAIL-CLOSED: se o
    // cancelamento falhar (≠404), NÃO aplica o downgrade. 404 = já removida (idempotente).
    if (newPlan === 'free' && currentSub) {
      try {
        await cancelSubscription(currentSub)
        log('[admin/plan] Assinatura cancelada no Asaas ao mover usuário p/ free', { userId: id, subscriptionId: currentSub })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (/error 404/i.test(msg)) {
          logWarn('[admin/plan] Sub já removida no Asaas (404) — prosseguindo com o downgrade', { userId: id, subscriptionId: currentSub })
        } else {
          logError('[admin/plan] Falha ao cancelar assinatura no Asaas — downgrade NÃO aplicado (fail-closed)', err, { userId: id, subscriptionId: currentSub })
          return NextResponse.json(
            { error: 'Falha ao cancelar a assinatura no Asaas. Downgrade NÃO aplicado para evitar cobrança ativa órfã. Tente novamente.' },
            { status: 502 }
          )
        }
      }
    }

    // Build plan_expires_at update logic:
    // - new plan === 'free': always force null (free has no expiration)
    // - new plan !== 'free' + expiresAt explicitly provided (ISO or null): use it
    // - new plan !== 'free' + expiresAt undefined: preserve current value
    const expiresAtUpdate: { plan_expires_at?: string | null } =
      newPlan === 'free'
        ? { plan_expires_at: null }
        : expiresAtParsed.value !== undefined
          ? { plan_expires_at: expiresAtParsed.value }
          : {}

    const { error } = await supabase
      .from('profiles')
      .update({
        plan: newPlan,
        responses_limit: planConfig?.maxResponses ?? 100,
        responses_used: 0,
        limit_alert_sent: false,
        ...(newPlan === 'free'
          ? { plan_status: 'cancelled', plan_cycle: null, asaas_subscription_id: null, annual_started_at: null }
          : { plan_status: 'active' }),
        ...expiresAtUpdate,
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
