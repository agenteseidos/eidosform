import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getRequestUser } from '@/lib/supabase/request-auth'
import { PLANS } from '@/lib/plan-limits'
import { getEffectivePlan, type PlanId } from '@/lib/plans'
import { checkRateLimitAsync } from '@/lib/rate-limit'

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
 * POST /api/form/[id]/whatsapp/test
 * 
 * Send a test WhatsApp message to verify settings
 * 
 * Body:
 * - owner_phone: string (required) - Phone number to send test message
 * - message_template: string (required) - Message template to test
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
      .select('id, user_id, title')
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

    // 3. Check if user has Plus+ plan (from profiles, not forms)
    const { data: profile } = await supabase
      .from('profiles')
      .select('plan, plan_expires_at')
      .eq('id', user.id)
      .single()

    const plan = getEffectivePlan(profile) as PlanId
    if (!PLANS[plan]?.whatsappNotifications) {
      return NextResponse.json(
        { error: 'This feature is only available for Plus+ plans' },
        { status: 403 }
      )
    }

    // 4. Rate limit: 5 test sends per user per 15 minutes
    const { allowed, resetIn } = await checkRateLimitAsync(`whatsapp-test:${user.id}`, {
      maxAttempts: 5,
      windowMs: 15 * 60 * 1000,
    })
    if (!allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Try again later.', resetIn },
        { status: 429 }
      )
    }

    // 5. Parse request body
    const body = await request.json()
    const { owner_phone, message_template } = body

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

    // Connectivity test only — send template raw (no variable substitution)
    const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || ''}/api/whatsapp/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${internalApiSecret}`,
      },
      body: JSON.stringify({
        to: owner_phone,
        message: message_template,
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
