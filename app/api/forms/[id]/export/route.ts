import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { PLANS, PlanName } from '@/lib/plan-limits'

interface QuestionRow {
  id: string
  title: string
}

interface ResponseRow {
  id: string
  answers: Record<string, unknown>
  completed: boolean
  submitted_at: string
}

interface RouteParams {
  params: Promise<{ id: string }>
}

// GET /api/forms/[id]/export?format=csv
export async function GET(req: NextRequest, { params }: RouteParams) {
  const { searchParams } = new URL(req.url)
  const format = searchParams.get('format') || 'csv'

  if (format !== 'csv') {
    return NextResponse.json({ error: 'Formato não suportado. Use ?format=csv' }, { status: 400 })
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
  if (!PLANS[userPlan]?.csvExport) {
    return NextResponse.json(
      { error: 'Exportação CSV disponível a partir do plano Starter' },
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
    .select('id, answers, completed, submitted_at')
    .eq('form_id', id)
    .order('submitted_at', { ascending: true }) as { data: ResponseRow[] | null; error: { message: string } | null }

  if (responsesError) {
    return NextResponse.json({ error: responsesError.message }, { status: 500 })
  }

  const escapeCSV = (value: unknown): string => {
    const str = Array.isArray(value) ? value.join('; ') : String(value ?? '')
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }

  const questionIds = questions.map(q => q.id)
  const questionTitles = questions.map(q => q.title)
  const headers = ['ID', 'Submetido em', 'Completo', ...questionTitles]
  const rows: string[] = [headers.map(escapeCSV).join(',')]

  for (const response of (responses || [])) {
    const answerMap = response.answers || {}
    const row = [
      response.id,
      new Date(response.submitted_at).toLocaleString('pt-BR'),
      response.completed ? 'Sim' : 'Não',
      ...questionIds.map(qid => answerMap[qid] ?? ''),
    ]
    rows.push(row.map(escapeCSV).join(','))
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
