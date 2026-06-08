import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cancelSubscription } from '@/lib/asaas'
import { logError, logWarn } from '@/lib/logger'

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

  // Cancela a assinatura no Asaas ANTES de deletar a conta. FAIL-CLOSED (P0, audit Codex
  // 2026-06-08): se o cancelamento falhar, NÃO deleta a conta — senão o profile/auth some
  // mas a assinatura segue ACTIVE no gateway e o cliente continua sendo cobrado, sem estado
  // local pra reconciliar. 404 (já removida) é tratado como sucesso (idempotente).
  // SEMPRE tenta cancelar se há asaas_subscription_id — não confia no plan_status local, que
  // pode estar 'cancelled' com a sub ainda ativa (inconsistência). (P1, Codex 2026-06-08.)
  if (profile?.asaas_subscription_id) {
    try {
      await cancelSubscription(profile.asaas_subscription_id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/error 404/i.test(msg)) {
        logWarn('Asaas sub já removida (404) na deleção — prosseguindo', { subscriptionId: profile.asaas_subscription_id, userId: user.id })
      } else {
        logError('Asaas cancel on delete FAILED — abortando deleção (fail-closed)', err, { subscriptionId: profile.asaas_subscription_id, userId: user.id })
        return NextResponse.json(
          { error: 'Não foi possível cancelar sua assinatura no provedor de pagamento agora. Sua conta NÃO foi deletada (para evitar cobrança indevida). Tente novamente em instantes.' },
          { status: 502 }
        )
      }
    }
  }

  const adminSupabase = createAdminClient()

  // form_whatsapp_settings.created_by → profiles(id) has no ON DELETE CASCADE
  await adminSupabase.from('form_whatsapp_settings').delete().eq('created_by', user.id)

  // Deleting the auth user cascades to profiles → forms → responses → answer_items
  // → billing_checkouts → folders → custom_domains → whatsapp_logs (via forms)
  const { error } = await adminSupabase.auth.admin.deleteUser(user.id)

  if (error) {
    return NextResponse.json({ error: 'Erro ao deletar conta' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
