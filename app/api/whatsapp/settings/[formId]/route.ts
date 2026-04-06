import { NextRequest, NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/supabase/request-auth'
import { createServerClient } from '@supabase/ssr'
import { getWhatsAppSettings, updateWhatsAppSettings, deleteWhatsAppSettings } from '@/lib/whatsapp'
import { PLAN_ORDER } from '@/lib/plans'
import type { UpdateFormWhatsAppSettingsInput } from '@/lib/types/whatsapp'

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

interface RouteParams {
  params: Promise<{ formId: string }>
}

async function validateOwnership(req: NextRequest, formId: string): Promise<{ authorized: boolean; userId: string }> {
  const user = await getRequestUser(req)
  if (!user) return { authorized: false, userId: '' }

  const supabase = getServiceClient()
  const { data: form } = await supabase
    .from('forms')
    .select('user_id')
    .eq('id', formId)
    .single()

  if (!form || form.user_id !== user.id) return { authorized: false, userId: user.id }
  return { authorized: true, userId: user.id }
}

/**
 * GET /api/whatsapp/settings/[formId]
 * Get WhatsApp settings for a specific form.
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { formId } = await params
    const { authorized } = await validateOwnership(req, formId)
    if (!authorized) {
      return NextResponse.json({ error: 'Unauthorized or form not found' }, { status: 401 })
    }

    const settings = await getWhatsAppSettings(formId)
    if (!settings) {
      return NextResponse.json({ error: 'Settings not found' }, { status: 404 })
    }

    return NextResponse.json(settings)
  } catch (error) {
    console.error('[whatsapp/settings/[formId]] GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PUT /api/whatsapp/settings/[formId]
 * Update WhatsApp settings for a specific form.
 */
export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const { formId } = await params
    const { authorized, userId } = await validateOwnership(req, formId)
    if (!authorized) {
      return NextResponse.json({ error: 'Unauthorized or form not found' }, { status: 401 })
    }

    // Plan check
    const supabase = getServiceClient()
    const { data: profile } = await supabase
      .from('profiles')
      .select('plan')
      .eq('id', userId)
      .single()

    if (!profile || !isPlusPlan(profile.plan)) {
      return NextResponse.json({ error: 'This feature requires Plus+ plan' }, { status: 403 })
    }

    // Check settings exist
    const existing = await getWhatsAppSettings(formId)
    if (!existing) {
      return NextResponse.json({ error: 'Settings not found. Use POST to create.' }, { status: 404 })
    }

    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const updateData: UpdateFormWhatsAppSettingsInput = {}
    if (body.enabled !== undefined && typeof body.enabled === 'boolean') updateData.enabled = body.enabled
    if (typeof body.owner_phone === 'string' && body.owner_phone.trim()) updateData.owner_phone = body.owner_phone.trim()
    if (typeof body.message_template === 'string') updateData.message_template = body.message_template
    if (typeof body.instance_name === 'string') updateData.instance_name = body.instance_name
    if (typeof body.rate_limit_per_hour === 'number') updateData.rate_limit_per_hour = body.rate_limit_per_hour

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const updated = await updateWhatsAppSettings(formId, updateData)
    return NextResponse.json(updated)
  } catch (error) {
    console.error('[whatsapp/settings/[formId]] PUT error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/whatsapp/settings/[formId]
 * Delete WhatsApp settings for a specific form.
 */
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const { formId } = await params
    const { authorized } = await validateOwnership(req, formId)
    if (!authorized) {
      return NextResponse.json({ error: 'Unauthorized or form not found' }, { status: 401 })
    }

    const existing = await getWhatsAppSettings(formId)
    if (!existing) {
      return NextResponse.json({ error: 'Settings not found' }, { status: 404 })
    }

    await deleteWhatsAppSettings(formId)
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    console.error('[whatsapp/settings/[formId]] DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
