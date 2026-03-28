import { NextRequest, NextResponse } from 'next/server'
import { PLANS, PlanName } from '@/lib/plan-limits'
import { createClient } from '@/lib/supabase/server'
import { FormUpdate } from '@/lib/database.types'
import { validateWebhookUrl } from '@/lib/webhook-validator'
import { getRequestUser } from '@/lib/supabase/request-auth'

// T1/T2: Ensure URLs have protocol before persisting
function ensureHttps(url: string): string {
  if (!url) return url
  const trimmed = url.trim()
  if (!trimmed) return trimmed
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

interface RouteParams {
  params: Promise<{ id: string }>
}

// GET /api/forms/[id] — get form by id
export async function GET(req: NextRequest, { params }: RouteParams) {
  const supabase = await createClient()
  const { id } = await params
  const user = await getRequestUser(req)

  if (!user) {
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
  const user = await getRequestUser(req)

  if (!user) {
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
  const { title, description, slug, status, theme, questions, thank_you_message, thank_you_title, thank_you_description, thank_you_button_text, thank_you_button_url, pixels, plan, redirect_url, webhook_url, pixel_event_on_start, pixel_event_on_complete, welcome_enabled, welcome_title, welcome_description, welcome_button_text, welcome_image_url } = body

  // Validate slug if provided
  if (slug && !/^[a-z0-9-]+$/.test(slug)) {
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

  // Validar plano para pixel events condicionais
  if (pixel_event_on_start !== undefined || pixel_event_on_complete !== undefined || hasPixelEventRules(questions)) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('plan')
      .eq('id', user.id)
      .single()

    const userPlan = (profile?.plan ?? 'free') as PlanName
    const planConfig = PLANS[userPlan]
    if (!planConfig?.pixels) {
      return NextResponse.json(
        { error: 'Eventos de pixel condicionais disponíveis a partir do plano Plus' },
        { status: 403 }
      )
    }
  }

    const update: FormUpdate = {
    ...(title !== undefined && { title }),
    ...(description !== undefined && { description }),
    ...(slug !== undefined && { slug }),
    ...(status !== undefined && { status }),
    ...(theme !== undefined && { theme }),
    ...(questions !== undefined && { questions }),
    ...(thank_you_message !== undefined && { thank_you_message }),
    ...(thank_you_title !== undefined && { thank_you_title }),
    ...(thank_you_description !== undefined && { thank_you_description }),
    ...(thank_you_button_text !== undefined && { thank_you_button_text }),
    ...(thank_you_button_url !== undefined && { thank_you_button_url: ensureHttps(thank_you_button_url) }),
    ...(pixels !== undefined && { pixels }),
    ...(plan !== undefined && { plan }),
    ...(redirect_url !== undefined && { redirect_url: ensureHttps(redirect_url) }),
    ...(webhook_url !== undefined && { webhook_url }),
    ...(pixel_event_on_start !== undefined && { pixel_event_on_start }),
    ...(pixel_event_on_complete !== undefined && { pixel_event_on_complete }),
    ...(welcome_enabled !== undefined && { welcome_enabled }),
    ...(welcome_title !== undefined && { welcome_title }),
    ...(welcome_description !== undefined && { welcome_description }),
    ...(welcome_button_text !== undefined && { welcome_button_text }),
    ...(welcome_image_url !== undefined && { welcome_image_url }),
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
  const user = await getRequestUser(req)

  if (!user) {
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


// Verifica se alguma pergunta tem regras de pixelEvents
function hasPixelEventRules(questions: unknown): boolean {
  if (!Array.isArray(questions)) return false
  return questions.some((q: { pixelEvents?: unknown[] }) => q.pixelEvents && q.pixelEvents.length > 0)
}
