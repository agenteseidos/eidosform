import { NextRequest, NextResponse } from 'next/server'
import { createPublicClient } from '@/lib/supabase/public'

/**
 * GET /api/forms/[id]/plan
 * Returns the owner's plan for a form (public endpoint, form must be published)
 * Used by FormPage to gate pixel rendering without exposing user_id
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  if (!id) {
    return NextResponse.json({ error: 'Form ID required' }, { status: 400 })
  }

  const supabase = createPublicClient()

  // Fetch form with user_id (internal use only)
  const { data: form } = await supabase
    .from('forms')
    .select('id, user_id, status')
    .eq('id', id)
    .single()

  if (!form || form.status !== 'published') {
    return NextResponse.json({ error: 'Form not found' }, { status: 404 })
  }

  // Fetch owner's plan
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', form.user_id)
    .single()

  const plan = profile?.plan ?? 'free'

  return NextResponse.json({ plan })
}
