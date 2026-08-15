import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { verifyPaymentLinkToken } from '@/lib/payment-link-token'
import { getLinkPagamentoVencido } from '@/lib/asaas'
import { log, logWarn, logError } from '@/lib/logger'

/**
 * GET /pagar/[token] — o destino do botão "Regularizar pagamento" (D-01).
 *
 * Redireciona para a página de cobrança da fatura vencida, onde o cliente paga — com o mesmo
 * cartão ou trocando por outro. ⚠️ NÃO dizer "Pix ou boleto": o EidosForm só vende por CARTÃO
 * ([[decisions]], reafirmado 15/08) e 100% das cobranças nascem `billingType=CREDIT_CARD`.
 * É a peça que permite ao template do WhatsApp ser aprovado UMA vez e nunca mais:
 * a Meta valida `eidosform.com.br/pagar/{{1}}`, e para onde isso leva é decisão nossa, mutável
 * sem nova análise.
 *
 * ⚠️ NUNCA mostra erro técnico ao cliente. Qualquer falha — token inválido, gateway fora do ar,
 * cobrança sem link — cai no painel de cobrança com um aviso curto. Ele veio de uma mensagem
 * nossa pedindo pagamento; receber "erro 500" aqui é a pior experiência possível.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://eidosform.com.br'
  const paraOPainel = (motivo: string) =>
    NextResponse.redirect(`${base}/billing?cobranca=${encodeURIComponent(motivo)}`, 302)

  const { token } = await ctx.params
  const profileId = verifyPaymentLinkToken(token)
  if (!profileId) {
    // Token expirado (15 dias) ou adulterado. O painel é o destino certo: lá ele vê o estado
    // real da assinatura e consegue reativar.
    logWarn('[pagar] token inválido ou expirado')
    return paraOPainel('link_expirado')
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    logError('[pagar] service-role ausente')
    return paraOPainel('indisponivel')
  }

  try {
    const db = createServiceClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
    const { data: profile } = await db
      .from('profiles')
      .select('asaas_subscription_id, overdue_subscription_id, plan')
      .eq('id', profileId)
      .maybeSingle()

    const p = profile as { asaas_subscription_id?: string | null; overdue_subscription_id?: string | null } | null
    const subId = p?.asaas_subscription_id ?? p?.overdue_subscription_id
    if (!subId) {
      // Sem assinatura vinculada: ou já regularizou e o ciclo seguiu, ou cancelou. O painel
      // resolve os dois casos.
      log('[pagar] perfil sem assinatura vinculada — enviando ao painel')
      return paraOPainel('sem_pendencia')
    }

    const link = await getLinkPagamentoVencido(subId)
    if (!link.url) {
      // Pagou entre a mensagem e o clique (o caso feliz), ou o gateway não devolveu URL.
      log('[pagar] sem cobrança vencida com link — enviando ao painel', { ok: link.ok })
      return paraOPainel(link.ok ? 'sem_pendencia' : 'indisponivel')
    }

    log('[pagar] redirecionando para a fatura', { profileId })
    // 302 e não 301: o destino MUDA a cada cobrança; um 301 ficaria cacheado no navegador do
    // cliente e o próximo link levaria à fatura velha.
    return NextResponse.redirect(link.url, 302)
  } catch (err) {
    logError('[pagar] falha ao resolver o link de pagamento', err, { profileId })
    return paraOPainel('indisponivel')
  }
}
