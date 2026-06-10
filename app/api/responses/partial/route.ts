import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkResponseRateLimitAsync } from '@/lib/response-rate-limit'
import { upsertSubmission } from '@/lib/google-sheets'
import { logError } from '@/lib/logger'
import { pruneOrphanAnswers, validateAllAnswers } from '@/lib/field-validators'
import { signPartialToken, verifyPartialToken } from '@/lib/partial-token'
import type { QuestionConfig, ResponseInsert } from '@/lib/database.types'

// POST /api/responses/partial
//
// Endpoint público (sem auth) que cria/atualiza uma row "Parcial" em
// `responses` e na planilha Google Sheets conectada ao form. Usado pelo
// form-player com debounce de 60s — quando o respondente pausa de digitar,
// dispara este endpoint pra preservar o que ele já preencheu.
//
// Flow:
//   1ª chamada (sem x-response-id):
//     - INSERT em responses (completed=false, sheets_row_index=null)
//     - upsertSubmission no Sheets → captura rowIndex → grava em
//       responses.sheets_row_index
//     - retorna { response_id }
//   chamadas seguintes (com x-response-id):
//     - UPDATE em responses pelo id
//     - upsertSubmission com o sheets_row_index salvo → UPDATE direto na
//       linha específica (sem scan)
//
// Plan gating: integração Sheets já é Plus+. Se o form não tem Sheets
// habilitado, o endpoint só grava em `responses` (sem ir ao Sheets).
// O submit final continua em /api/responses; se já houver response_id,
// ele atualiza a mesma linha pra status=Completo.

const MAX_PAYLOAD_BYTES = 50 * 1024
const MAX_ANSWER_KEYS = 200

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Response-Id, X-Partial-Token',
  'Access-Control-Max-Age': '86400',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

function sanitizeValue(val: unknown): unknown {
  if (typeof val === 'string') return val.replace(/<[^>]*>/g, '')
  if (Array.isArray(val)) return val.map(sanitizeValue)
  if (val && typeof val === 'object') {
    return Object.fromEntries(
      Object.entries(val as Record<string, unknown>).map(([k, v]) => [k, sanitizeValue(v)])
    )
  }
  return val
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? 'unknown'

  // Rate limit por IP (mesma estratégia do /api/responses, 10 req/min)
  const rateCheck = await checkResponseRateLimitAsync(ip)
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: 'Muitas requisições. Tente novamente em instantes.' },
      { status: 429, headers: CORS_HEADERS }
    )
  }

  // Parse + size guard
  let rawBody: string
  let body: Record<string, unknown>
  try {
    rawBody = await req.text()
    if (rawBody.length > MAX_PAYLOAD_BYTES) {
      return NextResponse.json({ error: 'Payload muito grande' }, { status: 413, headers: CORS_HEADERS })
    }
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Dados inválidos' }, { status: 400, headers: CORS_HEADERS })
  }

  const { form_id, last_question_answered } = body
  const utmData = {
    utm_source: typeof body.utm_source === 'string' ? body.utm_source : null,
    utm_medium: typeof body.utm_medium === 'string' ? body.utm_medium : null,
    utm_campaign: typeof body.utm_campaign === 'string' ? body.utm_campaign : null,
    utm_term: typeof body.utm_term === 'string' ? body.utm_term : null,
    utm_content: typeof body.utm_content === 'string' ? body.utm_content : null,
  }

  if (!form_id || typeof form_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(form_id)) {
    return NextResponse.json({ error: 'ID do formulário inválido' }, { status: 400, headers: CORS_HEADERS })
  }

  const answers = sanitizeValue(body.answers) as Record<string, unknown> | undefined
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    return NextResponse.json({ error: 'Respostas em formato inválido' }, { status: 400, headers: CORS_HEADERS })
  }
  if (Object.keys(answers).length === 0) {
    // Respondente ainda não preencheu nada — nada a salvar
    return NextResponse.json({ skipped: true }, { status: 200, headers: CORS_HEADERS })
  }
  if (Object.keys(answers).length > MAX_ANSWER_KEYS) {
    return NextResponse.json({ error: 'Número de respostas excede o limite' }, { status: 400, headers: CORS_HEADERS })
  }

  const supabase = createAdminClient()

  // Form + dono (precisa do plano pro gating do Sheets)
  const { data: form, error: formError } = await supabase
    .from('forms')
    .select('id, user_id, questions, status, is_closed, paused, google_sheets_enabled, google_sheets_id')
    .eq('id', form_id)
    .eq('status', 'published')
    .single() as { data: { id: string; user_id: string; questions: QuestionConfig[]; status: string; is_closed: boolean; paused: boolean; google_sheets_enabled: boolean; google_sheets_id: string | null } | null; error: unknown }

  if (formError || !form) {
    return NextResponse.json({ error: 'Formulário não encontrado' }, { status: 404, headers: CORS_HEADERS })
  }
  if (form.is_closed || form.paused) {
    return NextResponse.json({ error: 'Formulário indisponível' }, { status: 403, headers: CORS_HEADERS })
  }

  // Sanitiza respostas órfãs (mesma lógica do /api/responses)
  const formQuestions = (form.questions ?? []) as QuestionConfig[]
  const { pruned } = pruneOrphanAnswers(formQuestions, answers)
  if (Object.keys(pruned).length === 0) {
    return NextResponse.json({ skipped: true }, { status: 200, headers: CORS_HEADERS })
  }

  // Validação leve por tipo — só pra não persistir lixo. Em parcial, não
  // tomamos field_errors como erro fatal; descartamos o que não passa.
  const errs = validateAllAnswers(formQuestions, pruned)
  const invalidIds = new Set(errs.map((e) => e.questionId))
  const valid: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(pruned)) {
    if (!invalidIds.has(k)) valid[k] = v
  }
  if (Object.keys(valid).length === 0) {
    return NextResponse.json({ skipped: true }, { status: 200, headers: CORS_HEADERS })
  }

  // sendBeacon não suporta headers — aceita response_id também via body como fallback.
  const headerResponseId = req.headers.get('x-response-id')
  const bodyResponseId = typeof body.response_id === 'string' ? body.response_id : null
  const existingResponseId = headerResponseId || bodyResponseId
  // A1 (auditoria 2026-06-10): UPDATE exige prova de posse — o partial_token
  // emitido na criação. Sem token válido, o id sozinho não autoriza sobrescrever.
  const headerPartialToken = req.headers.get('x-partial-token')
  const bodyPartialToken = typeof body.partial_token === 'string' ? body.partial_token : null
  const partialToken = headerPartialToken || bodyPartialToken
  let responseId: string
  let currentRowIndex: number | null = null

  if (existingResponseId) {
    if (!verifyPartialToken(partialToken, existingResponseId)) {
      // Sem prova de posse (token ausente/ inválido) — trata como nova response
      // em vez de atualizar a existente. Não vaza se o id existe ou não.
      return await createPartialResponse({ supabase, form, answers: valid, utmData, lastQuestionAnswered: last_question_answered, formQuestions })
    }

    // UPDATE
    const { data: existing } = await supabase
      .from('responses')
      .select('id, sheets_row_index, form_id, completed')
      .eq('id', existingResponseId)
      .single() as { data: { id: string; sheets_row_index: number | null; form_id: string; completed: boolean } | null; error: unknown }

    if (!existing || existing.form_id !== form_id) {
      // Trata como nova response — cliente pode ter ID stale
      return await createPartialResponse({ supabase, form, answers: valid, utmData, lastQuestionAnswered: last_question_answered, formQuestions })
    }
    if (existing.completed) {
      // Já foi finalizado — não regredir pra parcial
      return NextResponse.json({ response_id: existing.id, skipped: 'already_completed' }, { status: 200, headers: CORS_HEADERS })
    }
    responseId = existing.id
    currentRowIndex = existing.sheets_row_index

    const { error: updateError } = await supabase
      .from('responses')
      .update({
        answers: valid as Record<string, import('@/lib/database.types').Json>,
        last_question_answered: typeof last_question_answered === 'string' ? last_question_answered : null,
        ...utmData,
      })
      .eq('id', responseId)
    if (updateError) {
      logError('[partial] update responses failed', updateError, { responseId })
      return NextResponse.json({ error: 'Erro ao salvar progresso' }, { status: 500, headers: CORS_HEADERS })
    }
  } else {
    return await createPartialResponse({ supabase, form, answers: valid, utmData, lastQuestionAnswered: last_question_answered, formQuestions })
  }

  // Upsert no Sheets (gating pelo plano + integração habilitada)
  await syncToSheetsIfEnabled({
    supabase,
    form,
    answers: valid,
    utmData,
    responseId,
    formQuestions,
    currentRowIndex,
  })

  return NextResponse.json(
    { response_id: responseId, partial_token: signPartialToken(responseId) },
    { status: 200, headers: CORS_HEADERS }
  )
}

async function createPartialResponse(opts: {
  supabase: ReturnType<typeof createAdminClient>
  form: { id: string; user_id: string; google_sheets_enabled: boolean; google_sheets_id: string | null }
  answers: Record<string, unknown>
  utmData: Record<string, string | null>
  lastQuestionAnswered: unknown
  formQuestions: QuestionConfig[]
}): Promise<NextResponse> {
  const { supabase, form, answers, utmData, lastQuestionAnswered, formQuestions } = opts
  const insertPayload: ResponseInsert = {
    form_id: form.id,
    answers: answers as Record<string, import('@/lib/database.types').Json>,
    completed: false,
    last_question_answered: typeof lastQuestionAnswered === 'string' ? lastQuestionAnswered : null,
    utm_source: utmData.utm_source,
    utm_medium: utmData.utm_medium,
    utm_campaign: utmData.utm_campaign,
    utm_term: utmData.utm_term,
    utm_content: utmData.utm_content,
  }

  const { data: created, error: insertError } = await supabase
    .from('responses')
    .insert(insertPayload)
    .select('id')
    .single() as { data: { id: string } | null; error: unknown }

  if (insertError || !created) {
    logError('[partial] insert responses failed', insertError, { formId: form.id })
    return NextResponse.json({ error: 'Erro ao salvar progresso' }, { status: 500, headers: CORS_HEADERS })
  }

  await syncToSheetsIfEnabled({
    supabase,
    form,
    answers,
    utmData,
    responseId: created.id,
    formQuestions,
    currentRowIndex: null,
  })

  return NextResponse.json(
    { response_id: created.id, partial_token: signPartialToken(created.id) },
    { status: 201, headers: CORS_HEADERS }
  )
}

async function syncToSheetsIfEnabled(opts: {
  supabase: ReturnType<typeof createAdminClient>
  form: { id: string; user_id: string; google_sheets_enabled: boolean; google_sheets_id: string | null }
  answers: Record<string, unknown>
  utmData: Record<string, string | null>
  responseId: string
  formQuestions: QuestionConfig[]
  currentRowIndex: number | null
}): Promise<void> {
  const { supabase, form, answers, utmData, responseId, formQuestions, currentRowIndex } = opts
  if (!form.google_sheets_enabled || !form.google_sheets_id) return

  // Plano: o gating é feito no builder (toggle só fica disponível pra Plus+).
  // Se o form tem a integração habilitada, confiamos no flag e enviamos.

  const fieldLabels = formQuestions.map((q) => q.title || 'Sem título')
  const questionIdToLabel: Record<string, string> = {}
  for (const q of formQuestions) questionIdToLabel[q.id] = q.title || 'Sem título'

  try {
    const result = await upsertSubmission({
      spreadsheetId: form.google_sheets_id,
      fieldLabels,
      answers,
      questionIdToLabel,
      utmData,
      responseId,
      status: 'Parcial',
      rowIndex: currentRowIndex,
    })
    // Se foi append e capturou rowIndex novo, persiste pra próximos UPDATEs
    if (result.rowIndex && result.rowIndex !== currentRowIndex) {
      await supabase
        .from('responses')
        .update({ sheets_row_index: result.rowIndex })
        .eq('id', responseId)
    }
  } catch (e) {
    logError('[partial] sheets sync failed', e, { responseId })
  }
}
