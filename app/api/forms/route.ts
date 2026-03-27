import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { FormInsert, FormStatus } from '@/lib/database.types'
import { validateWebhookUrl } from '@/lib/webhook-validator'
import { getRequestUser } from '@/lib/supabase/request-auth'
import { checkFormLimit } from '@/lib/plan-limits'

// T2: Ensure URLs have protocol before persisting
function ensureHttps(url: string): string {
  if (!url) return url
  const trimmed = url.trim()
  if (!trimmed) return trimmed
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

// GET /api/forms — list all forms for authenticated user
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const user = await getRequestUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '20')
  const offset = (page - 1) * limit

  let query = supabase
    .from('forms')
    .select('id, title, description, slug, status, theme, plan, redirect_url, webhook_url, pixels, created_at, updated_at', { count: 'exact' })
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) {
    query = query.eq('status', status as FormStatus)
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
  const user = await getRequestUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check form limit before allowing creation
  const formLimit = await checkFormLimit(user.id)
  if (!formLimit.allowed) {
    return NextResponse.json(
      { error: `Limite de formulários atingido (${formLimit.usage}/${formLimit.limit}). Faça upgrade do plano.` },
      { status: 403 }
    )
  }

  const body = await req.json()
  const { title, description, slug, theme, questions, thank_you_message, pixels, redirect_url, webhook_url } = body

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

  // Validate webhook_url if provided
  if (webhook_url) {
    const webhookCheck = validateWebhookUrl(webhook_url)
    if (!webhookCheck.safe) {
      return NextResponse.json({ error: `Invalid webhook_url: ${webhookCheck.reason}` }, { status: 400 })
    }
  }

  // Bug #11: Inherit plan from user profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan')
    .eq('user_id', user.id)
    .single()
  const userPlan = ((profile as { plan: string } | null)?.plan || 'free') as import('@/lib/database.types').PlanType

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
    plan: userPlan,
    redirect_url: redirect_url ? ensureHttps(redirect_url) : null,
    webhook_url: webhook_url || null,
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
