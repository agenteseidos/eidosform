import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { buildNotificationModel } from '@/lib/notification-model'
import { buildAbandonedLeadEmail } from '@/lib/notification-content'
import { resolveEmailRecipients, buildEmailIdempotencyKey, type EmailRecipient } from '@/lib/notification-email'
import { sendLeadNotificationEmail } from '@/lib/resend'
import { getEffectivePlan } from '@/lib/plans'
import { PLANS } from '@/lib/plan-definitions'
import { log, logError } from '@/lib/logger'
// Reaproveitados do cron de WhatsApp SEM alterá-lo: são funções puras, sem I/O,
// e a varredura por cursor é justamente a parte que já custou uma starvation em
// produção (P1-1). Reescrevê-la aqui seria repetir o bug, não evitá-lo.
import { scanForCandidates, parseThresholdMin, type ScanRow, type ClaimState } from '../abandoned-leads/route'
// Canônicas na lib desde o corte "sem fila retroativa" (2026-08-05): o baseline
// da ativação de chave (lib/notification-baseline.ts) usa EXATAMENTE o mesmo
// hash e o mesmo filtro de conteúdo que este cron — divergir os dois deixaria
// acervo vazar ou lead legítimo calado. Re-exportadas para os testes daqui.
import { hasAnsweredSomething, recipientHash } from '@/lib/notification-baseline'
export { hasAnsweredSomething, recipientHash }

/**
 * CRON — Alerta de LEAD ABANDONADO por E-MAIL (Entrega 2).
 *
 * Avisa o dono quando alguém COMEÇOU a preencher e PAROU, com o que já foi
 * respondido, a tempo de recuperar o lead. Até aqui isso só existia por
 * WhatsApp — ou seja, só na conta do Sidney; nenhum cliente pagante recebia.
 *
 * ─── POR QUE UM ENDPOINT SEPARADO, E NÃO "só adicionar e-mail" no outro ──────
 *
 * 1. O cron de WhatsApp SELECIONA a partir de `form_whatsapp_settings` com
 *    `enabled = true`. Formulário sem WhatsApp configurado nunca é considerado —
 *    e é exatamente esse o universo que o e-mail precisa alcançar.
 * 2. Ele marca "já avisei" em `form_whatsapp_logs`. Dividir esse marcador faria
 *    o envio de um canal calar o outro.
 * 3. O filtro de elegibilidade dele exige TELEFONE (`isActionable`). Reutilizar
 *    descartaria todo lead perfeitamente notificável por e-mail.
 * 4. Os limites dele (BATCH_LIMIT=4 ⇒ teto de 16 alertas/hora) foram calibrados
 *    para o custo de um envio de WhatsApp. E-mail é ordens de grandeza mais
 *    barato e não herda esse teto.
 *
 * O cron de WhatsApp fica INTACTO — este arquivo não o edita, só importa duas
 * funções puras dele.
 *
 * ─── CICLO DE VIDA DO CLAIM ─────────────────────────────────────────────────
 *
 * Uma linha em `form_notification_logs` por (resposta, evento, canal,
 * DESTINATÁRIO), garantida pelo índice único `uniq_notification_per_recipient`:
 *   pending = adquirido, envio não confirmado (lease em created_at)
 *   sent    = entregue ao provedor
 *   failed  = falha terminal, NÃO retentada (o sender já tenta 3x sozinho —
 *             retentar aqui traria de volta o "martelo" de 27/07)
 *
 * Por DESTINATÁRIO porque uma resposta pode gerar dois e-mails legítimos (dono
 * + endereço extra). Quando os dois normalizam para o mesmo endereço, a
 * deduplicação acontece ANTES do claim e existe um só.
 */

const LOOKBACK_HOURS = 72
/**
 * Teto de leads alertados por execução. NÃO herda o 4 do WhatsApp: aquele valor
 * existe porque cada envio de WhatsApp é caro e arriscado para a linha. Com o
 * timer de 15 min, 25 dá 100 alertas/hora — folga real para uma campanha que
 * está captando, sem virar varredura sem fim.
 */
const BATCH_LIMIT = 25
const PAGE_SIZE = 50
const MAX_PAGES = 20
/** Claim PENDENTE mais velho que isto é considerado morto e pode ser retomado. */
const LEASE_MS = 10 * 60_000
/** vercel.json fixa maxDuration=30s para app/api/**. */
const ROUTE_BUDGET_MS = 25_000
/** E-mail é rápido (timeout de 10s no sender), mas não começa sem folga. */
const MIN_SEND_BUDGET_MS = 4_000

const EVENT_TYPE = 'abandoned'
const CHANNEL = 'email'

export const dynamic = 'force-dynamic'

function admin() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } }
  )
}

function fail(stage: string, error: unknown): NextResponse {
  logError(`[abandoned-email] FALHA no estágio '${stage}'`, error)
  return NextResponse.json(
    { ok: false, stage, error: String((error as { message?: string })?.message ?? error).slice(0, 300) },
    { status: 500 }
  )
}

/** Igual ao do cron de WhatsApp: PostgREST e JS formatam ISO diferente. */
function toMs(value: unknown): number {
  const ms = new Date(String(value)).getTime()
  return Number.isFinite(ms) ? ms : -Infinity
}

interface EligibleForm {
  id: string
  title: string | null
  user_id: string
  questions?: Array<{ id: string; title?: string; type?: string }>
  recipients: EmailRecipient[]
}

interface ClaimRow {
  response_id: string
  form_id: string
  recipient_role: string
  status: string
  created_at: string
}

/**
 * Traduz os claims POR DESTINATÁRIO para o estado POR RESPOSTA que a varredura
 * compartilhada entende.
 *
 * A varredura foi escrita para o WhatsApp, que tem um claim por resposta, e
 * enxerga `{ wacli_message_id, created_at }`: id preenchido = terminal (pula),
 * nulo + created_at velho = pendência morta (retomável). Aqui esses campos são
 * só o formato do adaptador — quem manda no envio é o claim de cada
 * destinatário, resolvido individualmente mais adiante.
 *
 * Regra: a resposta só é considerada RESOLVIDA quando TODOS os destinatários
 * atuais dela têm claim terminal ou pendência dentro do lease. Se um novo
 * destinatário foi configurado depois do primeiro aviso, a resposta volta a ser
 * candidata — e só o destinatário sem claim receberá.
 */
export function claimStateForResponse(
  claims: ClaimRow[],
  recipientCount: number,
  leaseCutoffMs: number
): ClaimState | undefined {
  if (recipientCount === 0) return { wacli_message_id: 'sem-destinatario', created_at: new Date(0).toISOString() }
  let resolved = 0
  let oldestStale: string | null = null
  for (const c of claims) {
    if (c.status === 'sent' || c.status === 'failed') { resolved += 1; continue }
    if (c.status === 'pending') {
      if (toMs(c.created_at) >= leaseCutoffMs) resolved += 1
      else if (oldestStale === null || toMs(c.created_at) < toMs(oldestStale)) oldestStale = c.created_at
    }
  }
  if (oldestStale !== null) return { wacli_message_id: null, created_at: oldestStale }
  if (resolved >= recipientCount) return { wacli_message_id: 'resolvido', created_at: new Date().toISOString() }
  return undefined
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const routeStart = Date.now()
  const budgetLeft = () => ROUTE_BUDGET_MS - (Date.now() - routeStart)

  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Mesmo threshold do canal WhatsApp: "abandonado" é uma definição do produto,
  // não do canal. Fail-closed se vier inválido (P2-8).
  const thresholdMin = parseThresholdMin(process.env.ABANDONED_LEAD_MINUTES)
  if (thresholdMin === null) {
    return fail('config', new Error('ABANDONED_LEAD_MINUTES inválido (inteiro entre 5 e 1440)'))
  }

  const supabase = admin()
  const now = Date.now()
  const cutoffIso = new Date(now - thresholdMin * 60_000).toISOString()
  const lookbackIso = new Date(now - LOOKBACK_HOURS * 3_600_000).toISOString()
  const leaseCutoffIso = new Date(now - LEASE_MS).toISOString()
  const leaseCutoffMs = now - LEASE_MS

  const stats = {
    examinados: 0, enviados: 0, semConteudo: 0, jaAvisados: 0,
    falhas: 0, paginas: 0, retomados: 0, revalidadosFora: 0, destinatarios: 0,
  }
  let cortadoPorTempo = false
  let varreduraCompleta = false

  // 1) DONOS ELEGÍVEIS. O gate é o plano do dono (Plus+), não uma configuração
  //    por formulário: `notify_email_enabled` apenas ACRESCENTA destinatário,
  //    nunca é o que liga a notificação (mesma regra do e-mail de resposta
  //    completa em app/api/responses/route.ts).
  const eligiblePlanIds = (Object.keys(PLANS) as Array<keyof typeof PLANS>)
    .filter((id) => PLANS[id].abandonedLeadAlert)
  const { data: profiles, error: profilesErr } = await supabase
    .from('profiles')
    .select('id, email, plan, plan_expires_at')
    .in('plan', eligiblePlanIds as string[])
  if (profilesErr) return fail('profiles', profilesErr)

  // `in('plan', ...)` corta no banco; getEffectivePlan refina — um Plus VENCIDO
  // ainda tem plan='plus' na coluna e não pode receber.
  const ownerEmailById = new Map<string, string>()
  for (const p of profiles ?? []) {
    const effective = getEffectivePlan(p as { plan?: string | null; plan_expires_at?: string | null })
    if (!PLANS[effective]?.abandonedLeadAlert) continue
    ownerEmailById.set(p.id as string, (p.email as string | null) ?? '')
  }
  if (ownerEmailById.size === 0) {
    return NextResponse.json({ ok: true, thresholdMin, varreduraCompleta: true, ...stats })
  }

  const { data: formRows, error: formsErr } = await supabase
    .from('forms')
    .select('id, title, user_id, questions, notify_email, notify_email_enabled, notify_owner_enabled')
    .in('user_id', [...ownerEmailById.keys()])
  if (formsErr) return fail('forms', formsErr)

  // Resolver destinatários AQUI (antes da varredura) tira do caminho os
  // formulários que não têm para quem mandar — sem isso eles ocupariam vaga no
  // lote e seriam descartados depois, recriando a starvation por outro caminho.
  const formMap = new Map<string, EligibleForm>()
  for (const f of formRows ?? []) {
    const recipients = resolveEmailRecipients({
      ownerEmail: ownerEmailById.get(f.user_id as string),
      notifyEmail: f.notify_email as string | null,
      notifyEmailEnabled: f.notify_email_enabled as boolean | null,
      notifyOwnerEnabled: f.notify_owner_enabled as boolean | null,
    })
    if (recipients.length === 0) continue
    formMap.set(f.id as string, {
      id: f.id as string,
      title: (f.title as string | null) ?? null,
      user_id: f.user_id as string,
      questions: f.questions as Array<{ id: string; title?: string; type?: string }> | undefined,
      recipients,
    })
  }
  const actionableFormIds = [...formMap.keys()]
  if (actionableFormIds.length === 0) {
    return NextResponse.json({ ok: true, thresholdMin, varreduraCompleta: true, ...stats })
  }

  // 2) VARREDURA POR CURSOR (a mesma do WhatsApp, com política própria).
  let scanFailure: unknown = null
  const scan = await scanForCandidates(
    {
      budgetLeft,
      isActionable: (r) => hasAnsweredSomething(r.answers),
      fetchPage: async (cursor, limit) => {
        const { data, error } = await supabase
          .from('responses')
          .select('id, form_id, answers, url_params, meta_events, last_activity_at, utm_source, utm_medium, utm_campaign, utm_term, utm_content')
          .eq('completed', false)
          .gte('last_activity_at', cursor)
          .lt('last_activity_at', cutoffIso)
          .in('form_id', actionableFormIds)
          .order('last_activity_at', { ascending: true })
          .limit(limit)
        if (error) { scanFailure = { stage: 'partials', error }; return [] }
        return (data ?? []) as unknown as ScanRow[]
      },
      fetchClaims: async (ids) => {
        const { data, error } = await supabase
          .from('form_notification_logs')
          .select('response_id, form_id, recipient_role, status, created_at')
          .eq('event_type', EVENT_TYPE)
          .eq('channel', CHANNEL)
          .in('response_id', ids)
        if (error) { scanFailure = { stage: 'dedup-select', error }; return new Map() }
        const byResponse = new Map<string, ClaimRow[]>()
        for (const c of (data ?? []) as unknown as ClaimRow[]) {
          const list = byResponse.get(c.response_id) ?? []
          list.push(c)
          byResponse.set(c.response_id, list)
        }
        const out = new Map<string, ClaimState>()
        for (const id of ids) {
          const claims = byResponse.get(id) ?? []
          // Sem claim nenhum ⇒ candidato fresco; não entra no mapa.
          if (claims.length === 0) continue
          // Quantos destinatários a resposta tem HOJE (o formulário pode ter
          // ganhado um endereço extra depois do primeiro aviso).
          const recipientCount = formMap.get(claims[0].form_id)?.recipients.length ?? claims.length
          const state = claimStateForResponse(claims, recipientCount, leaseCutoffMs)
          if (state) out.set(id, state)
        }
        return out
      },
    },
    {
      startCursor: lookbackIso,
      batchLimit: BATCH_LIMIT,
      pageSize: PAGE_SIZE,
      maxPages: MAX_PAGES,
      leaseCutoffIso,
      minBudgetMs: MIN_SEND_BUDGET_MS,
    }
  )
  if (scanFailure) {
    const f = scanFailure as { stage: string; error: unknown }
    // Tabela ausente = migração manual ainda não rodou. Falha ALTA e explícita:
    // silenciar aqui viraria "cron verde que nunca alerta ninguém".
    if (String((f.error as { code?: string })?.code) === '42P01') {
      return fail('migracao-ausente', new Error(
        'Tabela form_notification_logs não existe — rode supabase/migrations-manual/2026-07-30-alerta-abandono-email.sql'
      ))
    }
    return fail(f.stage, f.error)
  }

  stats.examinados = scan.examinados
  stats.jaAvisados = scan.jaAvisados
  stats.semConteudo = scan.naoAcionaveis
  stats.paginas = scan.paginas
  varreduraCompleta = scan.varreduraCompleta
  cortadoPorTempo = scan.cortadoPorTempo

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://eidosform.com.br'

  // 3) Processa os candidatos.
  for (const { row } of scan.picked) {
    if (budgetLeft() < MIN_SEND_BUDGET_MS) { cortadoPorTempo = true; break }

    const form = formMap.get(row.form_id)
    if (!form) continue

    // 3a) ADQUIRE OS CLAIMS — um por destinatário, atômico via índice único.
    const acquired: EmailRecipient[] = []
    for (const recipient of form.recipients) {
      const { error: insertErr } = await (supabase as unknown as {
        from: (t: string) => { insert: (d: Record<string, unknown>) => Promise<{ error: { code?: string } | null }> }
      }).from('form_notification_logs').insert({
        response_id: row.id,
        form_id: row.form_id,
        event_type: EVENT_TYPE,
        channel: CHANNEL,
        recipient_role: recipient.role,
        recipient_hash: recipientHash(recipient.email),
        status: 'pending',
        attempts: 1,
      })

      if (!insertErr) { acquired.push(recipient); continue }
      if (insertErr.code !== '23505') {
        stats.falhas += 1
        logError('[abandoned-email] claim falhou', { responseId: row.id, role: recipient.role, insertErr })
        continue
      }

      // 23505: já existe claim. Só segue quem conseguir RETOMAR uma pendência
      // morta — o UPDATE condicional é o que impede dois runs simultâneos de
      // enviarem o mesmo alerta.
      const { data: retaken, error: retakeErr } = await supabase
        .from('form_notification_logs')
        .update({ created_at: new Date().toISOString(), error_message: 'lease retomado' })
        .eq('response_id', row.id)
        .eq('event_type', EVENT_TYPE)
        .eq('channel', CHANNEL)
        .eq('recipient_role', recipient.role)
        .eq('status', 'pending')
        .lt('created_at', leaseCutoffIso)
        .select('id')
      if (retakeErr) {
        stats.falhas += 1
        logError('[abandoned-email] retake falhou', { responseId: row.id, role: recipient.role, retakeErr })
        continue
      }
      if ((retaken ?? []).length === 1) {
        acquired.push(recipient)
        stats.retomados += 1
      } else {
        stats.jaAvisados += 1
      }
    }
    if (acquired.length === 0) continue

    // 3b) REVALIDA: entre o SELECT e o envio o lead pode ter retomado ou
    //     completado o formulário — mandar "lead incompleto" nesse caso é o
    //     tipo de erro que queima a confiança no aviso.
    const { data: current, error: recheckErr } = await supabase
      .from('responses')
      .select('id, completed, last_activity_at, answers, url_params, meta_events, utm_source, utm_medium, utm_campaign, utm_term, utm_content')
      .eq('id', row.id)
      .maybeSingle() as {
        data: {
          id: string; completed: boolean; last_activity_at: string; answers: unknown
          url_params: unknown; meta_events: unknown
          utm_source: string | null; utm_medium: string | null; utm_campaign: string | null
          utm_term: string | null; utm_content: string | null
        } | null
        error: unknown
      }

    const cutoffMs = now - thresholdMin * 60_000
    const aindaAbandonado =
      !recheckErr && current && current.completed === false && toMs(current.last_activity_at) < cutoffMs
    if (!aindaAbandonado) {
      stats.revalidadosFora += 1
      await releaseClaims(supabase, row.id, acquired)
      continue
    }

    // 3c) Monta o e-mail UMA vez, com os dados FRESCOS da revalidação.
    const inactiveMinutes = Math.round((Date.now() - toMs(current.last_activity_at)) / 60_000)
    const model = buildNotificationModel({
      formId: row.form_id,
      responseId: row.id,
      responseData: (current.answers ?? {}) as Record<string, unknown>,
      form: { id: form.id, title: form.title, user_id: form.user_id, questions: form.questions },
      appUrl,
      // Relógio do ABANDONO é a última atividade — nunca submitted_at (a
      // resposta nem foi enviada) e nunca o instante do envio do aviso.
      eventAt: current.last_activity_at,
      inactiveMinutes,
      metaEvents: (current.meta_events ?? []) as string[],
      urlParams: (current.url_params ?? null) as Record<string, string> | null,
      utm: {
        utm_source: current.utm_source, utm_medium: current.utm_medium,
        utm_campaign: current.utm_campaign, utm_term: current.utm_term,
        utm_content: current.utm_content,
      },
    })
    const content = buildAbandonedLeadEmail(model)

    // 3d) Envia por destinatário e fecha cada claim individualmente.
    for (const recipient of acquired) {
      const result = await sendLeadNotificationEmail({
        to: recipient.email,
        subject: content.subject,
        html: content.html,
        text: content.text,
        idempotencyKey: buildEmailIdempotencyKey({
          event: 'abandoned', formId: row.form_id, responseId: row.id, email: recipient.email,
        }),
      })
      stats.destinatarios += 1

      const patch = result.error
        ? { status: 'failed', error_message: String(result.error).slice(0, 300) }
        : { status: 'sent', provider_message_id: result.id ?? null, error_message: null }
      if (result.error) stats.falhas += 1
      else stats.enviados += 1

      const { error: closeErr } = await supabase
        .from('form_notification_logs')
        .update(patch)
        .eq('response_id', row.id)
        .eq('event_type', EVENT_TYPE)
        .eq('channel', CHANNEL)
        .eq('recipient_role', recipient.role)
      if (closeErr) {
        // Claim fica PENDENTE e vira retomável em LEASE_MS. Não duplica de
        // verdade: a chave de idempotência do envio é estável.
        logError('[abandoned-email] claim não fechado (ficará pendente/retomável)', {
          responseId: row.id, role: recipient.role, closeErr,
        })
      }
    }
  }

  log('[abandoned-email] run', { ...stats, cortadoPorTempo, varreduraCompleta })
  return NextResponse.json({
    ok: true,
    thresholdMin,
    relogio: 'last_activity_at (última atividade real)',
    cortadoPorTempo,
    varreduraCompleta,
    ...stats,
  })
}

/**
 * Libera claims PENDENTES adquiridos por este run. Nunca apaga claim já
 * fechado (sent/failed) — isso reabriria um alerta que já saiu.
 */
async function releaseClaims(
  supabase: ReturnType<typeof admin>,
  responseId: string,
  recipients: EmailRecipient[]
): Promise<void> {
  for (const r of recipients) {
    const { error } = await supabase
      .from('form_notification_logs')
      .delete()
      .eq('response_id', responseId)
      .eq('event_type', EVENT_TYPE)
      .eq('channel', CHANNEL)
      .eq('recipient_role', r.role)
      .eq('status', 'pending')
    if (error) {
      logError('[abandoned-email] CRÍTICO: claim pendente não liberado — lead suprimido até o lease vencer', {
        responseId, role: r.role, error,
      })
    }
  }
}
