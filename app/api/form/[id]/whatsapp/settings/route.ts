import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getRequestUser } from '@/lib/supabase/request-auth'
import { PLAN_ORDER } from '@/lib/plans'
import {
  getWhatsAppSettings,
  createWhatsAppSettings,
  updateWhatsAppSettings,
  deleteWhatsAppSettings,
} from '@/lib/whatsapp'
import type { UpdateFormWhatsAppSettingsInput } from '@/lib/types/whatsapp'

interface RouteParams {
  params: Promise<{ id: string }>
}

/**
 * Validate that user has Plus+ plan (plus or professional)
 */
function isPlusPlan(plan: string | null | undefined): boolean {
  const normalizedPlan = (plan?.trim().toLowerCase() ?? 'free') as typeof PLAN_ORDER[number]
  return PLAN_ORDER.indexOf(normalizedPlan as typeof PLAN_ORDER[number]) >= PLAN_ORDER.indexOf('plus')
}

/**
 * Get Supabase client with service role for server operations
 */
function getServiceClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } }
  )
}

/**
 * GET /api/form/[id]/whatsapp/settings
 * 
 * Returns WhatsApp settings for the form
 * 
 * Status codes:
 * - 200: OK (settings found)
 * - 401: Unauthorized (no auth)
 * - 403: Forbidden (not form owner)
 * - 404: Not Found (form or settings not found)
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    // 1. Auth check
    const user = await getRequestUser(request)
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { id } = await params

    // 2. Get Supabase client and check form ownership
    const supabase = getServiceClient()
    const { data: form, error: formError } = await supabase
      .from('forms')
      .select('id, user_id')
      .eq('id', id)
      .single()

    if (formError || !form) {
      return NextResponse.json(
        { error: 'Form not found' },
        { status: 404 }
      )
    }

    if (form.user_id !== user.id) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      )
    }

    // 3. Get WhatsApp settings
    const settings = await getWhatsAppSettings(id)

    // 4. Return 200 + data or 404 if no settings
    if (!settings) {
      return NextResponse.json(
        { error: 'WhatsApp settings not found' },
        { status: 404 }
      )
    }

    return NextResponse.json(settings, { status: 200 })
  } catch (error) {
    console.error('[whatsapp/settings] GET error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/form/[id]/whatsapp/settings
 * 
 * Creates WhatsApp settings for the form
 * 
 * Required body:
 * - owner_phone: string (non-empty phone number)
 * 
 * Optional body:
 * - enabled: boolean (default: false)
 * - message_template: string (default: "Nova resposta em {form_name}: {nome}")
 * - instance_name: string (default: "default")
 * - rate_limit_per_hour: number (default: 100)
 * 
 * Status codes:
 * - 201: Created
 * - 400: Bad Request (validation error)
 * - 401: Unauthorized (no auth)
 * - 403: Forbidden (not Plus+ plan or not form owner)
 * - 409: Conflict (settings already exist)
 */
export async function POST(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    // 1. Auth check
    const user = await getRequestUser(request)
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { id } = await params

    // 2. Plan check (Plus+)
    const supabase = getServiceClient()
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('plan')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return NextResponse.json(
        { error: 'User profile not found' },
        { status: 403 }
      )
    }

    if (!isPlusPlan(profile.plan)) {
      return NextResponse.json(
        { error: 'This feature requires Plus+ plan' },
        { status: 403 }
      )
    }

    // 3. Form ownership check
    const { data: form, error: formError } = await supabase
      .from('forms')
      .select('id, user_id')
      .eq('id', id)
      .single()

    if (formError || !form) {
      return NextResponse.json(
        { error: 'Form not found' },
        { status: 404 }
      )
    }

    if (form.user_id !== user.id) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      )
    }

    // 4. Validate body
    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON' },
        { status: 400 }
      )
    }

    const { owner_phone, enabled, message_template, instance_name, rate_limit_per_hour } = body

    // Validate owner_phone (non-empty and string)
    if (typeof owner_phone !== 'string' || owner_phone.trim() === '') {
      return NextResponse.json(
        { error: 'owner_phone is required and must be non-empty' },
        { status: 400 }
      )
    }

    // Check if settings already exist
    const existingSettings = await getWhatsAppSettings(id)
    if (existingSettings) {
      return NextResponse.json(
        { error: 'WhatsApp settings already exist for this form' },
        { status: 409 }
      )
    }

    // 5. Insert into DB
    const settings = await createWhatsAppSettings(
      {
        form_id: id,
        owner_phone: owner_phone.trim(),
        enabled: typeof enabled === 'boolean' ? enabled : false,
        message_template: typeof message_template === 'string' ? message_template : undefined,
        instance_name: typeof instance_name === 'string' ? instance_name : undefined,
        rate_limit_per_hour: typeof rate_limit_per_hour === 'number' ? rate_limit_per_hour : undefined,
      },
      user.id
    )

    // 6. Return 201 + data
    return NextResponse.json(settings, { status: 201 })
  } catch (error) {
    console.error('[whatsapp/settings] POST error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/form/[id]/whatsapp/settings
 * 
 * Updates WhatsApp settings for the form
 * 
 * Optional body fields:
 * - enabled: boolean
 * - owner_phone: string (must be non-empty if provided)
 * - message_template: string
 * - instance_name: string
 * - rate_limit_per_hour: number
 * 
 * Status codes:
 * - 200: OK
 * - 400: Bad Request (validation error)
 * - 401: Unauthorized (no auth)
 * - 403: Forbidden (not Plus+ plan or not form owner)
 * - 404: Not Found (form or settings not found)
 */
export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    // 1. Auth check
    const user = await getRequestUser(request)
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { id } = await params

    // 2. Plan check (Plus+)
    const supabase = getServiceClient()
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('plan')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return NextResponse.json(
        { error: 'User profile not found' },
        { status: 403 }
      )
    }

    if (!isPlusPlan(profile.plan)) {
      return NextResponse.json(
        { error: 'This feature requires Plus+ plan' },
        { status: 403 }
      )
    }

    // 3. Form ownership check
    const { data: form, error: formError } = await supabase
      .from('forms')
      .select('id, user_id')
      .eq('id', id)
      .single()

    if (formError || !form) {
      return NextResponse.json(
        { error: 'Form not found' },
        { status: 404 }
      )
    }

    if (form.user_id !== user.id) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      )
    }

    // 4. Check that settings exist
    const existingSettings = await getWhatsAppSettings(id)
    if (!existingSettings) {
      return NextResponse.json(
        { error: 'WhatsApp settings not found' },
        { status: 404 }
      )
    }

    // 5. Validate body
    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON' },
        { status: 400 }
      )
    }

    const { enabled, owner_phone, message_template, instance_name, rate_limit_per_hour } = body

    // Validate owner_phone if provided (must be non-empty)
    if (owner_phone !== undefined && (typeof owner_phone !== 'string' || owner_phone.trim() === '')) {
      return NextResponse.json(
        { error: 'owner_phone must be non-empty if provided' },
        { status: 400 }
      )
    }

    // Build update data
    const updateData: UpdateFormWhatsAppSettingsInput = {}
    if (enabled !== undefined && typeof enabled === 'boolean') {
      updateData.enabled = enabled
    }
    if (owner_phone !== undefined && typeof owner_phone === 'string') {
      updateData.owner_phone = owner_phone.trim()
    }
    if (message_template !== undefined && typeof message_template === 'string') {
      updateData.message_template = message_template
    }
    if (instance_name !== undefined && typeof instance_name === 'string') {
      updateData.instance_name = instance_name
    }
    if (rate_limit_per_hour !== undefined && typeof rate_limit_per_hour === 'number') {
      updateData.rate_limit_per_hour = rate_limit_per_hour
    }

    // 6. Update DB
    const updatedSettings = await updateWhatsAppSettings(id, updateData)

    // 7. Return 200 + data
    return NextResponse.json(updatedSettings, { status: 200 })
  } catch (error) {
    console.error('[whatsapp/settings] PATCH error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/form/[id]/whatsapp/settings
 * 
 * Deletes WhatsApp settings for the form
 * 
 * Status codes:
 * - 204: No Content (success)
 * - 401: Unauthorized (no auth)
 * - 403: Forbidden (not form owner)
 * - 404: Not Found (form or settings not found)
 */
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    // 1. Auth check
    const user = await getRequestUser(request)
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { id } = await params

    // 2. Ownership check
    const supabase = getServiceClient()
    const { data: form, error: formError } = await supabase
      .from('forms')
      .select('id, user_id')
      .eq('id', id)
      .single()

    if (formError || !form) {
      return NextResponse.json(
        { error: 'Form not found' },
        { status: 404 }
      )
    }

    if (form.user_id !== user.id) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      )
    }

    // Check that settings exist
    const existingSettings = await getWhatsAppSettings(id)
    if (!existingSettings) {
      return NextResponse.json(
        { error: 'WhatsApp settings not found' },
        { status: 404 }
      )
    }

    // 3. Delete from DB
    await deleteWhatsAppSettings(id)

    // 4. Return 204
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    console.error('[whatsapp/settings] DELETE error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
