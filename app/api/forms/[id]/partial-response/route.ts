import { NextRequest, NextResponse } from 'next/server'
import { createPublicClient } from '@/lib/supabase/public'
import { getRequestUser } from '@/lib/supabase/request-auth'
import { PLANS, PlanName } from '@/lib/plan-limits'
import { sanitizeValue } from '@/lib/form-response-security'
import { log, logError } from '@/lib/logger'
import { checkResponseRateLimitAsync } from '@/lib/response-rate-limit'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

/**
 * GET /api/forms/[id]/partial-response
 * Returns the current partial (incomplete) response for the authenticated user.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: formId } = await params

  if (!formId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(formId)) {
    return NextResponse.json({ error: 'ID do formulário inválido' }, { status: 400, headers: CORS_HEADERS })
  }

  const user = await getRequestUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
  }

  const supabase = createPublicClient()

  // Verify form exists and is published
  const { data: form, error: formError } = await supabase
    .from('forms')
    .select('id, user_id, status')
    .eq('id', formId)
    .eq('status', 'published')
    .single()

  if (formError || !form) {
    return NextResponse.json({ error: 'Formulário não encontrado' }, { status: 404, headers: CORS_HEADERS })
  }

  // Check if form owner's plan supports partial responses
  const { data: ownerProfile } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', form.user_id)
    .single()

  const ownerPlan = (ownerProfile?.plan ?? 'free') as PlanName
  if (!PLANS[ownerPlan]?.partialResponses) {
    return NextResponse.json({ answers: null }, { status: 200, headers: CORS_HEADERS })
  }

  // Fetch the latest incomplete response for this user + form
  const { data: partial } = await supabase
    .from('responses')
    .select('id, answers, last_question_answered, submitted_at')
    .eq('form_id', formId)
    .eq('respondent_id', user.id)
    .eq('completed', false)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .single()

  if (!partial) {
    return NextResponse.json({ answers: null }, { status: 200, headers: CORS_HEADERS })
  }

  log('Partial response loaded', { formId, responseId: partial.id, respondentId: user.id })

  return NextResponse.json(
    {
      response_id: partial.id,
      answers: partial.answers,
      last_question_answered: partial.last_question_answered,
      saved_at: partial.submitted_at,
    },
    { status: 200, headers: CORS_HEADERS }
  )
}

/**
 * PUT /api/forms/[id]/partial-response
 * Saves or updates a partial (incomplete) response for the authenticated user.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: formId } = await params

  if (!formId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(formId)) {
    return NextResponse.json({ error: 'ID do formulário inválido' }, { status: 400, headers: CORS_HEADERS })
  }

  const user = await getRequestUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
  }

  // P1-1: Rate limit partial response saves (30 req/min per IP)
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? 'unknown'
  const rateCheck = await checkResponseRateLimitAsync(ip)
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: 'Muitas requisições. Tente novamente mais tarde.' },
      { status: 429, headers: CORS_HEADERS }
    )
  }

  const supabase = createPublicClient()

  // Verify form exists and is published
  const { data: form, error: formError } = await supabase
    .from('forms')
    .select('id, user_id, status, is_closed')
    .eq('id', formId)
    .eq('status', 'published')
    .single()

  if (formError || !form) {
    return NextResponse.json({ error: 'Formulário não encontrado' }, { status: 404, headers: CORS_HEADERS })
  }

  if (form.is_closed) {
    return NextResponse.json({ error: 'Formulário fechado' }, { status: 403, headers: CORS_HEADERS })
  }

  // Check if form owner's plan supports partial responses
  const { data: ownerProfile } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', form.user_id)
    .single()

  const ownerPlan = (ownerProfile?.plan ?? 'free') as PlanName
  if (!PLANS[ownerPlan]?.partialResponses) {
    return NextResponse.json(
      { error: 'Respostas parciais não disponíveis no plano atual' },
      { status: 403, headers: CORS_HEADERS }
    )
  }

  // Parse body
  let body: { answers?: Record<string, unknown>; last_question_answered?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Dados inválidos' }, { status: 400, headers: CORS_HEADERS })
  }

  const { answers, last_question_answered } = body
  if (!answers || typeof answers !== 'object') {
    return NextResponse.json({ error: 'Respostas em formato inválido' }, { status: 400, headers: CORS_HEADERS })
  }

  const sanitizedAnswers = sanitizeValue(answers) as Record<string, unknown>

  // Upsert: find existing incomplete response or create new one
  const { data: existing } = await supabase
    .from('responses')
    .select('id')
    .eq('form_id', formId)
    .eq('respondent_id', user.id)
    .eq('completed', false)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .single()

  let responseId: string

  if (existing) {
    const { data: updated, error: updateError } = await supabase
      .from('responses')
      .update({
        answers: sanitizedAnswers as Record<string, import('@/lib/database.types').Json>,
        last_question_answered: last_question_answered ?? null,
      })
      .eq('id', existing.id)
      .select('id')
      .single()

    if (updateError || !updated) {
      logError('Failed to update partial response', updateError, { formId, respondentId: user.id })
      return NextResponse.json({ error: 'Erro ao salvar progresso' }, { status: 500, headers: CORS_HEADERS })
    }
    responseId = updated.id
  } else {
    const { data: created, error: insertError } = await supabase
      .from('responses')
      .insert({
        form_id: formId,
        respondent_id: user.id,
        answers: sanitizedAnswers as Record<string, import('@/lib/database.types').Json>,
        completed: false,
        last_question_answered: last_question_answered ?? null,
      })
      .select('id')
      .single()

    if (insertError || !created) {
      logError('Failed to create partial response', insertError, { formId, respondentId: user.id })
      return NextResponse.json({ error: 'Erro ao salvar progresso' }, { status: 500, headers: CORS_HEADERS })
    }
    responseId = created.id
  }

  log('Partial response saved', { formId, responseId, respondentId: user.id })

  return NextResponse.json(
    { response_id: responseId, saved: true },
    { status: 200, headers: CORS_HEADERS }
  )
}
