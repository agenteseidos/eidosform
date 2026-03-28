import type { ResponseInsert, ResponseUpdate, AnswerItemInsert, QuestionConfig } from '@/lib/database.types'
import { NextRequest, NextResponse } from 'next/server'
import { createPublicClient } from '@/lib/supabase/public'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRequestUser } from '@/lib/supabase/request-auth'
import { checkResponseLimit, incrementResponseCount } from '@/lib/plan-limits'
import { dispatchWebhook } from '@/lib/webhook-dispatcher'
import { checkResponseRateLimitAsync } from '@/lib/response-rate-limit'
import { validateAllAnswers } from '@/lib/field-validators'

// Maximum payload size (50KB — generous for form data, blocks abuse)
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
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Response-Id',
  'Access-Control-Max-Age': '86400',
}

// OPTIONS /api/responses — CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

// Sanitize string: strip HTML tags to prevent stored XSS (Bug #9)
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

// Check if all required questions are answered (Bug #5)
function isResponseComplete(
  answers: Record<string, unknown>,
  questions: Array<{ id: string; required?: boolean }>
): boolean {
  const requiredIds = questions.filter((q) => q.required).map((q) => q.id)
  if (requiredIds.length === 0) return true
  return requiredIds.every((id) => {
    const val = answers[id]
    if (val === undefined || val === null || val === '') return false
    if (Array.isArray(val) && val.length === 0) return false
    return true
  })
}

// POST /api/responses — submeter resposta (completa ou parcial)
export async function POST(req: NextRequest) {
  // Bug #2: Rate limit — max 10 per minute per IP
  const rateCheck = await checkSubmissionRateLimit(req)
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

  const { form_id, last_question_answered } = body

  // Honeypot: if _hp_ field is filled, silently accept but don't save (bot trap)
  if (body._hp_ && String(body._hp_).length > 0) {
    return NextResponse.json(
      { response_id: 'ok', completed: true },
      { status: 201, headers: CORS_HEADERS }
    )
  }

  // Bug #9: Sanitize answers
  const answers = sanitizeValue(body.answers) as Record<string, unknown> | undefined

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
    .select('id, questions, status, user_id, webhook_url')
    .eq('id', form_id as string)
    .eq('status', 'published')
    .single() as { data: { id: string; questions: Array<{ id: string; required?: boolean }>; status: string; user_id: string; webhook_url: string | null } | null; error: unknown }

  if (formError || !form) {
    return NextResponse.json({ error: 'Formulário não encontrado ou não publicado' }, { status: 404, headers: CORS_HEADERS })
  }

  // B16b: Validação backend por tipo de campo
  const fieldErrors = validateAllAnswers(
    (form.questions ?? []) as QuestionConfig[],
    answers as Record<string, unknown>
  )
  if (fieldErrors.length > 0) {
    return NextResponse.json(
      { error: 'Dados inválidos', field_errors: fieldErrors },
      { status: 422, headers: CORS_HEADERS }
    )
  }

  // Bug #5: Auto-detect completed based on required questions
  const completed = isResponseComplete(answers, form.questions ?? [])

  // Bug #1: ALWAYS check response limit before accepting (not just completed)
  const existingResponseId = req.headers.get('x-response-id')
  if (!existingResponseId) {
    const limitCheck = await checkResponseLimit(form.user_id)
    if (!limitCheck.allowed) {
      return NextResponse.json(
        { error: 'Limite de respostas atingido para o plano atual', plan: limitCheck.plan, limit: limitCheck.limit },
        { status: 429, headers: CORS_HEADERS }
      )
    }
  }

  let responseId: string

  if (existingResponseId) {
    const { data: updated, error: updateError } = await supabase
      .from('responses')
      .update({ answers, completed, last_question_answered: last_question_answered ?? null } as ResponseUpdate)
      .eq('id', existingResponseId)
      .eq('form_id', form_id as string)
      .select('id')
      .single() as { data: { id: string } | null; error: unknown }

    if (updateError || !updated) {
      return NextResponse.json({ error: 'Resposta não encontrada' }, { status: 404, headers: CORS_HEADERS })
    }

    responseId = updated.id
    await supabase.from('answer_items').delete().eq('response_id', responseId)
  } else {
    const { data: newResponse, error: insertError } = await supabase
      .from('responses')
      .insert({ form_id: form_id as string, answers: answers as Record<string, import('@/lib/database.types').Json>, completed, last_question_answered: last_question_answered as string ?? null } as ResponseInsert)
      .select('id')
      .single() as { data: { id: string } | null; error: { message: string } | null }

    if (insertError || !newResponse) {
      return NextResponse.json({ error: 'Erro ao salvar resposta. Tente novamente.' }, { status: 500, headers: CORS_HEADERS })
    }

    responseId = newResponse.id

    // Bug #1: Always increment response count on new responses
    await incrementResponseCount(form.user_id).catch(console.error)
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
    if (itemsError) console.error('Failed to insert answer_items:', (itemsError as { message: string }).message)
  }

  // Notificar por email e disparar webhook se resposta completa
  if (completed) {
    // Email de notificação
    try {
      const { sendNewResponseNotification } = await import('@/lib/email')
      await sendNewResponseNotification(form_id as string, form.user_id, responseId)
    } catch (e) {
      console.error('Email notification failed:', e)
    }

    // Webhook externo configurado pelo usuário
    if (form.webhook_url) {
      // Enriquecer payload com metadata dos campos
      const questions = (form.questions ?? []) as QuestionConfig[]
      const fields = questions.map(q => ({
        question_id: q.id,
        type: q.type,
        title: q.title,
      }))
      dispatchWebhook({
        webhookUrl: form.webhook_url,
        formId: form_id as string,
        responseId,
        responseData: answers as Record<string, unknown>,
        fields,
      }).catch(console.error) // fire-and-forget, não bloqueia resposta
    }
  }

  return NextResponse.json({ response_id: responseId, completed }, {
    status: existingResponseId ? 200 : 201,
    headers: {
      ...CORS_HEADERS,
      'X-RateLimit-Limit': '10',
      'X-RateLimit-Remaining': String(rateCheck.remaining),
    },
  })
}

// GET /api/responses — list responses for authenticated user
// Note: Uses admin client to bypass RLS, but auth is enforced via getRequestUser()
// No CORS headers on GET — this is an authenticated dashboard endpoint, not public
export async function GET(req: NextRequest) {
  const supabase = createAdminClient()
  const user = await getRequestUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
      return NextResponse.json({ error: 'Form not found' }, { status: 404 })
    }
  }

  let query = supabase
    .from('responses')
    .select('id, form_id, answers, completed, submitted_at, last_question_answered', { count: 'exact' })
    .order('submitted_at', { ascending: false })
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
