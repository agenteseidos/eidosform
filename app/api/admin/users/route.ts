import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin-auth'
import { normalizePlan } from '@/lib/plans'

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.ok) return auth.response

  const search = request.nextUrl.searchParams.get('search')?.trim().toLowerCase() ?? ''
  const page = Math.max(1, Number.parseInt(request.nextUrl.searchParams.get('page') ?? '1', 10) || 1)
  const limit = Math.min(100, Math.max(1, Number.parseInt(request.nextUrl.searchParams.get('limit') ?? '20', 10) || 20))
  const from = (page - 1) * limit
  const to = from + limit - 1
  const supabase = createAdminClient()

  let profilesQuery = supabase
    .from('profiles')
    .select('id, email, plan, plan_cycle, plan_expires_at, plan_status, created_at, lifetime_access, asaas_subscription_id, responses_used, responses_limit', { count: 'exact' })
    .order('created_at', { ascending: false })

  if (search) {
    profilesQuery = profilesQuery.ilike('email', `%${search}%`)
  }

  const { data: profiles, error: profilesError, count } = await profilesQuery.range(from, to)

  if (profilesError) {
    return NextResponse.json({ error: 'Failed to load admin users' }, { status: 500 })
  }

  const profileIds = (profiles ?? []).map((profile) => profile.id)

  let formCounts: { user_id: string }[] = []
  let formsError: unknown = null

  if (profileIds.length > 0) {
    const result = await supabase
      .from('forms')
      .select('user_id')
      .in('user_id', profileIds)
    formCounts = result.data ?? []
    formsError = result.error
  }

  if (formsError) {
    return NextResponse.json({ error: 'Failed to count forms' }, { status: 500 })
  }

  const formsCountByUser = new Map<string, number>()
  for (const form of formCounts) {
    formsCountByUser.set(form.user_id, (formsCountByUser.get(form.user_id) ?? 0) + 1)
  }

  const users = (profiles ?? []).map((profile) => {
    const p = profile as typeof profile & {
      plan_cycle: string | null
      lifetime_access: boolean | null
      asaas_subscription_id: string | null
      responses_used: number | null
      responses_limit: number | null
    }
    return {
      id: p.id,
      email: p.email,
      plan: normalizePlan(p.plan),
      planCycle: p.plan_cycle ?? null,
      planExpiresAt: p.plan_expires_at ?? null,
      planStatus: p.plan_status ?? null,
      lifetimeAccess: Boolean(p.lifetime_access),
      hasSubscription: Boolean(p.asaas_subscription_id),
      responsesUsed: p.responses_used ?? 0,
      responsesLimit: p.responses_limit ?? 0,
      createdAt: p.created_at,
      formsCount: formsCountByUser.get(p.id) ?? 0,
    }
  })

  return NextResponse.json({
    users,
    total: count ?? users.length,
    page,
    limit,
    hasMore: (count ?? 0) > to + 1,
  })
}
