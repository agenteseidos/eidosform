import { NextRequest, NextResponse } from 'next/server'
import { execSync } from 'child_process'
import { getRequestUser } from '@/lib/supabase/request-auth'
import { createServerClient } from '@supabase/ssr'

/**
 * POST /api/whatsapp/send
 * Send a WhatsApp message via wacli integration.
 *
 * Authentication: Requires Bearer token or API key (Plus+ plan)
 * Params:
 *   - instance: WhatsApp instance name (e.g., "eidosform-plus")
 *   - to: Phone number to send to (e.g., "5585999999999")
 *   - message: Message text to send
 *   - template_vars: Optional object with template variables (future use)
 *
 * Response:
 *   { success: true, messageId: "xxx", timestamp: "ISO8601" }
 *
 * Errors:
 *   - 400: Invalid input (missing fields, invalid phone)
 *   - 401: Unauthorized (no auth, invalid token/key)
 *   - 403: Forbidden (plan doesn't support WhatsApp)
 *   - 429: Rate limited
 *   - 503: wacli not logged in or not available
 *   - 500: Internal server error
 */

interface SendWhatsAppRequest {
  instance: string
  to: string
  message: string
  template_vars?: Record<string, string>
}

interface SendWhatsAppResponse {
  success: true
  messageId: string
  timestamp: string
}

interface SendWhatsAppError {
  success: false
  error: string
}

/**
 * Validate phone number format (Brazilian format: 55 + 2 digit area + 8/9 digit number)
 */
function isValidPhoneNumber(phone: string): boolean {
  // Accept: 5585999999999 or +5585999999999 or similar
  const cleaned = phone.replace(/\D/g, '')
  // Must start with 55 (Brazil country code) and have 11-13 digits total
  return cleaned.length >= 11 && cleaned.length <= 13 && cleaned.startsWith('55')
}

/**
 * Call wacli CLI to send message
 */
function sendViaWacli(instance: string, phone: string, message: string): { messageId: string } {
  try {
    // wacli send --number=INSTANCE --phone=TO --message="MESSAGE"
    // Expect response: message ID or success indicator
    const cmd = `wacli send --number=${instance} --phone=${phone} --message="${message.replace(/"/g, '\\"')}"`

    const output = execSync(cmd, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'], // capture stdout, stderr
    }).trim()

    // Parse output to extract message ID
    // Assuming wacli returns something like: {"success": true, "messageId": "xxx"}
    // or just prints: "Message sent successfully. ID: xxx"
    // For now, extract ID from output or generate one
    const idMatch = output.match(/["\']?messageId["\']?\s*:\s*["\']?([^"'\s,}]+)/)
    const messageId = idMatch ? idMatch[1] : `wacli-${Date.now()}`

    return { messageId }
  } catch (error: unknown) {
    const stderr = error instanceof Error
      ? (error as NodeJS.ErrnoException).stderr?.toString() || error.message
      : String(error)

    // Check for specific wacli errors
    if (stderr.includes('not logged in') || stderr.includes('unauthorized')) {
      throw new WacliError('wacli not logged in', 503)
    }

    if (stderr.includes('invalid phone') || stderr.includes('invalid number')) {
      throw new WacliError('Invalid phone number format', 400)
    }

    if (stderr.includes('rate limit') || stderr.includes('too many')) {
      throw new WacliError('Rate limited by WhatsApp', 429)
    }

    if (stderr.includes('command not found')) {
      throw new WacliError('wacli CLI not installed or not in PATH', 503)
    }

    // Generic wacli error
    throw new WacliError(`wacli error: ${stderr.slice(0, 100)}`, 503)
  }
}

class WacliError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message)
    this.name = 'WacliError'
  }
}

/**
 * Check if user's plan supports WhatsApp (Plus+)
 */
async function checkPlanSupportsWhatsApp(userId: string): Promise<boolean> {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } }
  )

  const { data: profile } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', userId)
    .single()

  if (!profile) return false

  // Plans that support WhatsApp: plus, professional, enterprise
  const allowedPlans = ['plus', 'professional', 'enterprise']
  return allowedPlans.includes(profile.plan?.toLowerCase() || '')
}

export async function POST(req: NextRequest): Promise<NextResponse<SendWhatsAppResponse | SendWhatsAppError>> {
  try {
    // 1. Get authenticated user
    const user = await getRequestUser(req)

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Provide a valid Bearer token.' },
        { status: 401 }
      )
    }

    // 2. Check plan supports WhatsApp
    const hasAccess = await checkPlanSupportsWhatsApp(user.id)

    if (!hasAccess) {
      return NextResponse.json(
        { success: false, error: 'WhatsApp integration requires Plus plan or higher.' },
        { status: 403 }
      )
    }

    // 3. Parse request body
    const body: SendWhatsAppRequest = await req.json()

    const { instance, to, message, template_vars } = body

    // 4. Validate required fields
    if (!instance || !instance.trim()) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: instance' },
        { status: 400 }
      )
    }

    if (!to || !to.trim()) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: to' },
        { status: 400 }
      )
    }

    if (!message || !message.trim()) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: message' },
        { status: 400 }
      )
    }

    // 5. Validate phone number format
    const cleanPhone = to.replace(/\D/g, '')
    if (!isValidPhoneNumber(cleanPhone)) {
      return NextResponse.json(
        { success: false, error: 'Invalid phone number format. Use 55 + area code + number.' },
        { status: 400 }
      )
    }

    // 6. Call wacli to send message
    const { messageId } = sendViaWacli(instance, cleanPhone, message)

    // 7. Return success response
    return NextResponse.json(
      {
        success: true,
        messageId,
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    )
  } catch (error: unknown) {
    // Handle WacliError with custom status codes
    if (error instanceof WacliError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: error.statusCode }
      )
    }

    // JSON parse error or other input validation
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON in request body.' },
        { status: 400 }
      )
    }

    console.error('WhatsApp send error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
