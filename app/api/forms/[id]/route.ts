import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { FormUpdate } from '@/lib/database.types'

interface RouteParams {
  params: Promise<{ id: string }>
}

// GET /api/forms/[id] — get form by id
export async function GET(req: NextRequest, { params }: RouteParams) {
  const supabase = await createClient()
  const { id } = await params

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('forms')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Form not found' }, { status: 404 })
  }

  return NextResponse.json({ form: data })
}

// PATCH /api/forms/[id] — update form
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const supabase = await createClient()
  const { id } = await params

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Verify ownership
  const { data: existing } = await supabase
    .from('forms')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!existing) {
    return NextResponse.json({ error: 'Form not found' }, { status: 404 })
  }

  const body = await req.json()
  const { title, description, slug, status, theme, questions, thank_you_message, pixels, plan, redirect_url } = body

  // Validate slug if provided
  if (slug && !/^[a-z0-9-]+$/.test(slug)) {
    return NextResponse.json(
      { error: 'slug must contain only lowercase letters, numbers, and hyphens' },
      { status: 400 }
    )
  }

  const update: FormUpdate = {
    ...(title !== undefined && { title }),
    ...(description !== undefined && { description }),
    ...(slug !== undefined && { slug }),
    ...(status !== undefined && { status }),
    ...(theme !== undefined && { theme }),
    ...(questions !== undefined && { questions }),
    ...(thank_you_message !== undefined && { thank_you_message }),
    ...(pixels !== undefined && { pixels }),
    ...(plan !== undefined && { plan }),
    ...(redirect_url !== undefined && { redirect_url }),
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('forms')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Slug already in use' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ form: data })
}

// PUT /api/forms/[id] — update form (alias for PATCH, used by frontend)
export const PUT = PATCH

// DELETE /api/forms/[id] — delete form
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const supabase = await createClient()
  const { id } = await params

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Verify ownership before deleting
  const { data: existing } = await supabase
    .from('forms')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!existing) {
    return NextResponse.json({ error: 'Form not found' }, { status: 404 })
  }

  const { error } = await supabase
    .from('forms')
    .delete()
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true }, { status: 200 })
}
