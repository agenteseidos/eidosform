import { NextRequest, NextResponse } from 'next/server'
import { FormInsert } from '@/lib/database.types'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRequestUser } from '@/lib/supabase/request-auth'

interface RouteParams {
  params: Promise<{ id: string }>
}

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'form'
}

async function generateUniqueSlug(supabase: ReturnType<typeof createAdminClient>, userId: string, baseSlug: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const suffix = attempt === 0 ? 'copy' : `copy-${attempt + 1}`
    const candidate = `${baseSlug}-${suffix}`.slice(0, 60)

    const { data: existing } = await supabase
      .from('forms')
      .select('id')
      .eq('user_id', userId)
      .eq('slug', candidate)
      .maybeSingle()

    if (!existing) return candidate
  }

  return `${baseSlug}-${Date.now()}`.slice(0, 60)
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const user = await getRequestUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const supabase = createAdminClient()

  const { data: sourceForm, error: sourceError } = await supabase
    .from('forms')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (sourceError || !sourceForm) {
    return NextResponse.json({ error: 'Form not found' }, { status: 404 })
  }

  const baseSlug = slugify(sourceForm.slug || sourceForm.title || 'form')
  const duplicateSlug = await generateUniqueSlug(supabase, user.id, baseSlug)
  const now = new Date().toISOString()

  const duplicateForm: FormInsert = {
    user_id: user.id,
    title: `${sourceForm.title} (Cópia)`,
    description: sourceForm.description,
    slug: duplicateSlug,
    status: 'draft',
    is_published: false,
    theme: sourceForm.theme,
    questions: sourceForm.questions,
    thank_you_message: sourceForm.thank_you_message,
    thank_you_title: sourceForm.thank_you_title,
    thank_you_description: sourceForm.thank_you_description,
    thank_you_button_text: sourceForm.thank_you_button_text,
    thank_you_button_url: sourceForm.thank_you_button_url,
    pixels: sourceForm.pixels,
    plan: sourceForm.plan,
    redirect_url: sourceForm.redirect_url,
    webhook_url: sourceForm.webhook_url,
    pixel_event_on_start: sourceForm.pixel_event_on_start,
    pixel_event_on_complete: sourceForm.pixel_event_on_complete,
    welcome_enabled: sourceForm.welcome_enabled,
    welcome_title: sourceForm.welcome_title,
    welcome_description: sourceForm.welcome_description,
    welcome_button_text: sourceForm.welcome_button_text,
    welcome_image_url: sourceForm.welcome_image_url,
    created_at: now,
    updated_at: now,
  }

  const { data: duplicated, error: duplicateError } = await supabase
    .from('forms')
    .insert(duplicateForm)
    .select('*')
    .single()

  if (duplicateError || !duplicated) {
    return NextResponse.json({ error: duplicateError?.message ?? 'Failed to duplicate form' }, { status: 500 })
  }

  return NextResponse.json({ form: duplicated }, { status: 201 })
}
