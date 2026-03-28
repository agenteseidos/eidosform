import type { ResponseInsert, ResponseUpdate, AnswerItemInsert } from '@/lib/database.types'
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { authenticateApiKey } from '@/lib/api-key-auth'
import { checkResponseLimit, incrementResponseCount } from '@/lib/plan-limits'
import { dispatchWebhook } from '@/lib/webhook-dispatcher'
import { checkSubmissionRateLimit, isResponseComplete, MAX_ANSWER_KEYS, MAX_PAYLOAD_BYTES, sanitizeValue } from '@/lib/form-response-security'

interface RouteParams {
  params: Promise<{ id: string }>
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, Authorization',
  'Access-Control-Max-Age': '86400',
}

// OPTIONS — CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

function getServiceClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } }
  )
}

// GET /api/v1/forms/[id]
export async function GET(req: NextRequest, { params }: RouteParams) {
  const auth = await authenticateApiKey(req)
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error, retryAfter: auth.retryAfter },
      { status: auth.status, headers: CORS_HEADERS }
    )
  }

  const { id } = await params
  const supabase = getServiceClient()
  const url = new URL(req.url)
  const subpath = url.searchParams.get('resource')

  // GET /api/v1/forms/[id]?resource=responses
  if (subpath === 'responses') {
    const page = parseInt(url.searchParams.get('page') ?? '1')
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20'), 100)
    const offset = (page - 1) * limit

    const { data: form } = await supabase
      .from('forms')
      .select('id')
      .eq('id', id)
      .eq('user_id', auth.userId)
      .single()

    if (!form) {
      return NextResponse.json(
        { error: 'Form not found' },
        { status: 404, headers: CORS_HEADERS }
      )
    }

    const { data: responses, count, error } = await supabase
      .from('responses')
      .select('id, answers, completed, last_question_answered, created_at, updated_at', { count: 'exact' })
      .eq('form_id', id)
      .eq('completed', true)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch responses' },
        { status: 500, headers: CORS_HEADERS }
      )
    }

    return NextResponse.json(
      {
        responses,
        pagination: {
          page,
          limit,
          total: count ?? 0,
          total_pages: Math.ceil((count ?? 0) / limit),
        },
      },
      { headers: CORS_HEADERS }
    )
  }

  // GET /api/v1/forms/[id] — form details
  const { data: formData, error } = await supabase
    .from('forms')
    .select('id, title, slug, status, questions, settings, created_at, updated_at')
    .eq('id', id)
    .eq('user_id', auth.userId)
    .single()

  if (error || !formData) {
    return NextResponse.json(
      { error: 'Form not found' },
      { status: 404, headers: CORS_HEADERS }
    )
  }

  return NextResponse.json({ form: formData }, { headers: CORS_HEADERS })
}

// POST /api/v1/forms/[id]
export async function POST(req: NextRequest, { params }: RouteParams) {
  const auth = await authenticateApiKey(req)
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error, retryAfter: auth.retryAfter },
      { status: auth.status, headers: CORS_HEADERS }
    )
  }

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

  const contentLength = req.headers.get('content-length')
  if (contentLength && parseInt(contentLength) > MAX_PAYLOAD_BYTES) {
    return NextResponse.json(
      { error: 'Payload muito grande' },
      { status: 413, headers: CORS_HEADERS }
    )
  }

  const { id } = await params
  const supabase = getServiceClient()

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
    return NextResponse.json(
      { error: 'Dados inválidos' },
      { status: 400, headers: CORS_HEADERS }
    )
  }

  const answers = sanitizeValue(body.answers) as Record<string, unknown> | undefined
  const lastQuestionAnswered = body.last_question_answered as string | undefined
  const existingResponseId = req.headers.get('x-response-id')

  if (!answers || typeof answers !== 'object') {
    return NextResponse.json(
      { error: 'answers is required' },
      { status: 400, headers: CORS_HEADERS }
    )
  }

  if (Object.keys(answers).length > MAX_ANSWER_KEYS) {
    return NextResponse.json(
      { error: 'Número de respostas excede o limite' },
      { status: 400, headers: CORS_HEADERS }
    )
  }

  const { data: form } = await supabase
    .from('forms')
    .select('id, user_id, status, questions, webhook_url')
    .eq('id', id)
    .eq('user_id', auth.userId)
    .eq('status', 'published')
    .single() as {
      data: {
        id: string
        user_id: string
        status: string
        questions: Array<{ id: string; required?: boolean }> | null
        webhook_url: string | null
      } | null
    }

  if (!form) {
    return NextResponse.json(
      { error: 'Form not found or not published' },
      { status: 404, headers: CORS_HEADERS }
    )
  }

  const completed = isResponseComplete(answers, form.questions ?? [])

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
    const { data: updated, error } = await supabase
      .from('responses')
      .update({
        answers: answers as Record<string, import('@/lib/database.types').Json>,
        completed,
        last_question_answered: lastQuestionAnswered ?? null,
      } as ResponseUpdate)
      .eq('id', existingResponseId)
      .eq('form_id', id)
      .select('id')
      .single() as { data: { id: string } | null; error: unknown }

    if (error || !updated) {
      return NextResponse.json(
        { error: 'Response not found' },
        { status: 404, headers: CORS_HEADERS }
      )
    }

    responseId = updated.id
    await supabase.from('answer_items').delete().eq('response_id', responseId)
  } else {
    const { data: response, error } = await supabase
      .from('responses')
      .insert({
        form_id: id,
        answers: answers as Record<string, import('@/lib/database.types').Json>,
        completed,
        last_question_answered: lastQuestionAnswered ?? null,
      } as ResponseInsert)
      .select('id')
      .single() as { data: { id: string } | null; error: unknown }

    if (error || !response) {
      return NextResponse.json(
        { error: 'Failed to save response' },
        { status: 500, headers: CORS_HEADERS }
      )
    }

    responseId = response.id
    await incrementResponseCount(form.user_id).catch(console.error)
  }

  const answerItems = Object.entries(answers).map(([questionId, value]) => ({
    response_id: responseId,
    question_id: questionId,
    value: Array.isArray(value) ? value.join(', ') : String(value ?? ''),
  }))

  if (answerItems.length > 0) {
    await supabase.from('answer_items').insert(answerItems as AnswerItemInsert[])
  }

  if (completed && form.webhook_url) {
    dispatchWebhook({
      webhookUrl: form.webhook_url,
      formId: id,
      responseId,
      responseData: answers,
    }).catch(console.error)
  }

  return NextResponse.json(
    { response_id: responseId, completed },
    {
      status: existingResponseId ? 200 : 201,
      headers: {
        ...CORS_HEADERS,
        'X-RateLimit-Limit': '10',
        'X-RateLimit-Remaining': String(rateCheck.remaining),
      },
    }
  )
}
