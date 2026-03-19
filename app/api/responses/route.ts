import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createPublicClient } from '@/lib/supabase/public'
import { checkResponseLimit, incrementResponseCount } from '@/lib/plan-limits'
import { dispatchWebhook } from '@/lib/webhook-dispatcher'
import { checkResponseRateLimit } from '@/lib/response-rate-limit'

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
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
  const rateCheck = checkResponseRateLimit(ip)
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Try again later.', retryAfter: Math.ceil(rateCheck.resetIn / 1000) },
      { status: 429 }
    )
  }

  // Use service-role client for anonymous submissions (no auth required)
  const supabase = createPublicClient()

  // Bug #6: Catch invalid JSON
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { form_id, last_question_answered } = body
  // Bug #9: Sanitize answers
  const answers = sanitizeValue(body.answers) as Record<string, unknown> | undefined

  if (!form_id) {
    return NextResponse.json({ error: 'form_id is required' }, { status: 400 })
  }

  if (!answers || typeof answers !== 'object') {
    return NextResponse.json({ error: 'answers must be an object' }, { status: 400 })
  }

  // Verificar se o formulário existe e está publicado
  const { data: form, error: formError } = await supabase
    .from('forms')
    .select('id, questions, status, user_id, webhook_url')
    .eq('id', form_id as string)
    .eq('status', 'published')
    .single() as { data: { id: string; questions: Array<{ id: string; required?: boolean }>; status: string; user_id: string; webhook_url: string | null } | null; error: unknown }

  if (formError || !form) {
    return NextResponse.json({ error: 'Form not found or not published' }, { status: 404 })
  }

  // Bug #5: Auto-detect completed based on required questions
  const completed = isResponseComplete(answers, form.questions ?? [])

  // Bug #1: ALWAYS check response limit before accepting (not just completed)
  const existingResponseId = req.headers.get('x-response-id')
  if (!existingResponseId) {
    const limitCheck = await checkResponseLimit(form.user_id)
    if (!limitCheck.allowed) {
      return NextResponse.json(
        { error: 'Response limit reached for current plan', plan: limitCheck.plan, limit: limitCheck.limit },
        { status: 429 }
      )
    }
  }

  let responseId: string

  if (existingResponseId) {
    const { data: updated, error: updateError } = await supabase
      .from('responses')
      .update({ answers, completed, last_question_answered: last_question_answered ?? null } as never)
      .eq('id', existingResponseId)
      .eq('form_id', form_id as string)
      .select('id')
      .single() as { data: { id: string } | null; error: unknown }

    if (updateError || !updated) {
      return NextResponse.json({ error: 'Response not found' }, { status: 404 })
    }

    responseId = updated.id
    await supabase.from('answer_items').delete().eq('response_id', responseId)
  } else {
    const { data: newResponse, error: insertError } = await supabase
      .from('responses')
      .insert({ form_id, answers, completed, last_question_answered: last_question_answered ?? null } as never)
      .select('id')
      .single() as { data: { id: string } | null; error: { message: string } | null }

    if (insertError || !newResponse) {
      return NextResponse.json({ error: (insertError as { message: string } | null)?.message || 'Failed to save response' }, { status: 500 })
    }

    responseId = newResponse.id

    // Bug #1: Always increment response count on new responses
    await incrementResponseCount(form.user_id).catch(console.error)
  }

  // Inserir answer_items normalizados para analytics
  const answerItems = Object.entries(answers as Record<string, unknown>).map(([questionId, value]) => ({
    response_id: responseId,
    question_id: questionId,
    value: Array.isArray(value) ? value.join(', ') : String(value ?? ''),
  }))

  if (answerItems.length > 0) {
    const { error: itemsError } = await supabase.from('answer_items').insert(answerItems as never)
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
      dispatchWebhook({
        webhookUrl: form.webhook_url,
        formId: form_id as string,
        responseId,
        responseData: answers as Record<string, unknown>,
      }).catch(console.error) // fire-and-forget, não bloqueia resposta
    }
  }

  return NextResponse.json({ response_id: responseId, completed }, { status: existingResponseId ? 200 : 201 })
}

// GET /api/responses — list responses for authenticated user
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

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
    return NextResponse.json({ error: 'Failed to fetch responses' }, { status: 500 })
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
