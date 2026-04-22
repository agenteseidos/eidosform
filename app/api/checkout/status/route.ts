import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [{ data: profile }, { data: checkout }] = await Promise.all([
    supabase
      .from('profiles')
      .select('plan, plan_status')
      .eq('id', user.id)
      .single(),
    supabase
      .from('billing_checkouts')
      .select('status, last_event, updated_at')
      .eq('profile_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const plan = profile?.plan ?? 'free'
  const planStatus = profile?.plan_status ?? null

  if (plan !== 'free' && planStatus === 'active') {
    return NextResponse.json({ status: 'success' })
  }

  if (checkout?.status === 'cancelled') {
    return NextResponse.json({ status: 'cancelled' })
  }

  if (checkout?.status === 'overdue') {
    return NextResponse.json({ status: 'expired' })
  }

  return NextResponse.json({ status: 'pending' })
}
