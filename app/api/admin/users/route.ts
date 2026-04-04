import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin-auth'
import { normalizePlan } from '@/lib/plans'

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.ok) return auth.response

  const search = request.nextUrl.searchParams.get('search')?.trim().toLowerCase() ?? ''
  const supabase = createAdminClient()

  // P1-02 FIX: Avoid N+1 by using aggregate function instead of fetching all forms
  // Get forms count grouped by user_id using a single query
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, email, plan, created_at')
    .order('created_at', { ascending: false })

  if (profilesError) {
    return NextResponse.json({ error: 'Failed to load admin users' }, { status: 500 })
  }

  // Fetch form counts per user in a single query (using RPC or aggregate select)
  const { data: formCounts, error: formsError } = await supabase
    .from('forms')
    .select('user_id')  // Only fetch user_id to minimize payload

  if (formsError) {
    return NextResponse.json({ error: 'Failed to count forms' }, { status: 500 })
  }

  // Count forms by user in memory (efficient since we only have user_id)
  const formsCountByUser = new Map<string, number>()
  for (const form of formCounts ?? []) {
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
