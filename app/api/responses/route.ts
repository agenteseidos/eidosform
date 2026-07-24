import type { ResponseInsert, ResponseUpdate, AnswerItemInsert, QuestionConfig } from '@/lib/database.types'
import { NextRequest, NextResponse, after } from 'next/server'
import { createPublicClient } from '@/lib/supabase/public'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRequestUser } from '@/lib/supabase/request-auth'
import { checkAndIncrementResponseCount, PLANS } from '@/lib/plan-limits'
import { getEffectivePlan } from '@/lib/plans'
import { dispatchWebhook } from '@/lib/webhook-dispatcher'
import { extractLead } from '@/lib/lead-extraction'
import { sendEmailNotification } from '@/lib/notify'
import { checkResponseRateLimitAsync } from '@/lib/response-rate-limit'
import { validateAllAnswers, pruneOrphanAnswers, pruneOffPathAnswers } from '@/lib/field-validators'
import { isResponseComplete } from '@/lib/form-response-security'
import { sendWhatsAppOnFormResponse } from '@/lib/integration-stubs'
import { upsertSubmission } from '@/lib/google-sheets'
import { logError } from '@/lib/logger'
import { sendMetaCAPIEvent, extractPIIFromAnswers } from '@/lib/meta-capi'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { signPartialToken, verifyPartialToken } from '@/lib/partial-token'
import { isValidSessionKey, hashSessionKey, hashLogPrefix } from '@/lib/partial-session'
import { extractIdentity, identitiesMatch } from '@/lib/identity-match'
import { sanitizeUrlParams } from '@/lib/url-params'
import { sendNewResponseNotification } from '@/lib/resend'
import { filterQuestionsByPlan } from '@/lib/questions'

// Maximum payload size (1MB — covers long text forms with URLs; file uploads go to R2)
const MAX_PAYLOAD_BYTES = 50 * 1024
// Maximum number of answer keys (prevents flooding with fake question ids)
const MAX_ANSWER_KEYS = 200

// SECURITY NOTE: CORS * is intentional — this endpoint must be callable from any
// domain where forms are embedded (custom domains, landing pages, etc.).
// The service_role key is used server-side only (never exposed to the client).
// Protection layers:
//   1. Rate limit per IP (10 req/min via Supabase RPC + in-memory fallback)
//   2. Honeypot field (_hp_) to trap bots
//   3. Payload size + answer key count limits
//   4. Form must exist and be 'published' (validated before insert)
//   5. Response limit per user plan (prevents infinite submissions)
//   6. UUID format validation on form_id (prevents probing)
//   7. Input sanitization (HTML tag stripping)
//
// TODO [SECURITY]: Add optional Turnstile/hCaptcha validation per form.
//   Form owner enables in settings, form-player sends cf-turnstile-response token,
//   this endpoint validates with Cloudflare before accepting submission.
//   See: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Response-Id, X-Partial-Token, X-Partial-Session',
  'Access-Control-Max-Age': '86400',
}

// OPTIONS /api/responses — CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

// Sanitize string: remove HTML tags to prevent stored XSS
function sanitizeValue(val: unknown): unknown {
  if (typeof val === 'string') {
    return val.replace(/<[^>]*>/g, '')
  }
  if (Array.isArray(val)) return val.map(sanitizeValue)
  if (val && typeof val === 'object') {
    return Object.fromEntries(
      Object.entries(val as Record<string, unknown>).map(([k, v]) => [k, sanitizeValue(v)])
    )
  }
  return val
}

// Serializa valor de resposta para answer_items (coluna text)
// Tipos complexos (objeto, array) são serializados como JSON
function serializeAnswerValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

// POST /api/responses — submeter resposta (completa ou parcial)
export async function POST(req: NextRequest) {
  try {
  // Bug #2: Rate limit — max 10 per minute per IP
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? 'unknown'
  const rateCheck = await checkResponseRateLimitAsync(ip)
  if (!rateCheck.allowed) {
    const retryAfter = Math.ceil(rateCheck.resetIn / 1000)
    return NextResponse.json(
      { error: 'Muitas requisições. Tente novamente mais tarde.', retryAfter },
      {
        status: 429,
        headers: {
          ...CORS_HEADERS,
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': '10',
          'X-RateLimit-Remaining': '0',
        },
      }
    )
  }

  // Payload size check (defense against large payloads)
  const contentLength = req.headers.get('content-length')
  if (contentLength && parseInt(contentLength) > MAX_PAYLOAD_BYTES) {
    return NextResponse.json(
      { error: 'Payload muito grande' },
      { status: 413, headers: CORS_HEADERS }
    )
  }

  // Use service-role client for anonymous submissions (no auth required)
  const supabase = createPublicClient()

  // Bug #6: Catch invalid JSON
  let rawBody: string
  let body: Record<string, unknown>
  try {
    rawBody = await req.text()
    if (rawBody.length > MAX_PAYLOAD_BYTES) {
      return NextResponse.json(
        { error: 'Payload muito grande' },
        { status: 413, headers: CORS_HEADERS }
      )
    }
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Dados inválidos' }, { status: 400, headers: CORS_HEADERS })
  }

  const { form_id, last_question_answered, respondent_id } = body
  const metaEvents = Array.isArray(body.meta_events)
    ? body.meta_events.filter((e): e is string => typeof e === 'string')
    : []
  const utmData = {
    utm_source: typeof body.utm_source === 'string' ? body.utm_source : null,
    utm_medium: typeof body.utm_medium === 'string' ? body.utm_medium : null,
    utm_campaign: typeof body.utm_campaign === 'string' ? body.utm_campaign : null,
    utm_term: typeof body.utm_term === 'string' ? body.utm_term : null,
    utm_content: typeof body.utm_content === 'string' ? body.utm_content : null,
  }
  // Campos ocultos via URL — re-sanitizados no servidor (fail-open: inválido
  // é descartado, nunca rejeita o submit). null quando não sobra nada.
  const urlParams = sanitizeUrlParams(body.url_params)

  // Honeypot: if _hp_ field is filled, silently accept but don't save (bot trap)
  if (body._hp_ && String(body._hp_).length > 0) {
    return NextResponse.json(
      { response_id: 'ok', completed: true },
      { status: 201, headers: CORS_HEADERS }
    )
  }

  // Bug #9: Sanitize answers
  let answers = sanitizeValue(body.answers) as Record<string, unknown> | undefined

  if (!form_id) {
    return NextResponse.json({ error: 'ID do formulário é obrigatório' }, { status: 400, headers: CORS_HEADERS })
  }

  // Validate form_id is UUID format (prevents probing)
  if (typeof form_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(form_id)) {
    return NextResponse.json({ error: 'ID do formulário inválido' }, { status: 400, headers: CORS_HEADERS })
  }

  if (!answers || typeof answers !== 'object') {
    return NextResponse.json({ error: 'Respostas em formato inválido' }, { status: 400, headers: CORS_HEADERS })
  }

  // Limit number of answer keys to prevent abuse
  if (Object.keys(answers).length > MAX_ANSWER_KEYS) {
    return NextResponse.json({ error: 'Número de respostas excede o limite' }, { status: 400, headers: CORS_HEADERS })
  }

  // Verificar se o formulário existe e está publicado
  const { data: form, error: formError } = await supabase
    .from('forms')
    .select('id, title, questions, status, user_id, webhook_url, is_closed, paused, notify_email_enabled, notify_email, google_sheets_enabled, google_sheets_id')
    .eq('id', form_id as string)
    .eq('status', 'published')
    .single() as { data: { id: string; title: string | null; questions: Array<{ id: string; required?: boolean }>; status: string; user_id: string; webhook_url: string | null; is_closed: boolean; paused: boolean; notify_email_enabled: boolean; notify_email: string | null; google_sheets_enabled: boolean; google_sheets_id: string | null } | null; error: unknown }

  if (formError || !form) {
    return NextResponse.json({ error: 'Formulário não encontrado ou não publicado' }, { status: 404, headers: CORS_HEADERS })
  }

  // Verificar se o form está fechado
  if (form.is_closed) {
    return NextResponse.json(
      { error: 'Este formulário não está aceitando novas respostas.' },
      { status: 403, headers: CORS_HEADERS }
    )
  }

  // Verificar se o form está pausado (downgrade de plano)
  if (form.paused) {
    return NextResponse.json(
      { error: 'Este formulário está pausado porque o plano do criador expirou.' },
      { status: 403, headers: CORS_HEADERS }
    )
  }

  const formQuestions = (form.questions ?? []) as QuestionConfig[]
  const { data: ownerProfile } = await supabase
    .from('profiles')
    .select('plan, email, plan_expires_at')
    .eq('id', form.user_id)
    .single() as { data: { plan: string | null; email: string | null; plan_expires_at: string | null } | null; error: unknown }
  const ownerPlan = getEffectivePlan(ownerProfile)
  const ownerPlanConfig = PLANS[ownerPlan]
  const effectiveQuestions = filterQuestionsByPlan(formQuestions, ownerPlan)

  // Remove chaves de perguntas que não existem mais no form ou que o plano do
  // dono não permite mais (ex.: downgrade). Antes, qualquer chave órfã
  // bloqueava o submit inteiro com "Pergunta desconhecida".
  const { pruned: prunedAnswers, removedKeys } = pruneOrphanAnswers(
    effectiveQuestions,
    answers as Record<string, unknown>
  )
  if (removedKeys.length > 0) {
    console.warn('[responses] unavailable answer keys discarded', { form_id, removedKeys })
  }
  answers = prunedAnswers

  // Poda por LÓGICA CONDICIONAL/saltos (hardening 2026-07-01): descarta respostas de
  // perguntas fora do caminho percorrível (ramo escondido, troca de resposta no meio,
  // POST direto preenchendo campo oculto). Mesma semântica do isResponseComplete
  // (buildQuestionPath) → não cria 422 novo pra submit legítimo.
  const { pruned: onPathAnswers, removedKeys: offPathKeys } = pruneOffPathAnswers(
    effectiveQuestions,
    answers
  )
  if (offPathKeys.length > 0) {
    console.warn('[responses] off-path answer keys discarded', { form_id, offPathKeys })
  }
  answers = onPathAnswers

  // last_question_answered só persiste se apontar pra pergunta EXISTENTE do form
  // (Codex P3 2026-07-01 — evita referência pendurada a pergunta podada/deletada).
  const lastQuestionAnswered =
    typeof last_question_answered === 'string' && effectiveQuestions.some((q) => q.id === last_question_answered)
      ? last_question_answered
      : null

  // Se o respondente enviou chaves mas TODAS foram podadas (órfãs, bloqueadas
  // pelo plano do dono ou fora do caminho), não há nada válido para salvar —
  // rejeita ANTES de consumir cota. Sem isso, um POST direto só com campos
  // indisponíveis criaria uma resposta vazia e queimaria um slot do limite
  // mensal. Submit legítimo de form todo-opcional (sem chaves removidas) não cai aqui.
  if (Object.keys(answers).length === 0 && (removedKeys.length > 0 || offPathKeys.length > 0)) {
    return NextResponse.json(
      { error: 'Nenhuma resposta válida para salvar' },
      { status: 422, headers: CORS_HEADERS }
    )
  }

  // B16b: Validação backend por tipo de campo
  const fieldErrors = validateAllAnswers(
    effectiveQuestions,
    answers
  )
  if (fieldErrors.length > 0) {
    return NextResponse.json(
      { error: 'Dados inválidos', field_errors: fieldErrors },
      { status: 422, headers: CORS_HEADERS }
    )
  }

  // Bug #5: Auto-detect completed based on required questions
  const completed = isResponseComplete(answers, effectiveQuestions)

  // Resolve primeiro o alvo de UPDATE (se houver) e a autorização sobre ele;
  // só depois o limite de respostas — um UPDATE não consome cota nova.
  let existingResponseId: string | null = req.headers.get('x-response-id')
  // A1 (auditoria 2026-06-10): prova de posse da parcial anônima.
  const partialToken = req.headers.get('x-partial-token')
    || (typeof body.partial_token === 'string' ? body.partial_token : null)
  // Session key (fix duplicatas 2026-07-08): bearer secret da tentativa de
  // preenchimento — faz o submit convergir pra parcial criada por sendBeacon,
  // cuja resposta (response_id/token) o cliente nunca conseguiu ler.
  const rawSessionKey = req.headers.get('x-partial-session')
    || (typeof body.partial_session === 'string' ? body.partial_session : null)
  const sessionHash = rawSessionKey !== null && isValidSessionKey(rawSessionKey)
    ? hashSessionKey(rawSessionKey)
    : null
  let existingResponse: { id: string; respondent_id: string | null; completed: boolean; sheets_row_index: number | null } | null = null
  // true quando o alvo do UPDATE é uma parcial ANÔNIMA adotada por posse
  // (token ou session key) — nesses caminhos o UPDATE é condicionado a
  // completed=false: dois submits concorrentes da mesma tentativa não podem
  // ambos executar side effects (achado Codex 2026-07-08).
  let anonymousAdoption = false

  if (existingResponseId) {
    // P0-2: Verify ownership — respondent_id from cookie must match the response's respondent_id
    // Fetch the existing response to check ownership
    const { data: fetched } = await supabase
      .from('responses')
      .select('id, respondent_id, completed, sheets_row_index')
      .eq('id', existingResponseId)
      .eq('form_id', form_id as string)
      .single() as { data: { id: string; respondent_id: string | null; completed: boolean; sheets_row_index: number | null } | null; error: unknown }

    if (!fetched) {
      return NextResponse.json({ error: 'Resposta não encontrada' }, { status: 404, headers: CORS_HEADERS })
    }

    // Há dois caminhos legítimos de UPDATE:
    //  (a) Autenticado: a row tem respondent_id e bate com o cookie/header do
    //      lado do cliente — fluxo de partial-response Plus+ pra logados.
    //  (b) Anônimo partial→final: a row foi criada por /api/responses/partial
    //      sem respondent_id (anônima), ainda não foi finalizada E o cliente
    //      apresenta o partial_token emitido na criação (A1). O id sozinho
    //      não autoriza mais — UUIDs podem vazar via logs/Sheets/webhooks.
    const bodyRespondentId = typeof respondent_id === 'string' ? respondent_id : null
    const isAnonymousPartialUpgrade =
      fetched.respondent_id === null &&
      fetched.completed === false &&
      verifyPartialToken(partialToken, existingResponseId)
    const isAuthenticatedOwner =
      !!fetched.respondent_id && fetched.respondent_id === bodyRespondentId
    if (isAuthenticatedOwner && fetched.completed === true) {
      // P1-4 (auditoria Codex 2026-07-23): resubmissão AUTENTICADA de resposta
      // já finalizada repetia e-mail/Sheets/CAPI/webhook a cada replay. Mesmo
      // tratamento idempotente do caminho anônimo: 200 already_completed, sem
      // UPDATE e sem side effects.
      return NextResponse.json(
        { response_id: fetched.id, completed: true, already_completed: true },
        { status: 200, headers: CORS_HEADERS }
      )
    }
    if (isAnonymousPartialUpgrade || isAuthenticatedOwner) {
      existingResponse = fetched
      anonymousAdoption = isAnonymousPartialUpgrade
    } else if (
      fetched.respondent_id === null &&
      fetched.completed === true &&
      verifyPartialToken(partialToken, existingResponseId)
    ) {
      // Idempotência (achado Codex 2026-07-08): submit repetido da MESMA
      // tentativa via id+token — a row já foi completada pelo primeiro submit.
      // Antes caía no 403; agora responde sucesso sem repetir side effects.
      return NextResponse.json(
        { response_id: fetched.id, completed: true, already_completed: true },
        { status: 200, headers: CORS_HEADERS }
      )
    } else if (fetched.respondent_id === null && fetched.completed === false) {
      // Parcial anônima sem token válido (cliente antigo em voo ou id forjado):
      // não sobrescreve — degrada para criar uma resposta nova. Não perde lead
      // legítimo e não permite corromper a resposta de terceiros.
      existingResponseId = null
    } else {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 403, headers: CORS_HEADERS })
    }
  }

  // Adoção por session key (fix 2026-07-08): sem id+token, mas com a key da
  // sessão — a posse da key prova a posse da parcial (mesma força do token).
  if (!existingResponseId && sessionHash) {
    const { data: bySession } = await supabase
      .from('responses')
      .select('id, respondent_id, completed, sheets_row_index')
      .eq('form_id', form_id as string)
      .eq('partial_session_hash', sessionHash)
      .maybeSingle() as { data: { id: string; respondent_id: string | null; completed: boolean; sheets_row_index: number | null } | null; error: unknown }
    if (bySession) {
      if (bySession.completed) {
        // Submit repetido da MESMA tentativa (double-click/retry): idempotente —
        // não cria response nova, não consome cota, não repete side effects.
        console.warn('[responses] submit repetido da mesma session — resposta idempotente', {
          formId: form_id, hashPrefix: hashLogPrefix(sessionHash), responseId: bySession.id,
        })
        return NextResponse.json(
          { response_id: bySession.id, completed: true, already_completed: true },
          { status: 200, headers: CORS_HEADERS }
        )
      }
      if (bySession.respondent_id === null) {
        console.log('[responses] submit adotou parcial via session key', {
          formId: form_id, hashPrefix: hashLogPrefix(sessionHash), responseId: bySession.id,
        })
        existingResponseId = bySession.id
        existingResponse = bySession
        anonymousAdoption = true
      }
    }
  }

  // Bug #1: ALWAYS check response limit before accepting (not just completed)
  let newResponseLimitCheck: Awaited<ReturnType<typeof checkAndIncrementResponseCount>> | null = null
  if (!existingResponseId) {
    newResponseLimitCheck = await checkAndIncrementResponseCount(form.user_id)
    if (!newResponseLimitCheck.allowed) {
      return NextResponse.json(
        { error: 'Limite de respostas atingido para o plano atual', plan: newResponseLimitCheck.plan, limit: newResponseLimitCheck.limit },
        { status: 429, headers: CORS_HEADERS }
      )
    }
  }

  let responseId: string
  let responseMetaEvents: string[] = []
  let existingSheetsRowIndex: number | null = null
  let effectiveUrlParams: Record<string, string> | null = urlParams
  // true só quando o submit criou response NOVA (sem adotar parcial) — alimenta
  // o detector passivo de duplicatas (Fase 3 em avaliação; log-only).
  let createdFresh = false

  if (existingResponseId && existingResponse) {
    let updateQuery = supabase
      .from('responses')
      // url_params: só sobrescreve com valor novo VÁLIDO — upgrade parcial→final
      // sem params no body PRESERVA a identidade capturada na parcial.
      .update({ answers, meta_events: metaEvents, completed, last_question_answered: lastQuestionAnswered, ...utmData, ...(urlParams ? { url_params: urlParams } : {}) } as ResponseUpdate)
      .eq('id', existingResponseId)
      .eq('form_id', form_id as string)
    // UPDATE condicional (compare-and-set) — se outro submit da mesma tentativa
    // completou no meio, este não casa nenhuma linha e vira already_completed
    // (idempotente de verdade: side effects rodam UMA vez).
    //
    // P1-6 (2ª auditoria Codex 2026-07-23): o CAS só era aplicado à adoção
    // ANÔNIMA. No caminho AUTENTICADO, duas requests simultâneas liam ambas
    // `completed=false` (o guard de replay é sequencial e não pega corrida) e
    // as DUAS atualizavam e disparavam e-mail, Sheets, CAPI e webhook — só o
    // WhatsApp era deduplicado, lá na VPS. Agora vale pros dois caminhos:
    // nenhuma resposta já finalizada é sobrescrita.
    updateQuery = updateQuery.eq('completed', false)
    const { data: updated, error: updateError } = await updateQuery
      .select('id, meta_events, sheets_row_index, url_params')
      .single() as { data: { id: string; meta_events?: string[]; sheets_row_index: number | null; url_params?: Record<string, string> | null } | null; error: unknown }

    if (updateError || !updated) {
      // P1-6: o recheck de corrida vale pros DOIS caminhos (antes só o anônimo).
      // Zero linhas casadas + row já completa = outra request ganhou; responder
      // already_completed em vez de erro, sem repetir side effects.
      {
        const { data: check } = await supabase
          .from('responses')
          .select('id, completed')
          .eq('id', existingResponseId)
          .maybeSingle() as { data: { id: string; completed: boolean } | null; error: unknown }
        if (check?.completed) {
          console.warn('[responses] corrida de dupla submissão — resposta idempotente', { formId: form_id, responseId: check.id })
          return NextResponse.json(
            { response_id: check.id, completed: true, already_completed: true },
            { status: 200, headers: CORS_HEADERS }
          )
        }
      }
      return NextResponse.json({ error: 'Resposta não encontrada' }, { status: 404, headers: CORS_HEADERS })
    }

    responseId = updated.id
    responseMetaEvents = Array.isArray((updated as { meta_events?: unknown }).meta_events) ? ((updated as { meta_events: string[] }).meta_events) : []
    existingSheetsRowIndex = updated.sheets_row_index ?? existingResponse.sheets_row_index ?? null
    // Identidade efetiva pro Sheets/webhook: a do body, ou a preservada da parcial.
    effectiveUrlParams = urlParams ?? sanitizeUrlParams(updated.url_params) ?? null
    await supabase.from('answer_items').delete().eq('response_id', responseId)
  } else {
    const { data: newResponse, error: insertError } = await supabase
      .from('responses')
      // partial_session_hash no INSERT: se um handshake/beacon da mesma sessão
      // correr em paralelo, o índice único faz um dos dois perder (23505) e
      // adotar a row do outro — o banco garante a convergência.
      .insert({ form_id: form_id as string, answers: answers as Record<string, import('@/lib/database.types').Json>, meta_events: metaEvents, completed, last_question_answered: lastQuestionAnswered, respondent_id: typeof respondent_id === 'string' ? respondent_id : null, ...utmData, url_params: urlParams, ...(sessionHash ? { partial_session_hash: sessionHash } : {}) } as ResponseInsert)
      .select('id, meta_events')
      .single() as { data: { id: string; meta_events?: string[] } | null; error: { message: string; code?: string } | null }

    if (insertError || !newResponse) {
      // 23505 no índice (form_id, partial_session_hash): a parcial da MESMA
      // sessão nasceu durante este submit (handshake/beacon em voo). Adota-a
      // e completa por cima, como no caminho normal de upgrade.
      if (insertError?.code === '23505' && sessionHash) {
        const { data: raced } = await supabase
          .from('responses')
          .select('id, respondent_id, completed, sheets_row_index, url_params')
          .eq('form_id', form_id as string)
          .eq('partial_session_hash', sessionHash)
          .maybeSingle() as { data: { id: string; respondent_id: string | null; completed: boolean; sheets_row_index: number | null; url_params?: Record<string, string> | null } | null; error: unknown }
        if (raced?.completed) {
          return NextResponse.json(
            { response_id: raced.id, completed: true, already_completed: true },
            { status: 200, headers: CORS_HEADERS }
          )
        }
        if (raced && raced.respondent_id === null) {
          console.log('[responses] corrida de INSERT no submit resolvida por adoção (23505)', {
            formId: form_id, hashPrefix: hashLogPrefix(sessionHash), responseId: raced.id,
          })
          const { data: adopted, error: adoptError } = await supabase
            .from('responses')
            .update({ answers, meta_events: metaEvents, completed, last_question_answered: lastQuestionAnswered, ...utmData, ...(urlParams ? { url_params: urlParams } : {}) } as ResponseUpdate)
            .eq('id', raced.id)
            .eq('form_id', form_id as string)
            // condicional: se outro submit completou a row entre o select e o
            // update, não sobrescreve — cai no re-check idempotente abaixo.
            .eq('completed', false)
            .select('id, meta_events, sheets_row_index, url_params')
            .single() as { data: { id: string; meta_events?: string[]; sheets_row_index: number | null; url_params?: Record<string, string> | null } | null; error: unknown }
          if (adoptError || !adopted) {
            const { data: recheck } = await supabase
              .from('responses')
              .select('id, completed')
              .eq('id', raced.id)
              .maybeSingle() as { data: { id: string; completed: boolean } | null; error: unknown }
            if (recheck?.completed) {
              return NextResponse.json(
                { response_id: recheck.id, completed: true, already_completed: true },
                { status: 200, headers: CORS_HEADERS }
              )
            }
          }
          if (!adoptError && adopted) {
            responseId = adopted.id
            responseMetaEvents = Array.isArray(adopted.meta_events) ? adopted.meta_events : []
            existingSheetsRowIndex = adopted.sheets_row_index ?? raced.sheets_row_index ?? null
            effectiveUrlParams = urlParams ?? sanitizeUrlParams(adopted.url_params) ?? null
            await supabase.from('answer_items').delete().eq('response_id', responseId)
          } else {
            logError('Failed to adopt raced partial on submit:', adoptError, { form_id })
            return NextResponse.json({ error: 'Erro ao salvar resposta. Tente novamente.' }, { status: 500, headers: CORS_HEADERS })
          }
        } else {
          logError('Insert 23505 sem parcial adotável:', insertError, { form_id })
          return NextResponse.json({ error: 'Erro ao salvar resposta. Tente novamente.' }, { status: 500, headers: CORS_HEADERS })
        }
      } else {
        // PII fora dos logs (P3): respondent_id identifica o usuário — loga só presença.
        logError('Failed to insert response:', insertError, { form_id: form_id, has_respondent: Boolean(respondent_id) })
        return NextResponse.json({ error: 'Erro ao salvar resposta. Tente novamente.' }, { status: 500, headers: CORS_HEADERS })
      }
    } else {
      responseId = newResponse.id
      responseMetaEvents = Array.isArray(newResponse.meta_events) ? newResponse.meta_events : []
      createdFresh = true
    }
  }

  // Inserir answer_items normalizados para analytics
  // Serializa tipos complexos (address, file_upload, etc.) como JSON
  const answerItems = Object.entries(answers as Record<string, unknown>).map(([questionId, value]) => ({
    response_id: responseId,
    question_id: questionId,
    value: serializeAnswerValue(value),
  }))

  if (answerItems.length > 0) {
    const { error: itemsError } = await supabase.from('answer_items').insert(answerItems as AnswerItemInsert[])
    if (itemsError) logError('Failed to insert answer_items:', itemsError)
  }

  // Notificar por email e disparar integrações se resposta completa.
  // Importante: em serverless, side-effects fire-and-forget podem ser abortados
  // quando a resposta HTTP termina. Por isso acumulamos promises e aguardamos.
  const postSubmitTasks: Promise<unknown>[] = []
  if (completed) {
    // Notificação principal para o dono do formulário — feature gated em Plus+.
    if (ownerProfile?.email && ownerPlanConfig?.emailNotifications) {
      console.log('[responses] sending owner email notification', { formId: form_id, responseId, ownerPlan, hasOwnerEmail: true })
      postSubmitTasks.push(
        sendNewResponseNotification({
          to: ownerProfile.email,
          formTitle: form.title ?? 'Formulário',
          formId: form_id as string,
          responseId,
        }).then((result) => {
          if (result?.error) {
            logError('Owner response email rejected', undefined, { formId: form_id, responseId, ownerPlan, error: result.error })
          }
        }).catch((err) => logError('Failed to send owner response email', err))
      )
    } else {
      console.log('[responses] owner email notification skipped', {
        formId: form_id,
        responseId,
        ownerPlan,
        hasOwnerEmail: Boolean(ownerProfile?.email),
        planAllowsEmailNotifications: Boolean(ownerPlanConfig?.emailNotifications),
      })
    }

    // Notificação por email configurada no form — feature gated.
    // Evita duplicidade se o email configurado for o mesmo do dono.
    if (
      form.notify_email_enabled &&
      form.notify_email &&
      ownerPlanConfig?.emailNotifications &&
      form.notify_email !== ownerProfile?.email
    ) {
      console.log('[responses] sending integration email notification', { formId: form_id, responseId, ownerPlan, notifyEmailEnabled: true })
      postSubmitTasks.push(
        sendEmailNotification({
          toEmail: form.notify_email,
          formTitle: form.title ?? 'Formulário',
          formId: form_id as string,
          answersCount: Object.keys(answers as Record<string, unknown>).length,
        }).catch((err) => logError('Failed to send email notification', err))
      )
    } else {
      console.log('[responses] integration email notification skipped', {
        formId: form_id,
        responseId,
        ownerPlan,
        notifyEmailEnabled: form.notify_email_enabled,
        hasNotifyEmail: Boolean(form.notify_email),
        planAllowsEmailNotifications: Boolean(ownerPlanConfig?.emailNotifications),
        sameAsOwnerEmail: form.notify_email === ownerProfile?.email,
      })
    }

    // WhatsApp notification — delegated to sendWhatsAppOnFormResponse which checks form_whatsapp_settings
    // Plan gating: only Plus+ users have WhatsApp integration enabled
    {
      const PLAN_ORDER = ['free', 'starter', 'plus', 'professional'] as const
      const planLevel = PLAN_ORDER.indexOf(ownerPlan as typeof PLAN_ORDER[number])
      if (planLevel >= 2) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
        postSubmitTasks.push(
          sendWhatsAppOnFormResponse({
            formId: form_id as string,
            responseId,
            responseData: answers as Record<string, unknown>,
            meta_events: responseMetaEvents,
            urlParams: effectiveUrlParams,
            form: {
              id: form.id,
              title: form.title,
              user_id: form.user_id,
              questions: effectiveQuestions as Array<{ id: string; title?: string; type?: string }>,
            },
            appUrl,
          }).catch((err) => logError('Failed to send WhatsApp notification', err))
        )
      }
    }

    if (form.google_sheets_enabled && form.google_sheets_id && ownerPlanConfig?.googleSheets) {
      const sheetQuestions = effectiveQuestions as Array<{ id: string; title: string }>
      const fieldLabels = sheetQuestions.map((q) => q.title || 'Sem título')
      const questionIdToLabel: Record<string, string> = {}
      for (const q of sheetQuestions) {
        questionIdToLabel[q.id] = q.title || 'Sem título'
      }
      // Se a row já existe no Sheets (criada por /api/responses/partial), faz
      // UPDATE direto pela rowIndex e marca status=Completo — evita duplicar
      // a linha no submit final.
      const spreadsheetId = form.google_sheets_id
      const sheetsRowIndex = existingSheetsRowIndex
      postSubmitTasks.push(
        (async () => {
          const result = await upsertSubmission({
            spreadsheetId,
            fieldLabels,
            // meta_events junto: é de onde a coluna meta_events da planilha lê
            // (sem isso ela fica sempre vazia — gap corrigido em 2026-07-07).
            answers: { ...(answers as Record<string, unknown>), meta_events: responseMetaEvents },
            questionIdToLabel,
            utmData,
            urlParams: effectiveUrlParams,
            responseId,
            status: 'Completo',
            rowIndex: sheetsRowIndex,
          })
          // Se foi append (sem rowIndex prévio), persiste o novo índice
          if (result.rowIndex && result.rowIndex !== sheetsRowIndex) {
            await supabase
              .from('responses')
              .update({ sheets_row_index: result.rowIndex })
              .eq('id', responseId)
          }
        })().catch((e) => logError('Google Sheets sync failed:', e))
      )
    }

    // Meta Conversions API (CAPI) — server-side Lead event (Plus+ only)
    if (ownerPlanConfig?.pixels && metaEvents.length > 0) {
      const pii = extractPIIFromAnswers(
        answers as Record<string, unknown>,
        effectiveQuestions as Array<{ id: string; type?: string; title?: string; fields?: Array<{ id: string; ref?: string }> }>
      )
      const userAgent = req.headers.get('user-agent') ?? undefined
      const referer = req.headers.get('referer') ?? undefined
      for (const eventId of metaEvents) {
        postSubmitTasks.push(
          sendMetaCAPIEvent({
            ...pii,
            ip,
            userAgent,
            eventId,
            formTitle: form.title ?? undefined,
            eventSourceUrl: referer,
          }).catch((err) => logError('Failed to send Meta CAPI event', err))
        )
      }
    }

    // Webhook externo configurado pelo usuário — feature gated
    if (form.webhook_url && ownerPlanConfig?.webhooks) {
      // Enriquecer payload com metadata dos campos + lead canônico
      const fields = effectiveQuestions.map(q => ({
        question_id: q.id,
        type: q.type,
        title: q.title,
      }))
      const lead = extractLead({
        responseData: answers as Record<string, unknown>,
        questions: effectiveQuestions.map(q => ({ id: q.id, title: q.title, type: q.type })),
      })
      postSubmitTasks.push(
        dispatchWebhook({
          webhookUrl: form.webhook_url,
          formId: form_id as string,
          responseId,
          responseData: answers as Record<string, unknown>,
          fields,
          lead,
          urlParams: effectiveUrlParams,
        }).catch((err) => logError('Failed to dispatch webhook', err))
      )
    }
  }

  if (postSubmitTasks.length > 0) {
    // Auditoria Codex 2026-07-23: o submit do LEAD esperava as notificações
    // (WhatsApp podia segurar até 30s). `after()` devolve a resposta JÁ e roda
    // as tarefas depois, sem risco de freeze na Vercel. Fallback: fora de um
    // request scope (testes), `after` lança — aí degrada pro comportamento antigo.
    try {
      after(async () => { await Promise.allSettled(postSubmitTasks) })
    } catch (err) {
      // Fallback esperado só FORA de request scope (vitest). Qualquer outra
      // falha de after() é anômala — loga antes de degradar pro modo síncrono
      // (auditoria Codex 2026-07-23: catch silencioso ocultava erro real).
      logError('[responses] after() indisponível — degradando para pós-submit síncrono', err)
      await Promise.allSettled(postSubmitTasks)
    }
  }

  // Detector PASSIVO de duplicatas (Fase 3 em avaliação — auditoria Codex
  // 2026-07-08): quando o submit criou response NOVA e completa, loga se existe
  // parcial recente do mesmo form com identidade (e-mail/telefone) coincidente.
  // SÓ LOG — nenhuma ação. Mede a duplicação residual (storage perdido/webview)
  // pra decidir com número se a reconciliação da Fase 3 vale o risco.
  if (createdFresh && completed) {
    await logPossibleDuplicatePartial(supabase, form_id as string, responseId, effectiveQuestions, answers as Record<string, unknown>, urlParams)
  }

  // Resposta anônima incompleta: devolve a prova de posse (A1) para o cliente
  // poder completar via upsert depois — o response_id sozinho não autoriza mais.
  const issuePartialToken = !completed && typeof respondent_id !== 'string'
  return NextResponse.json(
    {
      response_id: responseId,
      completed,
      ...(issuePartialToken ? { partial_token: signPartialToken(responseId) } : {}),
    },
    {
      status: existingResponseId ? 200 : 201,
      headers: {
        ...CORS_HEADERS,
        'X-RateLimit-Limit': '10',
        'X-RateLimit-Remaining': String(rateCheck.remaining),
      },
    }
  )
  } catch (err) {
    logError('POST /api/responses crashed:', err)
    return NextResponse.json({ error: 'Erro interno do servidor', detail: err instanceof Error ? err.message : String(err) }, { status: 500, headers: CORS_HEADERS })
  }
}

// GET /api/responses — list responses for authenticated user
// Note: Uses admin client to bypass RLS, but auth is enforced via getRequestUser()
// No CORS headers on GET — this is an authenticated dashboard endpoint, not public
export async function GET(req: NextRequest) {
  const supabase = createAdminClient()
  const user = await getRequestUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  // P1-5: Rate limit GET responses (60 req/min per user)
  const rlKey = `responses:get:${user.id}`
  const { allowed: rlAllowed } = await checkRateLimitAsync(rlKey, { maxAttempts: 60, windowMs: 60_000 })
  if (!rlAllowed) {
    return NextResponse.json({ error: 'Muitas requisições. Tente novamente mais tarde.' }, { status: 429 })
  }

  const url = new URL(req.url)
  const formId = url.searchParams.get('form_id')
  const page = parseInt(url.searchParams.get('page') ?? '1')
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20'), 100)
  const offset = (page - 1) * limit

  // Validate that the form belongs to this user (if form_id provided)
  if (formId) {
    const { data: form } = await supabase
      .from('forms')
      .select('id')
      .eq('id', formId)
      .eq('user_id', user.id)
      .single()

    if (!form) {
      return NextResponse.json({ error: 'Formulário não encontrado' }, { status: 404 })
    }
  }

  let query = supabase
    .from('responses')
    .select('id, form_id, answers, meta_events, completed, submitted_at, last_question_answered, utm_source, utm_medium, utm_campaign, utm_term, utm_content', { count: 'exact' })
    .order('submitted_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limit - 1)

  if (formId) {
    query = query.eq('form_id', formId)
  } else {
    // Get all responses for forms owned by this user
    const { data: forms } = await supabase
      .from('forms')
      .select('id')
      .eq('user_id', user.id)

    const formIds = (forms ?? []).map((f: { id: string }) => f.id)
    if (formIds.length === 0) {
      return NextResponse.json({ responses: [], pagination: { page, limit, total: 0, total_pages: 0 } })
    }
    query = query.in('form_id', formIds)
  }

  const { data: responses, error, count } = await query

  if (error) {
    return NextResponse.json({ error: 'Falha ao buscar respostas' }, { status: 500 })
  }

  return NextResponse.json({
    responses,
    pagination: {
      page,
      limit,
      total: count ?? 0,
      total_pages: Math.ceil((count ?? 0) / limit),
    },
  })
}

// ── Detector passivo de duplicatas (log-only) ────────────────────────────────
// Fase 3 (reconciliação por identidade) está EM AVALIAÇÃO — decisão da
// auditoria: medir a duplicação residual pós-Fase 1 antes de implementar.
// Este detector NUNCA age: identidade identifica, não prova posse.
async function logPossibleDuplicatePartial(
  supabase: ReturnType<typeof createAdminClient>,
  formId: string,
  newResponseId: string,
  questions: QuestionConfig[],
  answers: Record<string, unknown>,
  urlParams: Record<string, string> | null
): Promise<void> {
  try {
    const newIdentity = extractIdentity(questions, answers, urlParams)
    if (!newIdentity.email && !newIdentity.phone) return

    const cutoff = new Date(Date.now() - 48 * 3600 * 1000).toISOString()
    const { data: partials } = await supabase
      .from('responses')
      .select('id, answers, url_params, created_at')
      .eq('form_id', formId)
      .eq('completed', false)
      .gte('created_at', cutoff)
      .neq('id', newResponseId)
      .order('created_at', { ascending: false })
      .limit(25) as { data: { id: string; answers: Record<string, unknown> | null; url_params?: Record<string, string> | null; created_at: string }[] | null; error: unknown }
    if (!partials?.length) return

    for (const p of partials) {
      const pIdentity = extractIdentity(questions, p.answers, sanitizeUrlParams(p.url_params))
      if (identitiesMatch(newIdentity, pIdentity)) {
        // Sem PII no log: só ids, o TIPO do campo que casou e a idade da parcial.
        console.warn('[reconcile-detector] parcial recente com identidade coincidente (log-only)', {
          formId,
          completedResponseId: newResponseId,
          partialResponseId: p.id,
          matchedOn: newIdentity.email && pIdentity.email === newIdentity.email ? 'email' : 'phone',
          partialAgeMin: Math.round((Date.now() - new Date(p.created_at).getTime()) / 60000),
        })
        return // primeiro match basta pra medição
      }
    }
  } catch (e) {
    logError('[reconcile-detector] failed', e, { formId })
  }
}
