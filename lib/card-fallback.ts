/**
 * lib/card-fallback.ts — FALLBACK DE CARTÃO MORTO: abertura da sessão (2026-07-03).
 *
 * Quando uma troca de plano PAGA não tem token utilizável (nunca teve — pré-tokenização —
 * ou o token salvo morreu: CHARGE_FAILED), abre um checkout hospedado do Asaas de pagamento
 * ÚNICO (chargeTypes DETACHED) cobrando SÓ a diferença prorateada. O cartão novo digitado na
 * sessão vira token reutilizável no pagamento (gate 2, smoke de produção 2026-07-03) e a
 * conclusão da troca — sub NOVA sempre no preço CHEIO — fica com o backstop
 * (webhook/DLQ/cron), nunca aqui.
 *
 * Este módulo executa APENAS os passos 2-3 da arquitetura (criação da sessão), fail-closed:
 *   2. UPSERT da linha de recuperação (`planchange-pay-{profileId}`) ANTES da sessão —
 *      status 'pending' + payment_method 'plan_switch_fallback'. Falhou → 500 sem tocar
 *      no Asaas (nunca criar sessão que o banco não conhece).
 *   3. createDetachedCheckout → UPDATE do asaas_checkout_session_id ANTES de devolver a
 *      URL. O Asaas NÃO persiste externalReference no checkout hospedado, então esse id é
 *      o ÚNICO fio de correlação do pagamento com a tentativa — se o update falhar, a URL
 *      NÃO é entregue (503; a sessão órfã expira sozinha e a correlação nunca fica cega).
 *
 * ⚠️ LOCK: o CHAMADOR (rota de checkout) segura `planchange:{profileId}` em volta desta
 * função — mesmo contrato do executePlanSwitch (lock não-reentrante).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createDetachedCheckout, type BillingCycle } from '@/lib/asaas'
import type { PlanId } from '@/lib/plans'
import { log, logError } from '@/lib/logger'

export interface CardFallbackParams {
  profileId: string
  customerId: string
  /** Só p/ log/telemetria — a linha grava asaas_subscription_id NULL de propósito
   *  (≠ fluxo token): evita cross-match no resolveBillingContext e alert-storm no polling. */
  currentSubscriptionId: string | null
  plan: PlanId
  cycle: BillingCycle
  /** Tentativa (decidePlanChangeAttempt) — mesma identidade P0-A do fluxo token. */
  attemptId: string
  proration: { credit: number; originalPrice: number; finalPrice: number }
  /** Origin JÁ validado pela allowlist da rota (resolveCallbackOrigin). */
  origin: string
  reason: 'CHARGE_FAILED' | 'CARD_TOKEN_REQUIRED'
}

export type CardFallbackResult =
  | { ok: true; checkoutId: string; checkoutUrl: string }
  | { ok: false; status: number; error: string; code: string }

/**
 * Abre a sessão DETACHED da diferença. Retorna a URL SÓ depois de a correlação
 * (session id na linha) estar persistida. Nada aqui cobra nem troca plano.
 */
export async function openCardFallbackCheckout(db: SupabaseClient, params: CardFallbackParams): Promise<CardFallbackResult> {
  const { profileId, customerId, currentSubscriptionId, plan, cycle, attemptId, proration, origin, reason } = params
  const recoveryCheckoutId = `planchange-pay-${profileId}`

  // Guard defensivo: diferença ≤ 0 nunca deveria chegar aqui (downgrades/coberto por saldo
  // caem em credit_covered/downgrade_scheduled antes) — mas dinheiro pede cinto e suspensório.
  if (!(proration.finalPrice > 0)) {
    logError('[card-fallback] finalPrice <= 0 — nada a cobrar; abortando sem criar sessão', undefined, {
      profileId, plan, cycle, finalPrice: proration.finalPrice, reason,
    })
    return { ok: false, status: 400, error: 'Não há diferença a pagar nesta mudança de plano.', code: 'CARD_FALLBACK_INVALID_VALUE' }
  }

  log('[card-fallback] Abrindo sessão DETACHED da diferença (token ausente/morto)', {
    profileId, plan, cycle, reason, attemptId, value: proration.finalPrice, currentSubscriptionId,
  })

  // ── Passo 2: linha de recuperação ANTES da sessão (fail-closed) ──
  // status 'pending' (NUNCA 'recovering': o polling exclui recovering e uma linha 'paid'
  // antiga escondida daria falso sucesso no fast-path do overlay).
  const { error: recErr } = await db
    .from('billing_checkouts')
    .upsert({
      profile_id: profileId,
      checkout_id: recoveryCheckoutId,
      asaas_customer_id: customerId,
      asaas_subscription_id: null,
      asaas_payment_id: null,
      planchange_attempt_id: attemptId,
      plan,
      cycle,
      status: 'pending',
      last_event: 'CARD_FALLBACK_PENDING',
      payment_method: 'plan_switch_fallback',
      original_price: proration.originalPrice,
      proration_credit: proration.credit,
      final_price: proration.finalPrice,
      asaas_checkout_session_id: null,
    }, { onConflict: 'checkout_id' })
  if (recErr) {
    logError('[card-fallback] Falha ao gravar linha de recuperação — abortando ANTES de criar a sessão (fail-closed)', recErr, { profileId, plan, cycle })
    return { ok: false, status: 500, error: 'Não foi possível iniciar o pagamento agora. Tente novamente.', code: 'CARD_FALLBACK_ROW_FAILED' }
  }

  // ── Passo 3: sessão DETACHED no Asaas ──
  let session: { id: string; url: string }
  try {
    session = await createDetachedCheckout({
      customerId,
      value: proration.finalPrice,
      name: `Mudança p/ Plano ${plan}`, // ≤30 chars (truncado defensivamente no helper)
      description: `EidosForm — Mudança para Plano ${plan} (${cycle === 'MONTHLY' ? 'Mensal' : 'Anual'}) — diferença prorateada`,
      successUrl: `${origin}/billing?checkout=success`,
      cancelUrl: `${origin}/billing?checkout=cancelled`,
      expiredUrl: `${origin}/billing?checkout=expired`,
    })
  } catch (err) {
    logError('[card-fallback] createDetachedCheckout FALHOU — linha cancelled, nada cobrado', err, {
      profileId, plan, cycle, value: proration.finalPrice,
    })
    // Best-effort: se ESTE update falhar a linha fica 'pending' e o cron a expira (90min).
    await db.from('billing_checkouts')
      .update({ status: 'cancelled', last_event: 'CARD_FALLBACK_CREATE_FAILED' })
      .eq('checkout_id', recoveryCheckoutId)
    return { ok: false, status: 502, error: 'Não foi possível abrir o pagamento agora. Tente novamente em instantes.', code: 'CARD_FALLBACK_CREATE_FAILED' }
  }

  // Session id persistido ANTES de entregar a URL — é o fio da correlação (gate 1).
  const { error: sessErr } = await db.from('billing_checkouts')
    .update({ asaas_checkout_session_id: session.id, last_event: 'CARD_FALLBACK_CHECKOUT_CREATED' })
    .eq('checkout_id', recoveryCheckoutId)
  if (sessErr) {
    logError('[card-fallback] Falha ao persistir asaas_checkout_session_id — NÃO devolvendo a URL (sessão órfã expira sozinha; correlação nunca fica cega)', sessErr, {
      profileId, sessionId: session.id,
    })
    return { ok: false, status: 503, error: 'Não foi possível confirmar o início do pagamento. Tente novamente em instantes.', code: 'CARD_FALLBACK_SESSION_SAVE_FAILED' }
  }

  log('[card-fallback] Sessão DETACHED criada e correlacionada', {
    profileId, sessionId: session.id, value: proration.finalPrice, reason,
  })
  return { ok: true, checkoutId: session.id, checkoutUrl: session.url }
}
