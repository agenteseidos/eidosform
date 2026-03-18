import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { FormInsert } from '@/lib/database.types'

// GET /api/forms — list all forms for authenticated user
export async function GET(req: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '20')
  const offset = (page - 1) * limit

  let query = supabase
    .from('forms')
    .select('id, title, description, slug, status, theme, plan, redirect_url, pixels, created_at, updated_at', { count: 'exact' })
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) {
    query = query.eq('status', status)
  }

  const { data, error, count } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    forms: data,
    total: count,
    page,
    limit,
  })
}

// POST /api/forms — create new form
export async function POST(req: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { title, description, slug, theme, questions, thank_you_message, pixels, plan, redirect_url } = body

  if (!title || !slug) {
    return NextResponse.json({ error: 'title and slug are required' }, { status: 400 })
  }

  // Validate slug format (lowercase, alphanumeric, hyphens only)
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return NextResponse.json(
      { error: 'slug must contain only lowercase letters, numbers, and hyphens' },
      { status: 400 }
    )
  }

  const insert: FormInsert = {
    user_id: user.id,
    title,
    description: description || null,
    slug,
    status: 'draft',
    theme: theme || 'midnight',
    questions: questions || [],
    thank_you_message: thank_you_message || 'Obrigado pela sua resposta!',
    pixels: pixels || null,
    plan: plan || 'free',
    redirect_url: redirect_url || null,
  }

  const { data, error } = await supabase
    .from('forms')
    .insert(insert)
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Slug already in use' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ form: data }, { status: 201 })
}
