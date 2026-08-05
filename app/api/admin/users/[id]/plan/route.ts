import { NextRequest, NextResponse } from 'next/server'
import { PLAN_ORDER, PlanId, normalizePlan } from '@/lib/plans'
import { getAdminSupabase, requireAdmin } from '@/lib/admin-auth'
import { PLANS, handleDowngrade, handleUpgrade } from '@/lib/plan-limits'
import { cancelSubscription, updateSubscription, getPendingPaymentsBySubscription, updatePaymentDueDate, hasConfirmedPaymentForSubscription } from '@/lib/asaas'
import { expiryFromNextDueDate } from '@/lib/billing-activation'
import { recordAdminAction } from '@/lib/admin-journal'
import { sendAccessUpdated, sendPlanActivated, sendPlanChanged, sendPlanCancelled, sendBillingOpsAlert } from '@/lib/resend'
import { log, logError, logWarn } from '@/lib/logger'
import { buildResponseQuotaPeriodReset } from '@/lib/response-quota'
import { notifyPlanoAlterado, notifyPlanoAtivado, notifyAssinaturaCancelada, notifyAcessoAtualizado, planLabel, brDate, firstName } from '@/lib/whatsapp-confirmations'

/**
 * PATCH /api/admin/users/[id]/plan — plano e expiração pelo painel admin.
 *
 * Reescrita 2026-07-30 (plano aprovado pelo Sidney, parecer Codex incorporado):
 *  - `reason` OBRIGATÓRIO em toda mutação (vai pro journal admin_actions);
 *  - ajuste de data SEM troca de plano NÃO reseta cota/período/alerta, NÃO força
 *    plan_status='active' e NÃO chama handleUpgrade (bug A1 + reativação
 *    acidental de conta `canceling`);
 *  - conta vitalícia (lifetime_access) → 409 no SERVIDOR (o trigger do banco já
 *    reverte, mas sem este guard a UI mostrava sucesso falso);
 *  - plano pago SEM expiração é proibido (grant eterno por omissão era o A4);
 *  - ajuste de data de quem TEM sub Asaas → 409 até a Fase 4 (sincronização com
 *    nextDueDate); hoje mover só a data local desalinha a cobrança;
 *  - expiração preferencialmente via `expiresOn: 'YYYY-MM-DD'`, convertida para
 *    fim do dia BRT NO SERVIDOR (expiryFromNextDueDate) — a conversão no
 *    navegador dependia do fuso do admin;
 *  - resposta devolve o perfil CANÔNICO relido do banco (mata o update otimista
 *    mentiroso da tabela);
 *  - →free continua cancelando a sub ANTES (fail-closed); se a escrita local
 *    falhar após o cancel no gateway, retenta e, persistindo, registra
 *    reconcile_required no journal (o efeito externo já ocorreu — não existe
 *    "desfazer" silencioso).
 */

function isValidPlan(value: unknown): value is PlanId {
  return typeof value === 'string' && (PLAN_ORDER as readonly string[]).includes(value)
}

type ExpiryParse =
  | { ok: true; value: string | null | undefined }
  | { ok: false; error: string }

/** YYYY-MM-DD + n dias (aritmética de calendário pura — sem fuso). */
function addDaysToDay(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().split('T')[0]
}

/** expiresOn 'YYYY-MM-DD' (preferido, fim do dia BRT) ou expiresAt ISO (legado). */
function parseExpiry(body: { expiresOn?: unknown; expiresAt?: unknown }): ExpiryParse {
  if (body.expiresOn !== undefined) {
    if (body.expiresOn === null) return { ok: true, value: null }
    if (typeof body.expiresOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.expiresOn)) {
      return { ok: false, error: 'expiresOn deve ser YYYY-MM-DD' }
    }
    const iso = expiryFromNextDueDate(body.expiresOn)
    if (!iso) return { ok: false, error: 'expiresOn deve ser uma data futura' }
    return { ok: true, value: iso }
  }
  if (body.expiresAt === undefined) return { ok: true, value: undefined }
  if (body.expiresAt === null) return { ok: true, value: null }
  if (typeof body.expiresAt !== 'string') {
    return { ok: false, error: 'expiresAt must be an ISO 8601 string or null' }
  }
  const date = new Date(body.expiresAt)
  if (Number.isNaN(date.getTime())) return { ok: false, error: 'expiresAt is not a valid date' }
  if (date.getTime() <= Date.now()) return { ok: false, error: 'expiresAt must be in the future' }
  return { ok: true, value: date.toISOString() }
}

const PROFILE_COLS =
  'id, email, full_name, plan, plan_cycle, plan_status, plan_expires_at, asaas_subscription_id, lifetime_access, responses_used, responses_limit'

type ProfileRow = {
  id: string
  email: string | null
  full_name: string | null
  plan: string | null
  plan_cycle: string | null
  plan_status: string | null
  plan_expires_at: string | null
  asaas_subscription_id: string | null
  lifetime_access: boolean | null
  responses_used: number | null
  responses_limit: number | null
}

function toApiUser(p: ProfileRow) {
  return {
    id: p.id,
    email: p.email,
    plan: normalizePlan(p.plan),
    planCycle: p.plan_cycle,
    planStatus: p.plan_status,
    planExpiresAt: p.plan_expires_at,
    lifetimeAccess: Boolean(p.lifetime_access),
    hasSubscription: Boolean(p.asaas_subscription_id),
    responsesUsed: p.responses_used ?? 0,
    responsesLimit: p.responses_limit ?? 0,
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  const { id } = await params

  let body: { plan?: unknown; expiresAt?: unknown; expiresOn?: unknown; reason?: unknown; notifyCustomer?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!isValidPlan(body.plan)) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
  }

  // Motivo obrigatório (decisão Sidney 30/07) — vai pro journal.
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (reason.length < 5) {
    return NextResponse.json(
      { error: 'Informe o motivo da alteração (mínimo 5 caracteres).' },
      { status: 400 }
    )
  }

  // Checkbox "Avisar o cliente" — LIGADA por padrão; só silencia com false explícito.
  const notifyCustomer = body.notifyCustomer !== false

  const expiryParsed = parseExpiry(body)
  if (!expiryParsed.ok) {
    return NextResponse.json({ error: expiryParsed.error }, { status: 400 })
  }

  const supabase = getAdminSupabase()
  const newPlan = body.plan

  try {
    const { data: currentProfile } = await supabase
      .from('profiles')
      .select(PROFILE_COLS)
      .eq('id', id)
      .single<ProfileRow>()

    if (!currentProfile) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })
    }

    // Conta vitalícia: o trigger do banco reverte qualquer escrita — sem este
    // guard a rota "funcionava" e a UI mostrava um estado que não aconteceu.
    if (currentProfile.lifetime_access) {
      return NextResponse.json(
        { error: 'Conta com acesso vitalício — não é alterável pelo painel. Mudanças só via SQL como postgres (por desenho).' },
        { status: 409 }
      )
    }

    const currentPlan = normalizePlan(currentProfile.plan)
    const currentSub = currentProfile.asaas_subscription_id
    const planChanged = newPlan !== currentPlan
    const planConfig = PLANS[newPlan]
    const isDowngrade = PLAN_ORDER.indexOf(newPlan) < PLAN_ORDER.indexOf(currentPlan)
    const before = {
      plan: currentPlan,
      plan_status: currentProfile.plan_status,
      plan_expires_at: currentProfile.plan_expires_at,
      plan_cycle: currentProfile.plan_cycle,
    }
    const warnings: string[] = []

    // ── Caminho 1: ajuste de expiração SEM troca de plano ────────────────────
    if (!planChanged) {
      if (newPlan === 'free') {
        return NextResponse.json(
          { error: 'Plano Free não tem expiração — nada a ajustar.' },
          { status: 400 }
        )
      }
      if (expiryParsed.value === undefined) {
        return NextResponse.json({ error: 'Informe a nova data de expiração.' }, { status: 400 })
      }
      if (expiryParsed.value === null) {
        return NextResponse.json(
          { error: 'Plano pago sem expiração não é permitido (só a conta vitalícia). Defina uma data.' },
          { status: 400 }
        )
      }

      // ── FASE 4 (mesa 2026-08-03; caracterização com sub REAL em 05/08): ajuste
      // SINCRONIZADO com o Asaas. Regra de ouro MEDIDA: cobrança já emitida
      // move-se INDIVIDUALMENTE (PUT no payment); a sub controla só a geração
      // FUTURA (nextDueDate = alvo + 1 ciclo); NUNCA alignPendingPaymentsDueDate
      // em bloco. `canceling` = sub já cancelada no gateway → ajuste é LOCAL.
      const needsSync = Boolean(currentSub) && currentProfile.plan_status !== 'canceling'
      let chargeMoved: { paymentId: string; from: string; to: string } | null = null

      if (needsSync) {
        // Anual: comportamento do gateway não caracterizado (matriz 05/08 só mensal).
        if ((currentProfile.plan_cycle ?? 'MONTHLY') !== 'MONTHLY') {
          return NextResponse.json(
            { error: 'Assinatura ANUAL: o ajuste sincronizado ainda não foi caracterizado com o gateway. Por ora, só assinaturas mensais.' },
            { status: 409 }
          )
        }
        const targetDay = String(body.expiresOn) // YYYY-MM-DD validado no parseExpiry
        const subNextDue = addDaysToDay(targetDay, 30) // geração futura = alvo + 1 ciclo nominal

        // Journal DURÁVEL: estado 'requested' ANTES de tocar o gateway — se o
        // processo morrer no meio, a trilha existe e aponta reconciliação.
        await recordAdminAction({
          actorId: auth.user.id, actorEmail: auth.user.email ?? '',
          targetUserId: id, targetEmail: currentProfile.email,
          action: 'expiry_adjust_sync', reason, state: 'requested', before,
          after: { target_day: targetDay, sub_next_due: subNextDue },
          subscriptionId: currentSub,
        })

        const pend = await getPendingPaymentsBySubscription(currentSub!)
        if (!pend.ok) {
          return NextResponse.json(
            { error: 'Não foi possível consultar as cobranças no Asaas agora. Nada foi alterado — tente novamente.' },
            { status: 503 }
          )
        }
        const charge = pend.payments.sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] ?? null
        if (!charge) {
          // Sem pendente: ou o período já foi CONFIRMADO (mover seria retroativo —
          // rejeita, ajuste só após a renovação emitir a próxima) ou não há nada a mover.
          const conf = await hasConfirmedPaymentForSubscription(currentSub!)
          const motivo = conf.confirmed
            ? 'A cobrança do período já está CONFIRMADA — ajuste retroativo é proibido. Faça o ajuste após a próxima cobrança ser emitida.'
            : 'Nenhuma cobrança pendente encontrada na assinatura — nada a sincronizar. Verifique a assinatura no Asaas.'
          await recordAdminAction({
            actorId: auth.user.id, actorEmail: auth.user.email ?? '',
            targetUserId: id, targetEmail: currentProfile.email,
            action: 'expiry_adjust_sync', reason, state: 'failed', before,
            after: { target_day: targetDay }, subscriptionId: currentSub,
            error: `rejeitado: ${motivo.slice(0, 180)}`,
          })
          return NextResponse.json({ error: motivo }, { status: 409 })
        }

        // Provider passo 1: move a COBRANÇA emitida. Falhou → nada mudou (fail-closed).
        try {
          await updatePaymentDueDate(charge.id, targetDay)
        } catch (err) {
          logError('[admin/plan] Fase 4: mover cobrança falhou — nada alterado', err, { userId: id, paymentId: charge.id })
          await recordAdminAction({
            actorId: auth.user.id, actorEmail: auth.user.email ?? '',
            targetUserId: id, targetEmail: currentProfile.email,
            action: 'expiry_adjust_sync', reason, state: 'failed', before,
            after: { target_day: targetDay }, subscriptionId: currentSub,
            error: String(err instanceof Error ? err.message : err).slice(0, 200),
          })
          return NextResponse.json(
            { error: 'Falha ao mover a cobrança no Asaas. Nada foi alterado — tente novamente.' },
            { status: 502 }
          )
        }
        chargeMoved = { paymentId: charge.id, from: charge.dueDate, to: targetDay }

        // Provider passo 2: geração futura da sub. Falhou → cobrança JÁ moveu ⇒
        // reconciliação obrigatória (nunca silêncio em efeito externo parcial).
        try {
          await updateSubscription(currentSub!, { nextDueDate: subNextDue })
        } catch (err) {
          logError('[admin/plan] Fase 4: cobrança movida mas sub NÃO — reconciliar', err, { userId: id, sub: currentSub })
          await recordAdminAction({
            actorId: auth.user.id, actorEmail: auth.user.email ?? '',
            targetUserId: id, targetEmail: currentProfile.email,
            action: 'expiry_adjust_sync', reason, state: 'reconcile_required', before,
            after: { target_day: targetDay, charge_moved: chargeMoved, sub_next_due_pending: subNextDue },
            subscriptionId: currentSub,
            error: `sub update failed: ${String(err instanceof Error ? err.message : err).slice(0, 180)}`,
          })
          void sendBillingOpsAlert({
            subject: 'Fase 4: cobrança movida mas nextDueDate da sub NÃO — reconciliar MANUALMENTE',
            lines: { userId: id, sub: currentSub, paymentId: charge.id, movedTo: targetDay, subShouldBe: subNextDue },
          }).catch(() => {})
          return NextResponse.json(
            { error: `A cobrança foi movida para ${brDate(expiryParsed.value)} mas a assinatura NÃO acompanhou — registrado para reconciliação. NÃO repita a ação; verifique o Asaas.` },
            { status: 502 }
          )
        }
      }

      // Escrita local (data). Com sync feito, falha aqui = reconciliação (gateway já moveu).
      const { error } = await supabase
        .from('profiles')
        .update({ plan_expires_at: expiryParsed.value })
        .eq('id', id)

      if (error) {
        if (needsSync) {
          await recordAdminAction({
            actorId: auth.user.id, actorEmail: auth.user.email ?? '',
            targetUserId: id, targetEmail: currentProfile.email,
            action: 'expiry_adjust_sync', reason, state: 'reconcile_required', before,
            after: { charge_moved: chargeMoved, local_write: 'failed' }, subscriptionId: currentSub,
            error: 'local write failed após mover gateway',
          })
          void sendBillingOpsAlert({
            subject: 'Fase 4: gateway movido mas perfil local NÃO — reconciliar',
            lines: { userId: id, sub: currentSub, chargeMoved: JSON.stringify(chargeMoved) },
          }).catch(() => {})
          return NextResponse.json(
            { error: 'O Asaas foi atualizado, mas o perfil local não — registrado para reconciliação. NÃO repita a ação.' },
            { status: 500 }
          )
        }
        return NextResponse.json({ error: 'Failed to update expiration' }, { status: 500 })
      }

      const { data: after } = await supabase
        .from('profiles').select(PROFILE_COLS).eq('id', id).single<ProfileRow>()

      // Confirmação ao cliente (decisão Sidney 30/07 + premissa P1 da mesa:
      // e-mail e WhatsApp são ESPELHOS, mesma checkbox).
      let notified: { sent: boolean; skipped?: string } = { sent: false, skipped: 'not_requested' }
      let emailNotified = false
      if (notifyCustomer) {
        const validade = brDate(expiryParsed.value) ?? 'a data definida'
        notified = await notifyAcessoAtualizado(id, { validUntil: validade })
        if (currentProfile.email) {
          const r = await sendAccessUpdated({
            to: currentProfile.email,
            name: firstName(currentProfile.full_name),
            plan: planLabel(currentPlan, currentProfile.plan_cycle),
            validUntil: validade,
          }).catch(() => ({ error: 'send failed' }))
          emailNotified = !('error' in (r ?? {})) || !(r as { error?: string }).error
        }
      }

      await recordAdminAction({
        actorId: auth.user.id,
        actorEmail: auth.user.email ?? '',
        targetUserId: id,
        targetEmail: currentProfile.email,
        action: needsSync ? 'expiry_adjust_sync' : 'expiry_adjust',
        reason,
        state: 'completed',
        before,
        after: {
          plan_expires_at: after?.plan_expires_at ?? expiryParsed.value,
          customer_notified: notified.sent,
          customer_notified_email: emailNotified,
          ...(chargeMoved ? { charge_moved: chargeMoved } : {}),
          ...(notified.skipped ? { notify_skipped: notified.skipped } : {}),
        },
        subscriptionId: currentSub,
      })

      return NextResponse.json({
        success: true,
        user: after ? toApiUser(after) : null,
        warnings,
        ...(chargeMoved ? { chargeMoved: { from: brDate(`${chargeMoved.from}T12:00:00Z`), to: brDate(`${chargeMoved.to}T12:00:00Z`) } } : {}),
      })
    }

    // ── Caminho 2: troca de plano ────────────────────────────────────────────

    // Troca PAGO→PAGO de quem tem sub: continua proibida (P1 Codex 06/08). A
    // mensagem NÃO sugere mais "mover pra free primeiro" — isso cancelaria a
    // recorrência e podia cortar acesso/crédito pago (parecer Codex 30/07).
    if (newPlan !== 'free' && currentSub) {
      return NextResponse.json(
        { error: 'Usuário tem assinatura ativa no Asaas. Troca de plano pelo admin desalinharia a cobrança. O caminho correto é o próprio usuário trocar em /billing (o fluxo calcula proração e ajusta a assinatura).' },
        { status: 409 }
      )
    }

    // Grant pago manual EXIGE expiração explícita (mata o A4 na origem).
    if (newPlan !== 'free' && (expiryParsed.value === undefined || expiryParsed.value === null)) {
      return NextResponse.json(
        { error: 'Concessão de plano pago exige data de expiração (plano pago eterno só a conta vitalícia).' },
        { status: 400 }
      )
    }

    // →free com sub: cancela no gateway ANTES, fail-closed (P0 Codex 06/08).
    if (newPlan === 'free' && currentSub) {
      try {
        await cancelSubscription(currentSub)
        log('[admin/plan] Assinatura cancelada no Asaas ao mover usuário p/ free', { userId: id, subscriptionId: currentSub })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (/error 404/i.test(msg)) {
          logWarn('[admin/plan] Sub já removida no Asaas (404) — prosseguindo', { userId: id, subscriptionId: currentSub })
        } else {
          logError('[admin/plan] Falha ao cancelar sub no Asaas — downgrade NÃO aplicado (fail-closed)', err, { userId: id, subscriptionId: currentSub })
          return NextResponse.json(
            { error: 'Falha ao cancelar a assinatura no Asaas. Downgrade NÃO aplicado para evitar cobrança órfã. Tente novamente.' },
            { status: 502 }
          )
        }
      }
    }

    const updatePayload = {
      plan: newPlan,
      responses_limit: planConfig?.maxResponses ?? 100,
      ...buildResponseQuotaPeriodReset(),
      limit_alert_sent: false,
      ...(newPlan === 'free'
        ? { plan_status: 'cancelled', plan_cycle: null, asaas_subscription_id: null, annual_started_at: null, plan_expires_at: null }
        : { plan_status: 'active', plan_expires_at: expiryParsed.value }),
    }

    // Escrita local com UMA retentativa: se o cancel no Asaas já ocorreu, o
    // efeito externo é irreversível — falhar aqui exige reconciliação, não
    // silêncio (parecer Codex 30/07: "isso já não é fail-closed").
    let writeError: unknown = null
    for (let attempt = 1; attempt <= 2; attempt++) {
      const { error } = await supabase.from('profiles').update(updatePayload).eq('id', id)
      writeError = error
      if (!error) break
    }
    if (writeError) {
      const subCancelled = newPlan === 'free' && currentSub
      logError('[admin/plan] Escrita local falhou após 2 tentativas', writeError, { userId: id, subCancelled })
      await recordAdminAction({
        actorId: auth.user.id,
        actorEmail: auth.user.email ?? '',
        targetUserId: id,
        targetEmail: currentProfile.email,
        action: 'plan_change',
        reason,
        state: subCancelled ? 'reconcile_required' : 'failed',
        before,
        after: null,
        subscriptionId: currentSub,
        error: `local write failed: ${writeError instanceof Error ? writeError.message : JSON.stringify(writeError)}`,
      })
      return NextResponse.json(
        {
          error: subCancelled
            ? 'A assinatura FOI cancelada no Asaas, mas o perfil local não foi atualizado. Registrado para reconciliação — não repita a ação sem verificar.'
            : 'Failed to update user plan',
        },
        { status: 500 }
      )
    }

    // Pausar/despausar forms: SÓ quando o plano mudou de verdade.
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (serviceKey) {
      try {
        if (isDowngrade) {
          const result = await handleDowngrade(id, serviceKey, newPlan)
          log('[admin/plan] Downgrade processed', { userId: id, pausedForms: result.pausedCount })
        } else if (newPlan !== 'free') {
          const result = await handleUpgrade(id, serviceKey)
          log('[admin/plan] Upgrade processed', { userId: id, unpausedForms: result.unpausedCount })
        }
      } catch (err) {
        // Não silencia mais: vira warning visível pro admin + journal.
        logError('[admin/plan] handleUpgrade/handleDowngrade falhou', err, { userId: id, newPlan })
        warnings.push(
          isDowngrade
            ? 'Plano alterado, mas a pausa automática de formulários falhou — confira os forms deste usuário.'
            : 'Plano alterado, mas o despause automático de formulários falhou — confira os forms deste usuário.'
        )
      }
    }

    const { data: after } = await supabase
      .from('profiles').select(PROFILE_COLS).eq('id', id).single<ProfileRow>()

    // Confirmação ao cliente por mapeamento (decisão Sidney 30/07):
    //  → free           = assinatura_cancelada (acesso encerra hoje)
    //  → grant pago     = plano_alterado, com "Próxima cobrança" preenchida
    //                     como cortesia (grants não têm cobrança; quem tem sub
    //                     nem chega aqui — 409 acima).
    // Mapa ação→confirmação (decisão Sidney 30/07 + premissa P1 da mesa 03/08:
    // e-mail SEMPRE espelha o WhatsApp, mesma checkbox):
    //  → free            = assinatura_cancelada (+ e-mail)
    //  → grant NOVO      = plano_ativado (+ e-mail) — conta vinha do free
    //  → troca de grant  = plano_alterado (+ e-mail)
    let notified: { sent: boolean; skipped?: string } = { sent: false, skipped: 'not_requested' }
    let emailNotified = false
    if (notifyCustomer) {
      const fromLabel = planLabel(currentPlan, currentProfile.plan_cycle)
      const toLabel = planLabel(newPlan, null)
      const saudacao = firstName(currentProfile.full_name)
      const email = currentProfile.email
      const markEmail = (r: unknown) => { emailNotified = !(r && typeof r === 'object' && 'error' in r && (r as { error?: string }).error) }
      if (newPlan === 'free') {
        notified = await notifyAssinaturaCancelada(id, {
          planLabel: fromLabel,
          accessUntil: 'hoje',
        })
        if (email) markEmail(await sendPlanCancelled({ to: email, name: saudacao, plan: fromLabel }).catch(() => ({ error: 'send failed' })))
      } else if (currentPlan === 'free') {
        const validade = brDate(expiryParsed.value as string) ?? 'a data combinada'
        notified = await notifyPlanoAtivado(id, {
          chargeInfo: `nenhuma — cortesia válida até ${validade}`,
        })
        if (email) markEmail(await sendPlanActivated({ to: email, name: saudacao, plan: toLabel }).catch(() => ({ error: 'send failed' })))
      } else {
        const validade = brDate(expiryParsed.value as string) ?? 'a data combinada'
        notified = await notifyPlanoAlterado(id, {
          fromLabel,
          chargeInfo: `nenhuma — cortesia válida até ${validade}`,
        })
        if (email) markEmail(await sendPlanChanged({ to: email, name: saudacao, fromPlan: fromLabel, toPlan: toLabel, nextCharge: `nenhuma — cortesia válida até ${validade}` }).catch(() => ({ error: 'send failed' })))
      }
    }

    await recordAdminAction({
      actorId: auth.user.id,
      actorEmail: auth.user.email ?? '',
      targetUserId: id,
      targetEmail: currentProfile.email,
      action: 'plan_change',
      reason,
      before,
      after: after
        ? {
            plan: after.plan, plan_status: after.plan_status, plan_expires_at: after.plan_expires_at,
            customer_notified: notified.sent,
            customer_notified_email: emailNotified,
            ...(notified.skipped ? { notify_skipped: notified.skipped } : {}),
          }
        : null,
      subscriptionId: currentSub,
      error: warnings.length ? warnings.join(' | ') : null,
    })

    return NextResponse.json({ success: true, user: after ? toApiUser(after) : null, warnings })
  } catch (err) {
    console.error('[admin/plan] Update error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
