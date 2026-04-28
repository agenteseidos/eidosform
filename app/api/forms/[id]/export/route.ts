import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { PLANS, PlanName } from '@/lib/plan-limits'
import { buildExcelExport } from '@/lib/export-excel'
import { buildPdfExport } from '@/lib/export-pdf'
import { sanitizeCellValue } from '@/lib/sanitize-formula'
import { checkRateLimitAsync } from '@/lib/rate-limit'

interface QuestionRow {
  id: string
  title: string
}

interface ResponseRow {
  id: string
  answers: Record<string, unknown>
  completed: boolean
  submitted_at: string
  meta_events: string[] | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_term: string | null
  utm_content: string | null
}

interface RouteParams {
  params: Promise<{ id: string }>
}

// GET /api/forms/[id]/export?format=csv
export async function GET(req: NextRequest, { params }: RouteParams) {
  const { searchParams } = new URL(req.url)
  const format = searchParams.get('format') || 'csv'

  if (format !== 'csv' && format !== 'xlsx' && format !== 'pdf') {
    return NextResponse.json({ error: 'Formato não suportado. Use ?format=csv, ?format=xlsx ou ?format=pdf' }, { status: 400 })
  }

  const supabase = await createClient()
  const { id } = await params

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // P0-04: Gate CSV export by plan
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', user.id)
    .single()

  const userPlan = (profile?.plan ?? 'free') as PlanName

  // P1-I: Rate limit export endpoint (10 requests per minute per user)
  const rlKey = `export:${user.id}`
  const { allowed: rlAllowed } = await checkRateLimitAsync(rlKey, { maxAttempts: 10, windowMs: 60_000 })
  if (!rlAllowed) {
    return NextResponse.json(
      { error: 'Muitas requisições de exportação. Tente novamente mais tarde.' },
      { status: 429 }
    )
  }

  if (!PLANS[userPlan]?.csvExport) {
    return NextResponse.json(
      { error: 'Exportação CSV disponível a partir do plano Starter' },
      { status: 403 }
    )
  }

  if (format === 'pdf' && !PLANS[userPlan]?.pdfExport) {
    return NextResponse.json(
      { error: 'Exportação PDF disponível a partir do plano Plus' },
      { status: 403 }
    )
  }

  const { data: form, error: formError } = await supabase
    .from('forms')
    .select('id, title, questions')
    .eq('id', id)
    .eq('user_id', user.id)
    .single() as { data: { id: string; title: string; questions: QuestionRow[] } | null; error: unknown }

  if (formError || !form) {
    return NextResponse.json({ error: 'Form not found' }, { status: 404 })
  }

  const questions: QuestionRow[] = Array.isArray(form.questions) ? form.questions : []

  const { data: responses, error: responsesError } = await supabase
    .from('responses')
    .select('id, answers, completed, submitted_at, meta_events, utm_source, utm_medium, utm_campaign, utm_term, utm_content')
    .eq('form_id', id)
    .order('submitted_at', { ascending: true }) as { data: ResponseRow[] | null; error: { message: string } | null }

  if (responsesError) {
    return NextResponse.json({ error: responsesError.message }, { status: 500 })
  }

  const escapeCSV = (value: unknown): string => {
    const str = sanitizeCellValue(Array.isArray(value) ? value.join('; ') : String(value ?? ''))
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }

  const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const
  const questionIds = questions.map(q => q.id)
  const questionTitles = questions.map(q => q.title)
  const headers = ['ID', 'Submetido em', 'Completo', ...questionTitles, 'meta_events', ...UTM_KEYS]
  const rows: string[] = [headers.map(escapeCSV).join(',')]

  for (const response of (responses || [])) {
    const answerMap = response.answers || {}
    const row = [
      response.id,
      new Date(response.submitted_at).toLocaleString('pt-BR'),
      response.completed ? 'Sim' : 'Não',
      ...questionIds.map(qid => answerMap[qid] ?? ''),
      (response.meta_events || []).join('; '),
      ...UTM_KEYS.map(k => response[k] ?? ''),
    ]
    rows.push(row.map(escapeCSV).join(','))
  }

  if (format === 'xlsx') {
    const buffer = await buildExcelExport(form.title, questions, responses || [])
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="respostas-${id}.xlsx"`,
      },
    })
  }

  if (format === 'pdf') {
    const hideBranding = !!PLANS[userPlan]?.pdfExport
    const pdf = buildPdfExport(form.title, questions, responses || [], hideBranding)
    return new NextResponse(pdf as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="respostas-${id}.pdf"`,
      },
    })
  }

  const csv = '\uFEFF' + rows.join('\r\n')

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="respostas-${id}.csv"`,
    },
  })
}
