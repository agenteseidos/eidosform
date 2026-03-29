import { NextRequest, NextResponse } from 'next/server'
import { PLAN_ORDER, PlanId } from '@/lib/plans'
import { getAdminSupabase, requireAdmin } from '@/lib/admin-auth'

function isValidPlan(value: unknown): value is PlanId {
  return typeof value === 'string' && (PLAN_ORDER as readonly string[]).includes(value)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  const { id } = await params

  let body: { plan?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!isValidPlan(body.plan)) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
  }

  const supabase = getAdminSupabase()
  const { error } = await supabase
    .from('profiles')
    .update({ plan: body.plan })
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
