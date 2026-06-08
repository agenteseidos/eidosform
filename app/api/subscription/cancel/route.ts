import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { cancelSubscription, getSubscription } from '@/lib/asaas'
import { logError, logWarn } from '@/lib/logger'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('asaas_subscription_id, plan_expires_at, plan_status')
    .eq('id', user.id)
    .single()

  if (!profile?.asaas_subscription_id) {
    return NextResponse.json({ error: 'Nenhuma assinatura ativa encontrada' }, { status: 400 })
  }

  if (profile.plan_status === 'canceling') {
    return NextResponse.json({ error: 'Assinatura já está sendo cancelada' }, { status: 409 })
  }

  // Service-role para as ESCRITAS no profile: a RLS "safe profile fields" impede o client
  // do usuário de alterar plan_status/plan_expires_at, então o update do usuário afetava 0
  // linhas / 500 e o cancelamento pelo painel quebrava. (P1, audit Codex 2026-06-08.)
  // Validado DEPOIS dos checks de profile (400/409) pra esses casos não virarem 503. (P3.)
  const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceUrl || !serviceKey) {
    logError('[subscription/cancel] SUPABASE service-role env ausente — não dá pra cancelar')
    return NextResponse.json({ error: 'Configuração indisponível. Tente novamente mais tarde.' }, { status: 503 })
  }
  const admin = createServiceClient(serviceUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

  // Marca 'canceling' primeiro (service-role); se o Asaas falhar, revertemos. Checa linhas.
  const { data: markRows, error: updateError } = await admin
    .from('profiles')
    .update({ plan_status: 'canceling' })
    .eq('id', user.id)
    .select('id')

  if (updateError || !markRows || markRows.length !== 1) {
    logError('[subscription/cancel] Falha ao marcar canceling no profile', updateError, { userId: user.id, rows: markRows?.length ?? 0 })
    return NextResponse.json({ error: 'Erro ao atualizar perfil' }, { status: 500 })
  }

  try {
    await cancelSubscription(profile.asaas_subscription_id)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // 404 = já removida no Asaas → segue (idempotente). Outro erro → reverte e devolve 502.
    if (!/error 404/i.test(msg)) {
      logError('Asaas cancel failed', err, { subscriptionId: profile.asaas_subscription_id, userId: user.id })
      await admin
        .from('profiles')
        .update({ plan_status: profile.plan_status ?? null })
        .eq('id', user.id)
      return NextResponse.json({ error: 'Erro ao cancelar assinatura no provedor de pagamento' }, { status: 502 })
    }
    logWarn('[subscription/cancel] Sub já removida no Asaas (404) — segue', { subscriptionId: profile.asaas_subscription_id, userId: user.id })
  }

  // Mantém o acesso até o fim do período PAGO: resolve a expiração final do Asaas
  // (endDate / nextDueDate), com fallback no valor local. A reversão p/ free acontece na
  // expiração (lib/plan-features). O webhook SUBSCRIPTION_DELETED, ao ver 'canceling' +
  // período vigente, NÃO rebaixa na hora (mantém o acesso prometido até a data).
  let resolvedExpiresAt = profile.plan_expires_at as string | null
  try {
    const sub = await getSubscription(profile.asaas_subscription_id)
    const candidate = (sub?.endDate as string | undefined) ?? (sub?.nextDueDate as string | undefined)
    if (candidate) {
      resolvedExpiresAt = new Date(candidate).toISOString()
      await admin
        .from('profiles')
        .update({ plan_expires_at: resolvedExpiresAt })
        .eq('id', user.id)
    }
  } catch (err) {
    logWarn('[subscription/cancel] Could not resolve endDate from Asaas (non-blocking)', { error: err instanceof Error ? err.message : String(err) })
  }

  return NextResponse.json({ success: true, expiresAt: resolvedExpiresAt })
}
