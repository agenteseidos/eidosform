import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin-auth'

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  const supabase = createAdminClient()

  const [{ count: usersCount, error: usersError }, { count: formsCount, error: formsError }, { count: responsesCount, error: responsesError }] = await Promise.all([
    supabase.from('profiles').select('*', { count: 'exact', head: true }),
    supabase.from('forms').select('*', { count: 'exact', head: true }),
    supabase.from('responses').select('*', { count: 'exact', head: true }),
  ])

  const error = usersError ?? formsError ?? responsesError

  if (error) {
    return NextResponse.json({ error: 'Failed to load admin metrics' }, { status: 500 })
  }

  return NextResponse.json({
    totalUsers: usersCount ?? 0,
    totalForms: formsCount ?? 0,
    totalResponses: responsesCount ?? 0,
  })
}
