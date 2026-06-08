import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { cancelSubscription, getSubscription, getEarliestPendingDueDate } from '@/lib/asaas'
import { expiryFromNextDueDate, calculateExpiryDate, type BillingCycle } from '@/lib/billing-activation'
import { logError, logWarn } from '@/lib/logger'
import { sendBillingOpsAlert } from '@/lib/resend'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('asaas_subscription_id, plan_cycle, plan_expires_at, plan_status')
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

  // Resolve a expiração final ANTES do DELETE (P1, audit Codex 2026-06-08). Depois de
  // removida, getSubscription dá 404 e perderíamos a data real (nextDueDate/endDate), caindo
  // num plan_expires_at local possivelmente vencido — o webhook SUBSCRIPTION_DELETED então
  // não manteria o acesso até o fim do período (quebra a promessa). Cadeia de fallback:
  // nextDueDate/endDate do Asaas (fim-de-dia BRT) → valor local → now+ciclo (sempre futuro).
  const cycle = (profile.plan_cycle ?? 'MONTHLY') as BillingCycle
  // Só aceita o plan_expires_at local se for FUTURO. Gravar expiração passada faria o webhook
  // SUBSCRIPTION_DELETED não entrar no soft-cancel (exige período vigente) e rebaixar imediato,
  // tirando acesso que o usuário ainda pagou. (P2, audit Codex 2026-06-08.) Garante data futura.
  const localFutureExpiry =
    profile.plan_expires_at && new Date(profile.plan_expires_at).getTime() > Date.now()
      ? (profile.plan_expires_at as string)
      : null
  let resolvedExpiresAt: string
  try {
    const sub = (await getSubscription(profile.asaas_subscription_id)) as { endDate?: string; nextDueDate?: string }
    // FONTE DA EXPIRAÇÃO = o pagamento PENDING mais antigo (a próxima cobrança não-paga = a data
    // até onde tem acesso pago). Corrige DOIS bugs de uma vez (P0, Codex 2026-06-08): (1) NÃO usa
    // o subscription.nextDueDate INFLADO (próximo ciclo) das subs com 1ª cobrança futura → mata o
    // compounding; (2) NÃO sub-concede acesso após uma renovação paga (o pendente é a próxima
    // cobrança real, depois do ciclo já pago).
    const pending = await getEarliestPendingDueDate(profile.asaas_subscription_id)
    if (!pending.ok) {
      // A listagem de pagamentos FALHOU → NÃO confiar no nextDueDate (pode estar inflado p/
      // credit-time). Usa a expiração LOCAL (não estende, sem compounding) + alerta operacional.
      resolvedExpiresAt = localFutureExpiry ?? calculateExpiryDate(cycle)
      logWarn('[subscription/cancel] listagem de pagamentos falhou — expiração pelo fallback local', { userId: user.id, subscriptionId: profile.asaas_subscription_id, resolvedExpiresAt })
      await sendBillingOpsAlert({
        subject: 'Cancelamento: não listou pagamentos pendentes — expiração pelo fallback local (revisar)',
        lines: { userId: user.id, subscriptionId: profile.asaas_subscription_id, resolvedExpiresAt },
      }).catch(() => {})
    } else {
      // ok: se há pendente, usa-o; senão (genuinamente sem pendente) o nextDueDate NÃO está
      // inflado (a inflação só ocorre quando existe um pendente de 1ª cobrança) → seguro.
      const candidate = pending.dueDate ?? sub?.endDate ?? sub?.nextDueDate
      resolvedExpiresAt = expiryFromNextDueDate(candidate) ?? localFutureExpiry ?? calculateExpiryDate(cycle)
    }
  } catch (err) {
    resolvedExpiresAt = localFutureExpiry ?? calculateExpiryDate(cycle)
    logWarn('[subscription/cancel] Não resolveu endDate do Asaas (pré-delete) — usando fallback futuro', { error: err instanceof Error ? err.message : String(err) })
  }

  // Persiste 'canceling' + a expiração resolvida ANTES do DELETE (service-role; checa linhas).
  // Guarda os valores anteriores para rollback se o cancelamento no Asaas falhar.
  const prevStatus = profile.plan_status ?? null
  const prevExpires = profile.plan_expires_at as string | null
  const { data: markRows, error: updateError } = await admin
    .from('profiles')
    .update({ plan_status: 'canceling', plan_expires_at: resolvedExpiresAt })
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
    // 404 = já removida no Asaas → segue (idempotente). Outro erro → rollback (status +
    // expiração) e devolve 502.
    if (!/error 404/i.test(msg)) {
      logError('Asaas cancel failed', err, { subscriptionId: profile.asaas_subscription_id, userId: user.id })
      await admin
        .from('profiles')
        .update({ plan_status: prevStatus, plan_expires_at: prevExpires })
        .eq('id', user.id)
      return NextResponse.json({ error: 'Erro ao cancelar assinatura no provedor de pagamento' }, { status: 502 })
    }
    logWarn('[subscription/cancel] Sub já removida no Asaas (404) — segue', { subscriptionId: profile.asaas_subscription_id, userId: user.id })
  }

  // Acesso mantido até resolvedExpiresAt (já persistido). A reversão p/ free acontece na
  // expiração (lib/plan-features). O webhook SUBSCRIPTION_DELETED, ao ver 'canceling' +
  // período vigente, NÃO rebaixa na hora.
  return NextResponse.json({ success: true, expiresAt: resolvedExpiresAt })
}
