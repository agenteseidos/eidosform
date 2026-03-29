import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin-auth'
import { normalizePlan } from '@/lib/plans'

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.ok) return auth.response

  const search = request.nextUrl.searchParams.get('search')?.trim().toLowerCase() ?? ''
  const supabase = createAdminClient()

  const [{ data: profiles, error: profilesError }, { data: forms, error: formsError }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, email, plan, created_at')
      .order('created_at', { ascending: false }),
    supabase
      .from('forms')
      .select('id, user_id'),
  ])

  const error = profilesError ?? formsError

  if (error) {
    return NextResponse.json({ error: 'Failed to load admin users' }, { status: 500 })
  }

  const formsCountByUser = new Map<string, number>()
  for (const form of forms ?? []) {
    formsCountByUser.set(form.user_id, (formsCountByUser.get(form.user_id) ?? 0) + 1)
  }

  const users = (profiles ?? [])
    .filter((profile) => !search || profile.email.toLowerCase().includes(search))
    .map((profile) => ({
      id: profile.id,
      email: profile.email,
      plan: normalizePlan(profile.plan),
      createdAt: profile.created_at,
      formsCount: formsCountByUser.get(profile.id) ?? 0,
    }))

  return NextResponse.json({ users })
}
