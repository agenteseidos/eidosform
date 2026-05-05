import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getRequestUser } from '@/lib/supabase/request-auth'
import { PLANS } from '@/lib/plan-limits'
import { PlanId } from '@/lib/plans'

interface RouteParams {
  params: Promise<{ id: string }>
}

function getServiceClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } }
  )
}

/**
 * GET /api/forms/[id]/whatsapp
 * Returns WhatsApp settings for a form.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getRequestUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const supabase = getServiceClient()

    // Verify form ownership
    const { data: form, error: formError } = await supabase
      .from('forms')
      .select('id, user_id')
      .eq('id', id)
      .single()

    if (formError || !form) {
      return NextResponse.json({ error: 'Form not found' }, { status: 404 })
    }

    if (form.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // P1 FIX: Plan check — WhatsApp requires Plus or Professional plan
    const { data: userProfile } = await supabase
      .from('profiles')
      .select('plan')
      .eq('id', user.id)
      .single()
    const plan = (userProfile?.plan ?? 'free') as PlanId
    if (!PLANS[plan]?.whatsappNotifications) {
      return NextResponse.json({ error: 'WhatsApp requires Plus or Professional plan' }, { status: 403 })
    }

    const { data: settings, error: settingsError } = await supabase
      .from('form_whatsapp_settings')
      .select('*')
      .eq('form_id', id)
      .single()

    if (settingsError && settingsError.code !== 'PGRST116') {
      console.error('[forms/whatsapp] GET error:', settingsError)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }

    return NextResponse.json({ settings: settings ?? null }, { status: 200 })
  } catch (error) {
    console.error('[forms/whatsapp] GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/forms/[id]/whatsapp
 * Upsert WhatsApp settings for a form (create or update).
 *
 * Body:
 *   enabled: boolean
 *   owner_phone: string (e.g. "558399110173" or "+55 83 9911-0173")
 *   message_template?: string (optional)
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getRequestUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const supabase = getServiceClient()

    // Verify form ownership (RLS-equivalent: only owner can edit)
    const { data: form, error: formError } = await supabase
      .from('forms')
      .select('id, user_id')
      .eq('id', id)
      .single()

    if (formError || !form) {
      return NextResponse.json({ error: 'Form not found' }, { status: 404 })
    }

    if (form.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Plan check — WhatsApp requires Plus or Professional
    const { data: userProfile } = await supabase
      .from('profiles')
      .select('plan')
      .eq('id', user.id)
      .single()

    const plan = (userProfile?.plan ?? 'free') as PlanId
    if (!PLANS[plan]?.whatsappNotifications) {
      return NextResponse.json({ error: 'WhatsApp requires Plus or Professional plan' }, { status: 403 })
    }

    // Parse body
    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const { enabled, owner_phone, message_template } = body

    // Validate required fields
    if (typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 })
    }

    // Validação do owner_phone
    // Some prod tables also have a NOT NULL `user_id` column added outside
    // the original migration — set it from auth so the upsert doesn't 23502.
    const updateData: Record<string, unknown> = {
      form_id: id,
      user_id: user.id,
      created_by: user.id,
      enabled,
      updated_at: new Date().toISOString(),
    }

    if (owner_phone !== undefined) {
      if (owner_phone === null || owner_phone === '') {
        // Permitir limpar o número
        updateData.owner_phone = null
      } else {
        const cleaned = String(owner_phone).replace(/\D/g, '')
        if (cleaned.length < 10 || cleaned.length > 15) {
          return NextResponse.json(
            { error: 'Número de WhatsApp inválido. Use formato: 5511999999999' },
            { status: 400 }
          )
        }
        updateData.owner_phone = cleaned
      }
    }

    if (typeof message_template === 'string') {
      updateData.message_template = message_template
    }

    // Upsert into form_whatsapp_settings
    const { data: settings, error: upsertError } = await supabase
      .from('form_whatsapp_settings')
      .upsert(updateData, { onConflict: 'form_id' })
      .select()
      .single()

    if (upsertError) {
      console.error('[forms/whatsapp] upsert error:', upsertError)
      return NextResponse.json(
        { error: 'Failed to save settings', detail: upsertError.message, code: upsertError.code },
        { status: 500 },
      )
    }

    return NextResponse.json({ settings }, { status: 200 })
  } catch (error) {
    console.error('[forms/whatsapp] POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
