import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getRequestUser } from '@/lib/supabase/request-auth'
import { PLAN_ORDER } from '@/lib/plans'

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
 * POST /api/form/[id]/whatsapp/test
 * 
 * Send a test WhatsApp message to verify settings
 * 
 * Body:
 * - owner_phone: string (required) - Phone number to send test message
 * - message_template: string (required) - Message template to test
 * - instance_name: string (optional) - WhatsApp instance to use
 * 
 * Status codes:
 * - 200: OK (message sent)
 * - 400: Bad Request (invalid input)
 * - 401: Unauthorized (no auth)
 * - 403: Forbidden (not form owner or not Plus+ plan)
 * - 404: Not Found (form not found)
 * - 500: Internal Server Error
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

    // 2. Get Supabase client and check form ownership & plan
    const supabase = getServiceClient()
    const { data: form, error: formError } = await supabase
      .from('forms')
      .select('id, user_id, title, plan')
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

    // 3. Check if user has Plus+ plan
    if (!isPlusPlan(form.plan)) {
      return NextResponse.json(
        { error: 'This feature is only available for Plus+ plans' },
        { status: 403 }
      )
    }

    // 4. Parse request body
    const body = await request.json()
    const { owner_phone, message_template, instance_name = 'default' } = body

    // 5. Validate input
    if (!owner_phone || typeof owner_phone !== 'string') {
      return NextResponse.json(
        { error: 'owner_phone is required and must be a string' },
        { status: 400 }
      )
    }

    if (!message_template || typeof message_template !== 'string') {
      return NextResponse.json(
        { error: 'message_template is required and must be a string' },
        { status: 400 }
      )
    }

    // 6. Call the WhatsApp send API
    const internalApiSecret = process.env.INTERNAL_API_SECRET
    if (!internalApiSecret) {
      console.error('[whatsapp/test] INTERNAL_API_SECRET not configured')
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      )
    }

    const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || ''}/api/whatsapp/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${internalApiSecret}`,
      },
      body: JSON.stringify({
        phone_number: owner_phone,
        message: message_template,
        instance_name,
        test_mode: true,
      }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      console.error('[whatsapp/test] API error:', error)
      
      return NextResponse.json(
        {
          error: error.error || 'Failed to send test message',
          details: error.details || null,
        },
        { status: response.status }
      )
    }

    const result = await response.json()

    return NextResponse.json(
      {
        success: true,
        message: 'Test message sent successfully',
        messageId: result.messageId,
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('[whatsapp/test] POST error:', error)
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
