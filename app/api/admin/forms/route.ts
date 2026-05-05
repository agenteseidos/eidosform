import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin-auth'
import { logError } from '@/lib/logger'

type FormRow = {
  id: string
  user_id: string
  title: string | null
  status: string | null
  is_closed: boolean | null
  paused: boolean | null
  created_at: string
  updated_at: string | null
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.ok) return auth.response

  const search = request.nextUrl.searchParams.get('search')?.trim().toLowerCase() ?? ''
  const ownerFilter = request.nextUrl.searchParams.get('owner')?.trim() ?? ''
  const page = Math.max(1, Number.parseInt(request.nextUrl.searchParams.get('page') ?? '1', 10) || 1)
  const limit = Math.min(100, Math.max(1, Number.parseInt(request.nextUrl.searchParams.get('limit') ?? '20', 10) || 20))
  const from = (page - 1) * limit
  const to = from + limit - 1
  const supabase = createAdminClient()

  let formsQuery = supabase
    .from('forms')
    .select('id, user_id, title, status, is_closed, paused, created_at, updated_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })

  if (search) formsQuery = formsQuery.ilike('title', `%${search}%`)
  if (ownerFilter) formsQuery = formsQuery.eq('user_id', ownerFilter)

  const { data: forms, error: formsError, count } = await formsQuery.range(from, to)

  if (formsError) {
    logError('[admin/forms] query failed', formsError, { search, ownerFilter, page, limit })
    return NextResponse.json(
      { error: 'Failed to load admin forms', detail: formsError.message },
      { status: 500 },
    )
  }

  const userIds = Array.from(new Set((forms ?? []).map((form: FormRow) => form.user_id).filter(Boolean)))

  const ownerById = new Map<string, { email: string | null }>()
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email')
      .in('id', userIds)
    for (const profile of profiles ?? []) {
      ownerById.set(profile.id, { email: profile.email })
    }
  }

  // Counts of responses per form (for the listing)
  const formIds = (forms ?? []).map((f: FormRow) => f.id)
  const responseCountByForm = new Map<string, number>()
  if (formIds.length > 0) {
    const { data: responseRows } = await supabase
      .from('responses')
      .select('form_id')
      .in('form_id', formIds)
    for (const row of responseRows ?? []) {
      responseCountByForm.set(row.form_id, (responseCountByForm.get(row.form_id) ?? 0) + 1)
    }
  }

  const result = (forms ?? []).map((form: FormRow) => ({
    id: form.id,
    title: form.title?.trim() ? form.title : `Form #${form.id.slice(0, 8)}`,
    status: form.status,
    isClosed: form.is_closed ?? false,
    paused: form.paused ?? false,
    createdAt: form.created_at,
    updatedAt: form.updated_at,
    ownerId: form.user_id,
    ownerEmail: ownerById.get(form.user_id)?.email ?? null,
    responsesCount: responseCountByForm.get(form.id) ?? 0,
  }))

  return NextResponse.json({
    forms: result,
    total: count ?? result.length,
    page,
    limit,
    hasMore: (count ?? 0) > to + 1,
  })
}
