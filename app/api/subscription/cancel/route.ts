import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { cancelSubscription } from '@/lib/asaas'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('asaas_subscription_id, plan_expires_at')
    .eq('id', user.id)
    .single()

  if (!profile?.asaas_subscription_id) {
    return NextResponse.json({ error: 'Nenhuma assinatura ativa encontrada' }, { status: 400 })
  }

  try {
    await cancelSubscription(profile.asaas_subscription_id)
  } catch {
    return NextResponse.json({ error: 'Erro ao cancelar assinatura no provedor de pagamento' }, { status: 502 })
  }

  const { error: updateError } = await supabase
    .from('profiles')
    .update({ plan_status: 'canceling' })
    .eq('id', user.id)

  if (updateError) {
    return NextResponse.json({ error: 'Assinatura cancelada, mas erro ao atualizar perfil' }, { status: 500 })
  }

  return NextResponse.json({ success: true, expiresAt: profile.plan_expires_at })
}
