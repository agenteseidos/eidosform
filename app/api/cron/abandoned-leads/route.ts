import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { PLANS } from '@/lib/plan-limits'
import { getEffectivePlan, type PlanId } from '@/lib/plans'
import { buildLeadData } from '@/lib/integration-stubs'
import { buildMessage, ABANDONED_LEAD_TEMPLATE } from '@/lib/whatsapp-template'
import { log, logError } from '@/lib/logger'

/**
 * CRON — Alerta de LEAD ABANDONADO por WhatsApp (pedido Sidney 2026-07-23).
 * REESCRITO após auditoria Codex (REPROVADO v1):
 *
 * P0-1: a v1 consultava `updated_at`, que NÃO EXISTE em produção, e engolia o
 * erro 42703 respondendo ok:true — um no-op mascarado. Agora:
 *  - Relógio = `last_activity_at` (migration manual aplicada 2026-07-23:
 *    coluna nova, DEFAULT now(), atualizada a cada autosave parcial em
 *    /api/responses/partial e /api/forms/[id]/partial-response) ⇒ semântica
 *    "PAROU DE MEXER há ≥N min", mais precisa que "começou" — pega quem ficou
 *    30min só na primeira pergunta OU quem avançou bastante e travou no fim.
 *  - TODA query checa `error` e o run responde 500 com o estágio que falhou.
 *    Nenhum erro de banco vira "ok" nunca mais.
 *
 * P1-3: dedup agora é CLAIM-FIRST — o marcador 'abandoned_alert' é inserido em
 * form_whatsapp_logs ANTES do envio (claim); falha no envio ⇒ marcador é
 * removido (libera retry no próximo run); falha na REMOÇÃO é logada como
 * crítica. Runs do timer são serializados pelo systemd (oneshot); a barreira
 * final contra corrida é a idempotencyKey coalescida na VPS.
 */

const THRESHOLD_MIN = Number(process.env.ABANDONED_LEAD_MINUTES || 30)
const LOOKBACK_HOURS = 72
// Cada envio leva ~5s (VPS serializa o wacli); o teto da função Vercel é 30s.
// Lote pequeno + guarda de tempo evitam o FUNCTION_INVOCATION_TIMEOUT (que, com
// claim-first, deixaria claims órfãos = leads suprimidos sem alerta). O timer de
// 15min drena o resto. Achado no teste real 23/07.
const BATCH_LIMIT = 4
const TIME_BUDGET_MS = 22_000

export const dynamic = 'force-dynamic'

function admin() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } }
  )
}

function fail(stage: string, error: unknown): NextResponse {
  logError(`[abandoned-leads] FALHA no estágio '${stage}'`, error)
  return NextResponse.json({ ok: false, stage, error: String((error as { message?: string })?.message ?? error).slice(0, 300) }, { status: 500 })
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = admin()
  const now = Date.now()
  const cutoffIso = new Date(now - THRESHOLD_MIN * 60_000).toISOString()
  const lookbackIso = new Date(now - LOOKBACK_HOURS * 3_600_000).toISOString()
  const stats = { candidatos: 0, enviados: 0, semTelefone: 0, jaAvisados: 0, falhas: 0 }

  // 1) forms com WhatsApp ligado
  const { data: settingsRows, error: settingsErr } = await supabase
    .from('form_whatsapp_settings')
    .select('form_id, enabled, owner_phone')
    .eq('enabled', true)
  if (settingsErr) return fail('settings', settingsErr)
  const enabledFormIds = (settingsRows ?? []).filter(s => s.owner_phone).map(s => s.form_id)
  if (enabledFormIds.length === 0) return NextResponse.json({ ok: true, ...stats })

  // 2) parciais SEM ATIVIDADE na janela [lookback, cutoff] e não finalizadas
  const { data: partials, error: partialsErr } = await supabase
    .from('responses')
    .select('id, form_id, answers, url_params, meta_events, last_activity_at')
    .eq('completed', false)
    .lt('last_activity_at', cutoffIso)
    .gt('last_activity_at', lookbackIso)
    .in('form_id', enabledFormIds)
    .order('last_activity_at', { ascending: true })
    .limit(BATCH_LIMIT * 3) // margem pros filtrados (dedup/telefone)
  if (partialsErr) return fail('partials', partialsErr)
  if (!partials || partials.length === 0) return NextResponse.json({ ok: true, ...stats })
  stats.candidatos = partials.length

  // 3) dedup durável: quem já tem claim 'abandoned_alert' sai da fila
  const responseIds = partials.map(p => p.id)
  const { data: alerted, error: alertedErr } = await supabase
    .from('form_whatsapp_logs')
    .select('response_id')
    .eq('status', 'abandoned_alert')
    .in('response_id', responseIds)
  if (alertedErr) return fail('dedup-select', alertedErr)
  const alreadyAlerted = new Set((alerted ?? []).map(a => a.response_id))

  // 4) dados dos forms + plano dos donos
  const formIds = [...new Set(partials.map(p => p.form_id))]
  const { data: forms, error: formsErr } = await supabase
    .from('forms')
    .select('id, title, user_id, questions')
    .in('id', formIds)
  if (formsErr) return fail('forms', formsErr)
  const formMap = new Map((forms ?? []).map(f => [f.id, f]))
  const ownerIds = [...new Set((forms ?? []).map(f => f.user_id))]
  const { data: owners, error: ownersErr } = await supabase
    .from('profiles')
    .select('id, plan, plan_expires_at')
    .in('id', ownerIds)
  if (ownersErr) return fail('owners', ownersErr)
  const ownerPlanOk = new Map((owners ?? []).map(o => {
    const plan = getEffectivePlan(o) as PlanId
    return [o.id, Boolean(PLANS[plan]?.whatsappNotifications)]
  }))

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://eidosform.com.br'
  const startedAt = Date.now()
  let sent = 0
  let cortadoPorTempo = false

  for (const partial of partials) {
    if (sent >= BATCH_LIMIT) break
    if (Date.now() - startedAt > TIME_BUDGET_MS) { cortadoPorTempo = true; break }
    if (alreadyAlerted.has(partial.id)) { stats.jaAvisados += 1; continue }
    const form = formMap.get(partial.form_id)
    if (!form || !ownerPlanOk.get(form.user_id)) continue

    const minutosDesdeInicio = Math.round((now - new Date(partial.last_activity_at as string).getTime()) / 60_000)
    const leadData = buildLeadData({
      formId: partial.form_id,
      responseId: partial.id,
      responseData: (partial.answers ?? {}) as Record<string, unknown>,
      meta_events: (partial.meta_events ?? []) as string[],
      urlParams: (partial.url_params ?? null) as Record<string, string> | null,
      form: form as { id: string; title: string | null; user_id: string; questions?: Array<{ id: string; title?: string; type?: string }> },
      appUrl,
    })
    leadData.abandono_minutos = String(minutosDesdeInicio)

    // Trava: sem telefone utilizável (mesma faixa do {whatsapp_link}: 10-15
    // dígitos), o alerta não é acionável — pula.
    const phoneDigits = String(leadData.phone ?? '').replace(/\D/g, '')
    if (phoneDigits.length < 10 || phoneDigits.length > 15) { stats.semTelefone += 1; continue }

    const message = buildMessage(ABANDONED_LEAD_TEMPLATE, leadData)
    const settings = (settingsRows ?? []).find(s => s.form_id === partial.form_id)
    if (!settings?.owner_phone) continue

    // 5) CLAIM-FIRST: reserva o marcador ANTES de enviar. Se o insert falhar,
    // NÃO envia (fail-closed). Se o envio falhar, remove o claim (retry no
    // próximo run); falha na remoção é crítica (alerta pode ficar suprimido).
    const { error: claimErr } = await (supabase as unknown as { from: (t: string) => { insert: (d: Record<string, unknown>) => Promise<{ error: unknown }> } })
      .from('form_whatsapp_logs')
      .insert({
        form_id: partial.form_id,
        response_id: partial.id,
        phone_number: phoneDigits,
        message_sent: '',
        status: 'abandoned_alert',
        wacli_message_id: null,
        error_message: null,
      })
    if (claimErr) { stats.falhas += 1; logError('[abandoned-leads] claim falhou — envio abortado', claimErr); continue }

    let sendOk = false
    try {
      const res = await fetch(`${appUrl}/api/whatsapp/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.INTERNAL_API_SECRET || ''}`,
        },
        body: JSON.stringify({
          to: settings.owner_phone,
          message,
          formId: partial.form_id, // direct-send com formId = gate de plano fail-closed
          idempotencyKey: `abandoned:${partial.form_id}:${partial.id}`,
        }),
      })
      const result = await res.json().catch(() => ({})) as { success?: boolean; messageId?: string; error?: string }
      sendOk = res.ok && result.success === true
      if (sendOk) {
        stats.enviados += 1
        sent += 1
      } else {
        stats.falhas += 1
        log('[abandoned-leads] send falhou', { responseId: partial.id, status: res.status, error: result.error ?? null })
      }
    } catch (err) {
      stats.falhas += 1
      logError('[abandoned-leads] erro no envio', err)
    }

    if (!sendOk) {
      // libera o claim pro retry — e grita se nem isso der certo
      const { error: unclaimErr } = await supabase
        .from('form_whatsapp_logs')
        .delete()
        .eq('response_id', partial.id)
        .eq('status', 'abandoned_alert')
      if (unclaimErr) logError('[abandoned-leads] CRÍTICO: claim órfão não removido — alerta deste response ficará suprimido', { responseId: partial.id, unclaimErr })
    }
  }

  log('[abandoned-leads] run', { ...stats, cortadoPorTempo })
  return NextResponse.json({ ok: true, thresholdMin: THRESHOLD_MIN, relogio: 'last_activity_at (última atividade real)', cortadoPorTempo, ...stats })
}
