import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { PLANS } from '@/lib/plan-limits'
import { getEffectivePlan, type PlanId } from '@/lib/plans'
import { buildLeadData, logWhatsAppSend } from '@/lib/integration-stubs'
import { buildMessage, ABANDONED_LEAD_TEMPLATE } from '@/lib/whatsapp-template'
import { log, logError } from '@/lib/logger'

/**
 * CRON — Alerta de LEAD ABANDONADO por WhatsApp (pedido Sidney 2026-07-23).
 *
 * Um lead que começou a preencher, deixou dados úteis (telefone) e parou há mais
 * de ABANDONED_LEAD_MINUTES é um lead morno passando batido. Este cron acha esses
 * parciais e manda pro dono do form o MESMO tipo de notificação do lead completo,
 * marcada como "Lead incompleto".
 *
 * Desenho (com as travas da conversa de 23/07):
 * - SÓ dispara se houver TELEFONE utilizável (answers ou url_params) — abandono
 *   sem contato é alerta inútil ("opção C": só abandono acionável).
 * - Dedup DURÁVEL: 1 alerta por resposta, registrado em form_whatsapp_logs com
 *   status 'abandoned_alert' (não usa memória).
 * - Se o lead COMPLETAR depois do alerta, a notificação normal sai — o alerta
 *   nunca suprime o fluxo padrão.
 * - Gates idênticos ao envio normal: form_whatsapp_settings.enabled + plano Plus+
 *   (revalidado no /api/whatsapp/send via formId) + idempotência na VPS.
 * - Janela de segurança: só respostas paradas entre THRESHOLD e LOOKBACK (72h) —
 *   nunca ressuscita abandono antigo em massa.
 *
 * Agendado por systemd timer na VPS (eidosform-abandoned.timer, 15/15min) com
 * Authorization: Bearer CRON_SECRET — mesmo padrão dos crons de billing.
 */

const THRESHOLD_MIN = Number(process.env.ABANDONED_LEAD_MINUTES || 30)
const LOOKBACK_HOURS = 72
const BATCH_LIMIT = 20

export const dynamic = 'force-dynamic'

function admin() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } }
  )
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

  try {
    // 1) forms com WhatsApp ligado
    const { data: settingsRows } = await supabase
      .from('form_whatsapp_settings')
      .select('form_id, enabled, owner_phone')
      .eq('enabled', true)
    const enabledFormIds = (settingsRows ?? []).filter(s => s.owner_phone).map(s => s.form_id)
    if (enabledFormIds.length === 0) return NextResponse.json({ ok: true, ...stats })

    // 2) parciais parados na janela [lookback, cutoff]
    const { data: partials } = await supabase
      .from('responses')
      .select('id, form_id, answers, url_params, meta_events, updated_at')
      .eq('completed', false)
      .lt('updated_at', cutoffIso)
      .gt('updated_at', lookbackIso)
      .in('form_id', enabledFormIds)
      .order('updated_at', { ascending: true })
      .limit(BATCH_LIMIT * 3) // margem pros que serão filtrados (dedup/telefone)
    if (!partials || partials.length === 0) return NextResponse.json({ ok: true, ...stats })
    stats.candidatos = partials.length

    // 3) dedup durável: quem já recebeu 'abandoned_alert' sai da fila
    const responseIds = partials.map(p => p.id)
    const { data: alerted } = await supabase
      .from('form_whatsapp_logs')
      .select('response_id')
      .eq('status', 'abandoned_alert')
      .in('response_id', responseIds)
    const alreadyAlerted = new Set((alerted ?? []).map(a => a.response_id))

    // 4) dados dos forms + plano dos donos
    const formIds = [...new Set(partials.map(p => p.form_id))]
    const { data: forms } = await supabase
      .from('forms')
      .select('id, title, user_id, questions')
      .in('id', formIds)
    const formMap = new Map((forms ?? []).map(f => [f.id, f]))
    const ownerIds = [...new Set((forms ?? []).map(f => f.user_id))]
    const { data: owners } = await supabase
      .from('profiles')
      .select('id, plan, plan_expires_at')
      .in('id', ownerIds)
    const ownerPlanOk = new Map((owners ?? []).map(o => {
      const plan = getEffectivePlan(o) as PlanId
      return [o.id, Boolean(PLANS[plan]?.whatsappNotifications)]
    }))

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://eidosform.com.br'
    let sent = 0

    for (const partial of partials) {
      if (sent >= BATCH_LIMIT) break
      if (alreadyAlerted.has(partial.id)) { stats.jaAvisados += 1; continue }
      const form = formMap.get(partial.form_id)
      if (!form || !ownerPlanOk.get(form.user_id)) continue

      const minutosParado = Math.round((now - new Date(partial.updated_at as string).getTime()) / 60_000)
      const leadData = buildLeadData({
        formId: partial.form_id,
        responseId: partial.id,
        responseData: (partial.answers ?? {}) as Record<string, unknown>,
        meta_events: (partial.meta_events ?? []) as string[],
        urlParams: (partial.url_params ?? null) as Record<string, string> | null,
        form: form as { id: string; title: string | null; user_id: string; questions?: Array<{ id: string; title?: string; type?: string }> },
        appUrl,
      })
      leadData.abandono_minutos = String(minutosParado)

      // Trava: sem telefone utilizável, o alerta não é acionável — pula.
      const phoneDigits = String(leadData.phone ?? '').replace(/\D/g, '')
      if (phoneDigits.length < 10) { stats.semTelefone += 1; continue }

      const message = buildMessage(ABANDONED_LEAD_TEMPLATE, leadData)
      const settings = (settingsRows ?? []).find(s => s.form_id === partial.form_id)
      if (!settings?.owner_phone) continue

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
            formId: partial.form_id, // direct-send com formId = mantém o gate de plano
            idempotencyKey: `abandoned:${partial.form_id}:${partial.id}`,
          }),
        })
        const result = await res.json().catch(() => ({})) as { success?: boolean; messageId?: string; error?: string }
        if (res.ok && result.success) {
          // O log é o DEDUP — só marca quando realmente saiu.
          await logWhatsAppSend(partial.form_id, partial.id, 'abandoned_alert', result.messageId ?? null, null, phoneDigits)
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
    }

    log('[abandoned-leads] run', stats)
    return NextResponse.json({ ok: true, thresholdMin: THRESHOLD_MIN, ...stats })
  } catch (err) {
    logError('[abandoned-leads] run failed', err)
    return NextResponse.json({ ok: false, error: 'internal' }, { status: 500 })
  }
}
