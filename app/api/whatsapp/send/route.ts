import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { getWhatsAppSettings } from '@/lib/whatsapp'
import { logError, logWarn } from '@/lib/logger'

const execFileAsync = promisify(execFile)

const WACLI_PATH = '/home/linuxbrew/.linuxbrew/bin/wacli'

// In-memory rate limiter: tracks sends per phone number per hour
const rateLimiter = new Map<string, { count: number; resetAt: number }>()
const MAX_SENDS_PER_HOUR = 100

function checkRateLimit(phone: string): boolean {
  const now = Date.now()
  const entry = rateLimiter.get(phone)

  if (!entry || now > entry.resetAt) {
    rateLimiter.set(phone, { count: 1, resetAt: now + 3600_000 })
    return true
  }

  if (entry.count >= MAX_SENDS_PER_HOUR) {
    return false
  }

  entry.count++
  return true
}

// Clean up expired entries every 10 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of rateLimiter) {
    if (now > entry.resetAt) rateLimiter.delete(key)
  }
}, 600_000)

interface FormAwareRequest {
  formId: string
  leadData: {
    name?: string
    email?: string
    phone?: string
    [key: string]: unknown
  }
}

interface DirectSendRequest {
  instance: string
  to: string
  message: string
}

function isValidPhoneNumber(phone: string): boolean {
  const cleaned = phone.replace(/\D/g, '')
  return cleaned.length >= 11 && cleaned.length <= 15
}

/**
 * Build message from template and lead data
 */
function buildMessage(template: string, leadData: FormAwareRequest['leadData'], formId: string): string {
  let msg = template
  msg = msg.replace(/\{form_name\}/g, 'Formulário')
  msg = msg.replace(/\{nome\}/g, String(leadData.name || leadData.nome || 'Lead'))
  msg = msg.replace(/\{email\}/g, String(leadData.email || 'N/A'))
  msg = msg.replace(/\{phone\}/g, String(leadData.phone || 'N/A'))
  msg = msg.replace(/\{response_id\}/g, 'N/A')

  // Replace any remaining {key} with leadData values
  msg = msg.replace(/\{(\w+)\}/g, (_, key) => {
    return String(leadData[key] ?? '')
  })

  return msg
}

/**
 * Send message via wacli CLI
 */
async function sendViaWacli(phone: string, message: string): Promise<{ messageId: string }> {
  const cleanPhone = phone.replace(/\D/g, '')

  try {
    const { stdout } = await execFileAsync(
      WACLI_PATH,
      ['send', '--to', cleanPhone, '--text', message],
      { timeout: 30_000, env: { ...process.env, HOME: process.env.HOME } }
    )

    const idMatch = stdout.match(/["']?messageId["']?\s*:\s*["']?([^"'\s,}]+)/)
    return { messageId: idMatch?.[1] ?? `wacli-${Date.now()}` }
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error)

    if (errMsg.includes('not logged in') || errMsg.includes('unauthorized')) {
      throw new Error('WHATCLI_NOT_AUTH: wacli is not authenticated')
    }
    if (errMsg.includes('not found') || errMsg.includes('ENOENT')) {
      throw new Error('WHATCLI_MISSING: wacli CLI not found')
    }
    throw new Error(`WHATCLI_ERROR: ${errMsg.slice(0, 200)}`)
  }
}

/**
 * Validate internal API key or user auth for server-to-server calls
 */
function isInternalRequest(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return false
  const token = authHeader.slice(7).trim()
  return token === process.env.INTERNAL_API_SECRET && !!process.env.INTERNAL_API_SECRET
}

/**
 * POST /api/whatsapp/send
 *
 * Two modes:
 * 1. Form-aware (recommended): { formId, leadData: { name, email, phone, ... } }
 *    Fetches settings from DB, builds message from template, sends via wacli.
 *
 * 2. Direct (legacy): { instance, to, message }
 *    Sends directly via wacli. Requires user auth.
 *
 * Auth: Bearer token (user JWT via getRequestUser) or INTERNAL_API_SECRET for server-to-server
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const isInternal = isInternalRequest(req)
    let body: Record<string, unknown>

    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 })
    }

    // Mode 1: Form-aware send
    if (body.formId && body.leadData) {
      return await handleFormAwareSend(body as unknown as FormAwareRequest, isInternal)
    }

    // Mode 2: Direct send (backward compat)
    if (body.instance && body.to && body.message) {
      if (!isInternal) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
      }
      return await handleDirectSend(body as unknown as DirectSendRequest)
    }

    return NextResponse.json(
      { success: false, error: 'Provide { formId, leadData } or { instance, to, message }' },
      { status: 400 }
    )
  } catch (error) {
    console.error('[whatsapp/send] Error:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}

async function handleFormAwareSend(
  data: FormAwareRequest,
  _isInternal: boolean
): Promise<NextResponse> {
  // 1. Fetch WhatsApp settings for this form
  const settings = await getWhatsAppSettings(data.formId)

  if (!settings || !settings.enabled) {
    return NextResponse.json(
      { success: false, error: 'WhatsApp not enabled for this form' },
      { status: 200 } // Not an error — just not configured
    )
  }

  if (!settings.owner_phone) {
    logWarn(`[whatsapp/send] No owner_phone configured for form ${data.formId}`)
    return NextResponse.json(
      { success: false, error: 'No WhatsApp phone configured' },
      { status: 400 }
    )
  }

  // 2. Rate limit check
  if (!checkRateLimit(settings.owner_phone)) {
    return NextResponse.json(
      { success: false, error: 'Rate limit exceeded. Try again later.' },
      { status: 429 }
    )
  }

  // 3. Build message from template
  const message = buildMessage(settings.message_template, data.leadData, data.formId)

  // 4. Validate phone
  if (!isValidPhoneNumber(settings.owner_phone)) {
    return NextResponse.json(
      { success: false, error: 'Invalid owner phone number format' },
      { status: 400 }
    )
  }

  // 5. Send via wacli
  try {
    const result = await sendViaWacli(settings.owner_phone, message)
    return NextResponse.json({
      success: true,
      messageId: result.messageId,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logError(`[whatsapp/send] wacli error for form ${data.formId}:`, msg)

    if (msg.startsWith('WHATCLI_NOT_AUTH')) {
      return NextResponse.json({ success: false, error: 'WhatsApp not authenticated' }, { status: 503 })
    }
    if (msg.startsWith('WHATCLI_MISSING')) {
      return NextResponse.json({ success: false, error: 'WhatsApp CLI not available' }, { status: 503 })
    }
    return NextResponse.json({ success: false, error: 'Failed to send WhatsApp message' }, { status: 502 })
  }
}

async function handleDirectSend(data: DirectSendRequest): Promise<NextResponse> {
  const cleanPhone = data.to.replace(/\D/g, '')

  if (!isValidPhoneNumber(cleanPhone)) {
    return NextResponse.json(
      { success: false, error: 'Invalid phone number format' },
      { status: 400 }
    )
  }

  if (!checkRateLimit(cleanPhone)) {
    return NextResponse.json(
      { success: false, error: 'Rate limit exceeded' },
      { status: 429 }
    )
  }

  try {
    const result = await sendViaWacli(cleanPhone, data.message)
    return NextResponse.json({
      success: true,
      messageId: result.messageId,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logError('[whatsapp/send] direct send error:', msg)

    if (msg.startsWith('WHATCLI_NOT_AUTH')) {
      return NextResponse.json({ success: false, error: 'WhatsApp not authenticated' }, { status: 503 })
    }
    return NextResponse.json({ success: false, error: 'Failed to send message' }, { status: 502 })
  }
}
