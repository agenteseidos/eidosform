import { NextRequest, NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/supabase/request-auth'
import { createServerClient } from '@supabase/ssr'
import { getWhatsAppSettings, createWhatsAppSettings } from '@/lib/whatsapp'
import { PLAN_ORDER } from '@/lib/plans'

function isPlusPlan(plan: string | null | undefined): boolean {
  const normalized = (plan?.trim().toLowerCase() ?? 'free') as typeof PLAN_ORDER[number]
  return PLAN_ORDER.indexOf(normalized as typeof PLAN_ORDER[number]) >= PLAN_ORDER.indexOf('plus')
}

function getServiceClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } }
  )
}

/**
 * GET /api/whatsapp/settings
 * List all WhatsApp settings for forms owned by the authenticated user.
 * Query params: ?formId=xxx (optional filter)
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getRequestUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = getServiceClient()
    const url = new URL(req.url)
    const formIdFilter = url.searchParams.get('formId')

    // Get all forms owned by user
    let formsQuery = supabase
      .from('forms')
      .select('id')
      .eq('user_id', user.id)

    if (formIdFilter) {
      formsQuery = formsQuery.eq('id', formIdFilter)
    }

    const { data: forms, error: formsError } = await formsQuery

    if (formsError || !forms || forms.length === 0) {
      return NextResponse.json({ settings: [] })
    }

    const formIds = forms.map((f: { id: string }) => f.id)

    const { data: settings, error: settingsError } = await supabase
      .from('form_whatsapp_settings')
      .select('*')
      .in('form_id', formIds)

    if (settingsError) {
      console.error('[whatsapp/settings] GET list error:', settingsError)
      return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 })
    }

    return NextResponse.json({ settings: settings ?? [] })
  } catch (error) {
    console.error('[whatsapp/settings] GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/whatsapp/settings
 * Create WhatsApp settings for a form.
 * Body: { form_id, owner_phone, enabled?, message_template?, instance_name?, rate_limit_per_hour? }
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getRequestUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Plan check
    const supabase = getServiceClient()
    const { data: profile } = await supabase
      .from('profiles')
      .select('plan')
      .eq('id', user.id)
      .single()

    if (!profile || !isPlusPlan(profile.plan)) {
      return NextResponse.json({ error: 'This feature requires Plus+ plan' }, { status: 403 })
    }

    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const { form_id, owner_phone, enabled, message_template, instance_name, rate_limit_per_hour } = body

    if (!form_id || typeof form_id !== 'string') {
      return NextResponse.json({ error: 'form_id is required' }, { status: 400 })
    }

    if (!owner_phone || typeof owner_phone !== 'string' || !owner_phone.trim()) {
      return NextResponse.json({ error: 'owner_phone is required' }, { status: 400 })
    }

    // Form ownership check
    const { data: form } = await supabase
      .from('forms')
      .select('id, user_id')
      .eq('id', form_id)
      .single()

    if (!form || form.user_id !== user.id) {
      return NextResponse.json({ error: 'Form not found or not owned by you' }, { status: 404 })
    }

    // Check if settings already exist
    const existing = await getWhatsAppSettings(form_id)
    if (existing) {
      return NextResponse.json({ error: 'Settings already exist. Use PUT to update.' }, { status: 409 })
    }

    const settings = await createWhatsAppSettings(
      {
        form_id,
        owner_phone: owner_phone.trim(),
        enabled: typeof enabled === 'boolean' ? enabled : false,
        message_template: typeof message_template === 'string' ? message_template : undefined,
        instance_name: typeof instance_name === 'string' ? instance_name : undefined,
        rate_limit_per_hour: typeof rate_limit_per_hour === 'number' ? rate_limit_per_hour : undefined,
      },
      user.id
    )

    return NextResponse.json(settings, { status: 201 })
  } catch (error) {
    console.error('[whatsapp/settings] POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
