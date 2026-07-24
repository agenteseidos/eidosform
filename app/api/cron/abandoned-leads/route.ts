import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { PLANS } from '@/lib/plan-limits'
import { getEffectivePlan, type PlanId } from '@/lib/plans'
import { buildLeadData } from '@/lib/integration-stubs'
import { buildMessage, ABANDONED_LEAD_TEMPLATE } from '@/lib/whatsapp-template'
import { toWhatsAppDigits } from '@/lib/phone'
import { log, logError } from '@/lib/logger'

/**
 * CRON — Alerta de LEAD ABANDONADO por WhatsApp.
 *
 * REESCRITO 2026-07-23 (2ª auditoria Codex, REPROVADO). O que mudou e POR QUÊ:
 *
 * P1-1 STARVATION (provado em produção): a v2 fazia `LIMIT BATCH*3` ANTES de
 *   excluir os já avisados. Como os 12 mais antigos da janela já tinham claim,
 *   o cron nunca chegava no 13º — leads novos NUNCA seriam alertados até os
 *   antigos saírem da janela de 72h. A feature estava morta em produção.
 *   ⇒ Agora: varredura por CURSOR (páginas ordenadas por last_activity_at),
 *     acumulando até BATCH_LIMIT candidatos REALMENTE acionáveis. Forms sem
 *     plano/telefone/settings já saem no filtro do banco (actionableFormIds).
 *
 * P1-2 CICLO DE VIDA DO CLAIM: o claim era inserido e só apagado em falha
 *   observada. Morte do processo ⇒ claim órfão indistinguível de envio feito
 *   (todos os 36 claims tinham wacli_message_id=null). ⇒ Agora o claim tem
 *   ESTADO: `wacli_message_id IS NULL` = PENDENTE (com lease em created_at);
 *   preenchido = ENVIADO. Pendente vencido (> LEASE_MS) é RETOMÁVEL por um run
 *   futuro via UPDATE condicional atômico. Rede de segurança contra duplicata
 *   na retomada: a idempotencyKey `abandoned:<form>:<response>` é estável e a
 *   VPS a deduplica por 96h — retomar não reenvia de verdade.
 *
 * P1-3 REVALIDAÇÃO: entre o SELECT e o envio o lead podia RETOMAR ou COMPLETAR
 *   o form e ainda assim receber "Lead incompleto". ⇒ Agora, imediatamente
 *   antes do envio, a row é relida e o envio só ocorre se AINDA estiver
 *   `completed=false` e `last_activity_at <= cutoff`; senão o claim é liberado.
 *
 * P1-4 DEADLINE: o relógio começava só depois de 4 queries e o fetch interno
 *   não tinha AbortSignal (a rota interna espera até 30s pela VPS, e a própria
 *   função tem maxDuration=30 — reproduzia timeout e claim órfão). ⇒ Agora o
 *   orçamento é medido da ENTRADA da rota, nenhum envio começa sem
 *   MIN_SEND_BUDGET_MS sobrando, e o fetch aborta com o tempo restante.
 *
 * P2-8: ABANDONED_LEAD_MINUTES é validado (fail-closed) em vez de virar NaN.
 */

const LOOKBACK_HOURS = 72
const BATCH_LIMIT = 4
/** Página da varredura por cursor (P1-1). */
const PAGE_SIZE = 50
/** Teto de páginas por run — impede varredura sem fim numa janela enorme. */
const MAX_PAGES = 20
/** Claim PENDENTE mais velho que isto é considerado morto e pode ser retomado. */
const LEASE_MS = 10 * 60_000
/**
 * vercel.json fixa maxDuration=30s para app/api/**. Orçamento medido da ENTRADA
 * da rota, com folga real pro shutdown da function.
 */
const ROUTE_BUDGET_MS = 25_000
/** Não começa um envio sem pelo menos isto sobrando (P1-4). */
const MIN_SEND_BUDGET_MS = 9_000

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
  return NextResponse.json(
    { ok: false, stage, error: String((error as { message?: string })?.message ?? error).slice(0, 300) },
    { status: 500 }
  )
}

/**
 * P2-8: threshold vindo do ambiente é validado. `Number(undefined)` virava NaN
 * e NaN em comparação de data seleciona silenciosamente errado — fail-closed.
 */
export function parseThresholdMin(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null || String(raw).trim() === '') return 30
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 5 || n > 1440) return null
  return n
}

export interface ClaimState { wacli_message_id: string | null; created_at: string }

export interface ScanRow {
  id: string
  form_id: string
  last_activity_at: string
  [k: string]: unknown
}

export interface ScanCandidate { row: ScanRow; staleClaim: boolean }

export interface ScanDeps {
  /** Uma página ordenada por last_activity_at ASC, a partir de `cursor` (inclusivo). */
  fetchPage: (cursor: string, limit: number) => Promise<ScanRow[]>
  /** Claims 'abandoned_alert' existentes para os ids dados. */
  fetchClaims: (ids: string[]) => Promise<Map<string, ClaimState>>
  /** Milissegundos restantes do orçamento da rota. */
  budgetLeft: () => number
  /**
   * Row é ENVIÁVEL? (hoje: tem telefone de lead utilizável).
   *
   * Crítico pro P1-1: sem isto, leads SEM telefone eram claimados, descartados e
   * liberados a cada run — ocupando as 4 vagas do lote indefinidamente e
   * recriando a starvation por outro caminho. Descobri isso auditando meu
   * próprio diff: o check de telefone tinha migrado pra DEPOIS do claim.
   */
  isActionable?: (row: ScanRow) => boolean
}

export interface ScanResult {
  picked: ScanCandidate[]
  examinados: number
  jaAvisados: number
  naoAcionaveis: number
  paginas: number
  varreduraCompleta: boolean
  cortadoPorTempo: boolean
}

/**
 * Timestamps do PostgREST vêm como `2026-07-23T20:17:47.228729+00:00` e os do JS
 * como `2026-07-23T23:55:21.311Z` — formatos DIFERENTES. Comparar essas strings
 * diretamente é frágil (e quebraria de vez se o offset não fosse UTC), então
 * toda comparação de tempo aqui passa por epoch. `NaN` vira -Infinity para
 * nunca ser tratado como "recente".
 */
function toMs(value: unknown): number {
  const ms = new Date(String(value)).getTime()
  return Number.isFinite(ms) ? ms : -Infinity
}

/**
 * VARREDURA POR CURSOR — o coração do fix do P1-1 (starvation).
 *
 * A v2 aplicava `LIMIT batch*3` ANTES de excluir os já avisados: com os mais
 * antigos da janela todos claimed, o cron nunca alcançava um lead acionável mais
 * novo. Aqui a paginação CONTINUA até juntar `batchLimit` candidatos realmente
 * acionáveis (ou acabar a janela / o orçamento / o teto de páginas).
 *
 * Extraída da rota para ser testável sem banco — os P1 que quebraram produção
 * não tinham teste nenhum (P2-9).
 */
export async function scanForCandidates(
  deps: ScanDeps,
  opts: { startCursor: string; batchLimit: number; pageSize: number; maxPages: number; leaseCutoffIso: string; minBudgetMs: number }
): Promise<ScanResult> {
  const picked: ScanCandidate[] = []
  const seen = new Set<string>()
  const leaseCutoffMs = toMs(opts.leaseCutoffIso)
  let cursor = opts.startCursor
  let paginas = 0
  let examinados = 0
  let jaAvisados = 0
  let naoAcionaveis = 0
  let varreduraCompleta = false
  let cortadoPorTempo = false

  while (picked.length < opts.batchLimit && paginas < opts.maxPages) {
    if (deps.budgetLeft() < opts.minBudgetMs) { cortadoPorTempo = true; break }

    const page = await deps.fetchPage(cursor, opts.pageSize)
    if (page.length === 0) { varreduraCompleta = true; break }
    paginas += 1

    // `.gte` + set de vistos: `.gt` puro pularia rows com last_activity_at
    // idêntico ao do cursor (ficariam invisíveis pra sempre).
    const fresh = page.filter(r => !seen.has(r.id))
    if (fresh.length === 0) { varreduraCompleta = true; break }
    for (const r of fresh) seen.add(r.id)
    cursor = page[page.length - 1].last_activity_at

    const claimMap = await deps.fetchClaims(fresh.map(r => r.id))

    for (const r of fresh) {
      if (picked.length >= opts.batchLimit) break
      examinados += 1
      const claim = claimMap.get(r.id)
      let staleClaim = false
      if (claim) {
        // ENVIADO (id preenchido) ou PENDENTE ainda dentro do lease ⇒ pula.
        if (claim.wacli_message_id !== null || toMs(claim.created_at) >= leaseCutoffMs) {
          jaAvisados += 1
          continue
        }
        staleClaim = true // PENDENTE vencido ⇒ retomável (P1-2)
      }
      // Enviabilidade é decidida ANTES de ocupar vaga no lote — ver isActionable.
      if (deps.isActionable && !deps.isActionable(r)) {
        naoAcionaveis += 1
        continue
      }
      picked.push({ row: r, staleClaim })
    }

    if (page.length < opts.pageSize) { varreduraCompleta = true; break }
  }

  return { picked, examinados, jaAvisados, naoAcionaveis, paginas, varreduraCompleta, cortadoPorTempo }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  // P1-4: o relógio começa AQUI, antes de qualquer I/O.
  const routeStart = Date.now()
  const budgetLeft = () => ROUTE_BUDGET_MS - (Date.now() - routeStart)

  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const thresholdMin = parseThresholdMin(process.env.ABANDONED_LEAD_MINUTES)
  if (thresholdMin === null) {
    return fail('config', new Error('ABANDONED_LEAD_MINUTES inválido (inteiro entre 5 e 1440)'))
  }

  const supabase = admin()
  const now = Date.now()
  const cutoffIso = new Date(now - thresholdMin * 60_000).toISOString()
  const lookbackIso = new Date(now - LOOKBACK_HOURS * 3_600_000).toISOString()
  const leaseCutoffIso = new Date(now - LEASE_MS).toISOString()
  const stats = {
    examinados: 0, enviados: 0, semTelefone: 0, jaAvisados: 0,
    falhas: 0, paginas: 0, retomados: 0, revalidadosFora: 0,
  }
  let cortadoPorTempo = false
  let varreduraCompleta = false

  // 1) Forms ACIONÁVEIS: whatsapp ligado + telefone do dono + plano que permite.
  //    Resolver isso ANTES da varredura tira do caminho as exclusões que antes
  //    entupiam o lote (parte do P1-1).
  const { data: settingsRows, error: settingsErr } = await supabase
    .from('form_whatsapp_settings')
    .select('form_id, enabled, owner_phone')
    .eq('enabled', true)
  if (settingsErr) return fail('settings', settingsErr)

  const phoneByForm = new Map<string, string>()
  for (const s of settingsRows ?? []) {
    if (s.owner_phone) phoneByForm.set(s.form_id, s.owner_phone)
  }
  if (phoneByForm.size === 0) {
    return NextResponse.json({ ok: true, thresholdMin, varreduraCompleta: true, ...stats })
  }

  const { data: forms, error: formsErr } = await supabase
    .from('forms')
    .select('id, title, user_id, questions')
    .in('id', [...phoneByForm.keys()])
  if (formsErr) return fail('forms', formsErr)

  const ownerIds = [...new Set((forms ?? []).map(f => f.user_id))]
  const { data: owners, error: ownersErr } = ownerIds.length
    ? await supabase.from('profiles').select('id, plan, plan_expires_at').in('id', ownerIds)
    : { data: [], error: null }
  if (ownersErr) return fail('owners', ownersErr)
  const planOkByOwner = new Map(
    (owners ?? []).map(o => [o.id, Boolean(PLANS[getEffectivePlan(o) as PlanId]?.whatsappNotifications)])
  )

  const formMap = new Map(
    (forms ?? []).filter(f => planOkByOwner.get(f.user_id)).map(f => [f.id, f])
  )
  const actionableFormIds = [...formMap.keys()]
  if (actionableFormIds.length === 0) {
    return NextResponse.json({ ok: true, thresholdMin, varreduraCompleta: true, ...stats })
  }

  // 2) VARREDURA POR CURSOR (P1-1) — acumula até BATCH_LIMIT ACIONÁVEIS de
  //    verdade, em vez de cortar no LIMIT antes de deduplicar. Lógica extraída
  //    em scanForCandidates() para ter teste de regressão sem banco.
  /** Monta o leadData de uma row (usado tanto no filtro quanto no envio). */
  const leadDataFor = (
    formId: string,
    responseId: string,
    r: { answers?: unknown; url_params?: unknown; meta_events?: unknown; [k: string]: unknown }
  ) => {
    const form = formMap.get(formId)
    if (!form) return null
    return buildLeadData({
      formId,
      responseId,
      responseData: (r.answers ?? {}) as Record<string, unknown>,
      meta_events: (r.meta_events ?? []) as string[],
      urlParams: (r.url_params ?? null) as Record<string, string> | null,
      form: form as { id: string; title: string | null; user_id: string; questions?: Array<{ id: string; title?: string; type?: string }> },
      appUrl: process.env.NEXT_PUBLIC_APP_URL || 'https://eidosform.com.br',
    })
  }

  let scanFailure: unknown = null
  const scan = await scanForCandidates(
    {
      budgetLeft,
      // Lead sem telefone não é alertável: filtra ANTES de ocupar vaga no lote,
      // senão ele seria claimado e liberado a cada run, entupindo o batch.
      isActionable: (r) => {
        const lead = leadDataFor(r.form_id, r.id, r)
        return Boolean(lead && toWhatsAppDigits(String(lead.phone ?? '')))
      },
      fetchPage: async (cursor, limit) => {
        const { data, error } = await supabase
          .from('responses')
          .select('id, form_id, answers, url_params, meta_events, last_activity_at')
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
          .from('form_whatsapp_logs')
          .select('response_id, wacli_message_id, created_at')
          .eq('status', 'abandoned_alert')
          .in('response_id', ids)
        if (error) { scanFailure = { stage: 'dedup-select', error }; return new Map() }
        return new Map<string, ClaimState>(
          (data ?? []).map(c => [c.response_id as string, {
            wacli_message_id: c.wacli_message_id, created_at: c.created_at,
          } as ClaimState])
        )
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
  // Erro de banco NUNCA vira ok:true (regressão do P0-1 da 1ª auditoria).
  if (scanFailure) {
    const f = scanFailure as { stage: string; error: unknown }
    return fail(f.stage, f.error)
  }

  const picked = scan.picked
  stats.examinados = scan.examinados
  stats.jaAvisados = scan.jaAvisados
  stats.semTelefone = scan.naoAcionaveis
  stats.paginas = scan.paginas
  varreduraCompleta = scan.varreduraCompleta
  cortadoPorTempo = scan.cortadoPorTempo

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://eidosform.com.br'

  // 3) Processa os candidatos acionáveis.
  for (const { row, staleClaim } of picked) {
    const remaining = budgetLeft()
    if (remaining < MIN_SEND_BUDGET_MS) { cortadoPorTempo = true; break }

    const form = formMap.get(row.form_id)
    const ownerPhone = phoneByForm.get(row.form_id)
    if (!form || !ownerPhone) continue

    // 3a) ADQUIRE O CLAIM ATOMICAMENTE (P1-2).
    let owned = false
    if (staleClaim) {
      // Retomada de pendência morta: só vence quem casar TODAS as condições.
      const { data: retaken, error: retakeErr } = await supabase
        .from('form_whatsapp_logs')
        .update({ created_at: new Date().toISOString(), error_message: 'lease retomado' })
        .eq('response_id', row.id)
        .eq('status', 'abandoned_alert')
        .is('wacli_message_id', null)
        .lt('created_at', leaseCutoffIso)
        .select('id')
      if (retakeErr) { stats.falhas += 1; logError('[abandoned-leads] retake falhou', retakeErr); continue }
      owned = (retaken ?? []).length === 1
      if (owned) stats.retomados += 1
    } else {
      const { error: claimErr } = await (supabase as unknown as {
        from: (t: string) => { insert: (d: Record<string, unknown>) => Promise<{ error: unknown }> }
      }).from('form_whatsapp_logs').insert({
        form_id: row.form_id,
        response_id: row.id,
        phone_number: null,
        message_sent: '',
        status: 'abandoned_alert',
        wacli_message_id: null,
        error_message: null,
      })
      // 23505 = índice único ⇒ outra instância ganhou a corrida. Não é falha.
      const code = (claimErr as { code?: string } | null)?.code
      if (claimErr && code !== '23505') {
        stats.falhas += 1
        logError('[abandoned-leads] claim falhou — envio abortado', claimErr)
        continue
      }
      owned = !claimErr
      if (!owned) stats.jaAvisados += 1
    }
    if (!owned) continue

    // 3b) REVALIDA (P1-3): o lead pode ter retomado ou completado desde o SELECT.
    const { data: current, error: recheckErr } = await supabase
      .from('responses')
      .select('id, completed, last_activity_at, answers, url_params, meta_events')
      .eq('id', row.id)
      .maybeSingle() as { data: { id: string; completed: boolean; last_activity_at: string; answers: unknown; url_params: unknown; meta_events: unknown } | null; error: unknown }

    // Comparação por EPOCH, nunca por string: o banco devolve
    // `...228729+00:00` e o JS gera `...311Z` — formatos diferentes.
    const cutoffMs = now - thresholdMin * 60_000
    const aindaAbandonado =
      !recheckErr && current && current.completed === false &&
      toMs(current.last_activity_at) < cutoffMs

    if (!aindaAbandonado) {
      stats.revalidadosFora += 1
      await releaseClaim(supabase, row.id, 'revalidação: lead retomou/completou')
      continue
    }

    // 3c) Monta a mensagem com os dados FRESCOS da revalidação.
    const minutosSemAtividade = Math.round((Date.now() - toMs(current.last_activity_at)) / 60_000)
    const leadData = leadDataFor(row.form_id, row.id, current)
    if (!leadData) { await releaseClaim(supabase, row.id, 'form sumiu'); continue }
    leadData.abandono_minutos = String(minutosSemAtividade)

    // Revalidação pode ter mudado os dados: reconfere o telefone com o valor fresco.
    const leadPhone = toWhatsAppDigits(String(leadData.phone ?? ''))
    if (!leadPhone) {
      stats.semTelefone += 1
      await releaseClaim(supabase, row.id, 'sem telefone acionável')
      continue
    }

    const message = buildMessage(ABANDONED_LEAD_TEMPLATE, leadData)

    // 3d) Envia com AbortSignal do tempo QUE SOBRA (P1-4) — nunca deixa a rota
    //     interna (que espera até 30s pela VPS) estourar o maxDuration daqui.
    const sendBudget = Math.max(1_000, budgetLeft() - 3_000)
    let sendOk = false
    let messageId: string | null = null
    try {
      const res = await fetch(`${appUrl}/api/whatsapp/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.INTERNAL_API_SECRET || ''}`,
        },
        body: JSON.stringify({
          to: ownerPhone,
          message,
          formId: row.form_id, // direct-send com formId ⇒ gate de plano fail-closed
          idempotencyKey: `abandoned:${row.form_id}:${row.id}`,
        }),
        signal: AbortSignal.timeout(sendBudget),
      })
      const result = await res.json().catch(() => ({})) as { success?: boolean; messageId?: string; error?: string }
      sendOk = res.ok && result.success === true
      messageId = result.messageId ?? null
      if (sendOk) stats.enviados += 1
      else {
        stats.falhas += 1
        log('[abandoned-leads] send falhou', { responseId: row.id, status: res.status, error: result.error ?? null })
      }
    } catch (err) {
      stats.falhas += 1
      logError('[abandoned-leads] erro no envio', err)
    }

    // 3e) PROMOVE o claim (pendente → enviado) ou libera pra retry.
    if (sendOk) {
      const { error: promoteErr } = await supabase
        .from('form_whatsapp_logs')
        .update({ wacli_message_id: messageId ?? `sent-${Date.now()}`, phone_number: leadPhone, error_message: null })
        .eq('response_id', row.id)
        .eq('status', 'abandoned_alert')
      if (promoteErr) {
        // Claim fica PENDENTE e vira retomável em LEASE_MS. Não gera alerta
        // duplicado de verdade: a idempotencyKey estável é deduplicada 96h na VPS.
        logError('[abandoned-leads] envio OK mas claim não promovido (ficará pendente/retomável)', { responseId: row.id, promoteErr })
      }
    } else {
      await releaseClaim(supabase, row.id, 'envio falhou')
    }
  }

  log('[abandoned-leads] run', { ...stats, cortadoPorTempo, varreduraCompleta })
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
 * Libera um claim PENDENTE que este run possui. Nunca apaga um claim já
 * promovido (`wacli_message_id` preenchido) — isso reabriria um alerta enviado.
 */
async function releaseClaim(
  supabase: ReturnType<typeof admin>,
  responseId: string,
  motivo: string
): Promise<void> {
  const { error } = await supabase
    .from('form_whatsapp_logs')
    .delete()
    .eq('response_id', responseId)
    .eq('status', 'abandoned_alert')
    .is('wacli_message_id', null)
  if (error) {
    logError('[abandoned-leads] CRÍTICO: claim pendente não liberado — lead pode ficar suprimido até o lease vencer', { responseId, motivo, error })
  }
}
