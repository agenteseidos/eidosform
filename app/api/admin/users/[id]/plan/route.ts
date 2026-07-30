import { NextRequest, NextResponse } from 'next/server'
import { PLAN_ORDER, PlanId, normalizePlan } from '@/lib/plans'
import { getAdminSupabase, requireAdmin } from '@/lib/admin-auth'
import { PLANS, handleDowngrade, handleUpgrade } from '@/lib/plan-limits'
import { cancelSubscription } from '@/lib/asaas'
import { expiryFromNextDueDate } from '@/lib/billing-activation'
import { recordAdminAction } from '@/lib/admin-journal'
import { log, logError, logWarn } from '@/lib/logger'
import { buildResponseQuotaPeriodReset } from '@/lib/response-quota'
import { notifyPlanoAlterado, notifyAssinaturaCancelada, notifyAcessoAtualizado, planLabel, brDate } from '@/lib/whatsapp-confirmations'

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
  'id, email, plan, plan_cycle, plan_status, plan_expires_at, asaas_subscription_id, lifetime_access, responses_used, responses_limit'

type ProfileRow = {
  id: string
  email: string | null
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
      // Sincronização com a cobrança chega na Fase 4. Até lá, mover só a data
      // local de quem tem sub faz o painel prometer um prazo que o Asaas ignora.
      if (currentSub) {
        return NextResponse.json(
          { error: 'Este usuário tem assinatura ativa no Asaas. Ajustar a data local NÃO move a cobrança — a sincronização com o gateway chega na próxima fase do painel. Por ora, ajuste de data só para concessões manuais (sem assinatura).' },
          { status: 409 }
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

      // SÓ a data. Nada de cota, período, alerta, status ou forms (bug A1).
      const { error } = await supabase
        .from('profiles')
        .update({ plan_expires_at: expiryParsed.value })
        .eq('id', id)

      if (error) {
        return NextResponse.json({ error: 'Failed to update expiration' }, { status: 500 })
      }

      const { data: after } = await supabase
        .from('profiles').select(PROFILE_COLS).eq('id', id).single<ProfileRow>()

      // Confirmação ao cliente (decisão Sidney 30/07): ligada por padrão.
      let notified: { sent: boolean; skipped?: string } = { sent: false, skipped: 'not_requested' }
      if (notifyCustomer) {
        notified = await notifyAcessoAtualizado(id, { validUntil: brDate(expiryParsed.value) ?? undefined })
      }

      await recordAdminAction({
        actorId: auth.user.id,
        actorEmail: auth.user.email ?? '',
        targetUserId: id,
        targetEmail: currentProfile.email,
        action: 'expiry_adjust',
        reason,
        before,
        after: {
          plan_expires_at: after?.plan_expires_at ?? expiryParsed.value,
          customer_notified: notified.sent,
          ...(notified.skipped ? { notify_skipped: notified.skipped } : {}),
        },
      })

      return NextResponse.json({ success: true, user: after ? toApiUser(after) : null, warnings })
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
    let notified: { sent: boolean; skipped?: string } = { sent: false, skipped: 'not_requested' }
    if (notifyCustomer) {
      const fromLabel = planLabel(currentPlan, currentProfile.plan_cycle)
      if (newPlan === 'free') {
        notified = await notifyAssinaturaCancelada(id, {
          planLabel: fromLabel,
          accessUntil: 'hoje',
        })
      } else {
        const validade = brDate(expiryParsed.value as string) ?? 'a data combinada'
        notified = await notifyPlanoAlterado(id, {
          fromLabel,
          chargeInfo: `nenhuma — cortesia válida até ${validade}`,
        })
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
