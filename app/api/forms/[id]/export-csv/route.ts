import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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

// GET /api/forms/[id]/export-csv — exportar respostas em CSV
export async function GET(req: NextRequest, { params }: RouteParams) {
  const supabase = await createClient()
  const { id } = await params

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
    return NextResponse.json({ error: (responsesError as { message: string }).message }, { status: 500 })
  }

  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined) return ''
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (Array.isArray(value)) return value.join('; ')
    // Objetos complexos: address, file_upload, etc.
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>
      // Address: formatar como texto legível
      if ('cep' in obj || 'rua' in obj || 'cidade' in obj) {
        const parts = [obj.rua, obj.numero, obj.complemento, obj.bairro, obj.cidade, obj.estado, obj.cep]
          .filter(Boolean)
        return parts.join(', ') as string
      }
      // File upload: retornar nome do arquivo
      if ('name' in obj && 'url' in obj) {
        return String(obj.name)
      }
      return JSON.stringify(value)
    }
    return String(value)
  }

  const escapeCSV = (value: unknown): string => {
    const str = formatValue(value)
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
    const answers = response.answers || {}
    const row = [
      response.id,
      new Date(response.submitted_at).toLocaleString('pt-BR'),
      response.completed ? 'Sim' : 'Não',
      ...questionIds.map(qid => answers[qid] ?? ''),
    ]
    rows.push(row.map(escapeCSV).join(','))
  }

  const csv = '\uFEFF' + rows.join('\r\n') // BOM UTF-8 para Excel

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="respostas-${id}.csv"`,
    },
  })
}
