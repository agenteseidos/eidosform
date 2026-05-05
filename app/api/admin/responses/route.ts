import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin-auth'
import { logError } from '@/lib/logger'

type ResponseRow = {
  id: string
  form_id: string
  completed: boolean | null
  respondent_id: string | null
  submitted_at: string
  created_at: string
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.ok) return auth.response

  const formFilter = request.nextUrl.searchParams.get('form')?.trim() ?? ''
  const page = Math.max(1, Number.parseInt(request.nextUrl.searchParams.get('page') ?? '1', 10) || 1)
  const limit = Math.min(100, Math.max(1, Number.parseInt(request.nextUrl.searchParams.get('limit') ?? '20', 10) || 20))
  const from = (page - 1) * limit
  const to = from + limit - 1
  const supabase = createAdminClient()

  let responsesQuery = supabase
    .from('responses')
    .select('id, form_id, completed, respondent_id, submitted_at, created_at', { count: 'exact' })
    .order('submitted_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })

  if (formFilter) responsesQuery = responsesQuery.eq('form_id', formFilter)

  const { data: responseRows, error: responsesError, count } = await responsesQuery.range(from, to)

  if (responsesError) {
    logError('[admin/responses] query failed', responsesError, { formFilter, page, limit })
    return NextResponse.json(
      { error: 'Failed to load admin responses', detail: responsesError.message },
      { status: 500 },
    )
  }

  const formIds = Array.from(new Set((responseRows ?? []).map((r: ResponseRow) => r.form_id).filter(Boolean)))

  const formById = new Map<string, { title: string; user_id: string }>()
  const ownerById = new Map<string, string | null>()

  if (formIds.length > 0) {
    const { data: forms } = await supabase
      .from('forms')
      .select('id, title, user_id')
      .in('id', formIds)
    for (const form of forms ?? []) {
      const formTitle = form.title?.trim() ? form.title : `Form #${form.id.slice(0, 8)}`
      formById.set(form.id, { title: formTitle, user_id: form.user_id })
    }

    const userIds = Array.from(new Set((forms ?? []).map((f) => f.user_id).filter(Boolean)))
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, email')
        .in('id', userIds)
      for (const profile of profiles ?? []) {
        ownerById.set(profile.id, profile.email)
      }
    }
  }

  const result = (responseRows ?? []).map((row: ResponseRow) => {
    const form = formById.get(row.form_id)
    return {
      id: row.id,
      formId: row.form_id,
      formTitle: form?.title ?? 'Formulário removido',
      ownerId: form?.user_id ?? null,
      ownerEmail: form?.user_id ? ownerById.get(form.user_id) ?? null : null,
      completed: row.completed ?? false,
      createdAt: row.submitted_at ?? row.created_at,
    }
  })

  return NextResponse.json({
    responses: result,
    total: count ?? result.length,
    page,
    limit,
    hasMore: (count ?? 0) > to + 1,
  })
}
