import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cancelSubscription } from '@/lib/asaas'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('asaas_subscription_id, plan_status')
    .eq('id', user.id)
    .single()

  // Cancel Asaas subscription if one exists and isn't already cancelled
  if (profile?.asaas_subscription_id && profile.plan_status !== 'cancelled') {
    try {
      await cancelSubscription(profile.asaas_subscription_id)
    } catch {
      // Best-effort — proceed with account deletion regardless
    }
  }

  const adminSupabase = createAdminClient()

  // Deleting the auth user cascades to profiles → forms → responses → answer_items
  // → billing_checkouts → folders → custom_domains → whatsapp_logs (via forms)
  const { error } = await adminSupabase.auth.admin.deleteUser(user.id)

  if (error) {
    return NextResponse.json({ error: 'Erro ao deletar conta' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
