import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
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

  // Atualiza Supabase primeiro; se Asaas falhar, revertemos
  const { error: updateError } = await supabase
    .from('profiles')
    .update({ plan_status: 'canceling' })
    .eq('id', user.id)

  if (updateError) {
    return NextResponse.json({ error: 'Erro ao atualizar perfil' }, { status: 500 })
  }

  try {
    await cancelSubscription(profile.asaas_subscription_id)
  } catch (err) {
    logError('Asaas cancel failed', err, { subscriptionId: profile.asaas_subscription_id, userId: user.id })
    // Reverte o status para evitar inconsistência
    await supabase
      .from('profiles')
      .update({ plan_status: profile.plan_status ?? null })
      .eq('id', user.id)
    return NextResponse.json({ error: 'Erro ao cancelar assinatura no provedor de pagamento' }, { status: 502 })
  }

  // Resolve final expiration from Asaas (endDate / nextDueDate). Falls back to local value.
  let resolvedExpiresAt = profile.plan_expires_at as string | null
  try {
    const sub = await getSubscription(profile.asaas_subscription_id)
    const candidate = (sub?.endDate as string | undefined) ?? (sub?.nextDueDate as string | undefined)
    if (candidate) {
      resolvedExpiresAt = new Date(candidate).toISOString()
      await supabase
        .from('profiles')
        .update({ plan_expires_at: resolvedExpiresAt })
        .eq('id', user.id)
    }
  } catch (err) {
    logWarn('[subscription/cancel] Could not resolve endDate from Asaas (non-blocking)', { error: err instanceof Error ? err.message : String(err) })
  }

  return NextResponse.json({ success: true, expiresAt: resolvedExpiresAt })
}
