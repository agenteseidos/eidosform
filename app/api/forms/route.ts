import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { FormInsert, FormStatus } from '@/lib/database.types'
import { validateWebhookUrl } from '@/lib/webhook-validator'
import { getRequestUser } from '@/lib/supabase/request-auth'
import { checkFormLimit } from '@/lib/plan-limits'
import { PLANS } from '@/lib/plan-limits'
import { normalizePlan } from '@/lib/plans'
import { logError } from '@/lib/logger'
import { isSafeUrl } from '@/lib/html'
import { FormCreateSchema, formatZodIssues } from '@/lib/schemas/form-schema'
import { sanitizeContentBlocks } from '@/lib/html'

// T2: Ensure URLs have protocol before persisting
function ensureHttps(url: string): string {
  if (!url) return url
  const trimmed = url.trim()
  if (!trimmed) return trimmed
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

// GET /api/forms — list all forms for authenticated user
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const user = await getRequestUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '20')
  const offset = (page - 1) * limit

  let query = supabase
    .from('forms')
    .select('id, title, description, slug, status, theme, plan, redirect_url, webhook_url, pixels, created_at, updated_at', { count: 'exact' })
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) {
    query = query.eq('status', status as FormStatus)
  }

  const { data, error, count } = await query

  if (error) {
    logError('Failed to list forms:', error)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }

  return NextResponse.json({
    forms: data,
    total: count,
    page,
    limit,
  })
}

// POST /api/forms — create new form
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const user = await getRequestUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check form limit before allowing creation
  const formLimit = await checkFormLimit(user.id)
  if (!formLimit.allowed) {
    return NextResponse.json(
      { error: `Limite de formulários atingido (${formLimit.usage}/${formLimit.limit}). Faça upgrade do plano.` },
      { status: 403 }
    )
  }

  const rawBody = await req.json()

  // Etapa 7 — Zod schema validation (defense-in-depth before business rules).
  const parsed = FormCreateSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Payload inválido', issues: formatZodIssues(parsed.error) },
      { status: 400 }
    )
  }
  const body = parsed.data
  const { title, description, slug, theme, questions, thank_you_message, pixels, redirect_url, webhook_url } = body

  // Fetch plan for feature gates and limits
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', user.id)
    .single()
  const userPlan = normalizePlan((profile as { plan: string } | null)?.plan)
  const planConfig = PLANS[userPlan]

  // P1-E: Validate question count and payload size per plan
  const formQuestions = Array.isArray(questions) ? questions : []
  if (formQuestions.length > (planConfig?.maxQuestions ?? 25)) {
    return NextResponse.json(
      { error: `Limite de ${planConfig?.maxQuestions ?? 25} perguntas por formulário atingido (seu plano: ${userPlan})` },
      { status: 403 }
    )
  }
  const serializedSize = JSON.stringify(formQuestions).length
  if (serializedSize > 500_000) {
    return NextResponse.json(
      { error: 'Payload de perguntas excede 500KB. Reduza o tamanho das perguntas.' },
      { status: 413 }
    )
  }
  // Validate URLs inside questions to prevent XSS (javascript:, data: URIs)
  const urlError = validateQuestionUrls(formQuestions)
  if (urlError) {
    return NextResponse.json({ error: urlError }, { status: 400 })
  }

  // Validate webhook_url if provided
  if (webhook_url) {
    const webhookCheck = validateWebhookUrl(webhook_url)
    if (!webhookCheck.safe) {
      return NextResponse.json({ error: `URL de webhook inválida: ${webhookCheck.reason}` }, { status: 400 })
    }
  }

  // P1 FIX: Strip pixels for free/starter users on form creation
  let sanitizedPixels: Record<string, unknown> | null = null
  if (pixels && typeof pixels === 'object') {
    if (planConfig?.pixels) {
      // Remove null entries to match PixelConfig (optional string fields, never null)
      const cleaned: Record<string, string> = {}
      for (const [k, v] of Object.entries(pixels as Record<string, unknown>)) {
        if (v != null && v !== '') cleaned[k] = String(v)
      }
      sanitizedPixels = Object.keys(cleaned).length > 0 ? cleaned : null
    }
  }

  // P1 FIX: Block webhook_url for users without webhooks feature
  const sanitizedWebhookUrl = (webhook_url && planConfig?.webhooks) ? webhook_url : null

  // P0-FB1: server-side sanitize content_block bodies before persisting.
  const sanitizedQuestions = sanitizeContentBlocks(questions ?? []) as FormInsert['questions']

  const insert: FormInsert = {
    user_id: user.id,
    title,
    description: description || null,
    slug,
    status: 'draft',
    theme: theme || 'midnight',
    questions: sanitizedQuestions ?? [],
    thank_you_message: thank_you_message || 'Obrigado pela sua resposta!',
    pixels: sanitizedPixels,
    plan: userPlan,
    redirect_url: redirect_url ? ensureHttps(redirect_url) : null,
    webhook_url: sanitizedWebhookUrl,
  }

  const { data, error } = await supabase
    .from('forms')
    .insert(insert)
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Este slug já está em uso' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }

  return NextResponse.json({ form: data }, { status: 201 })
}

function validateQuestionUrls(questions: unknown[]): string | null {
  for (const q of questions) {
    if (!q || typeof q !== 'object') continue
    const question = q as Record<string, unknown>
    if (!isSafeUrl(question.contentButtonUrl)) {
      return 'URL inválida em contentButtonUrl: protocolo não permitido'
    }
    if (!isSafeUrl(question.imageUrl)) {
      return 'URL inválida em imageUrl: protocolo não permitido'
    }
    if (!isSafeUrl(question.videoUrl)) {
      return 'URL inválida em videoUrl: protocolo não permitido'
    }
  }
  return null
}
