import { NextRequest, NextResponse } from 'next/server'
import { getWhatsAppSettings } from '@/lib/whatsapp'
import { logError, logWarn } from '@/lib/logger'
import { createServerClient } from '@supabase/ssr'
import { PLANS } from '@/lib/plan-limits'
import { getEffectivePlan, type PlanId } from '@/lib/plans'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { getWhatsappUrl, getWhatsappAuthHeaders } from '@/lib/whatsapp-client'

const MAX_SENDS_PER_HOUR = 100

/**
 * Rate limit keyed by both form and phone to isolate noisy forms (P1-N3).
 * Direct-send path uses phone only (no formId available).
 */
async function checkWhatsAppRateLimit(
  cleanPhone: string,
  maxAttempts = MAX_SENDS_PER_HOUR,
  formId?: string
): Promise<boolean> {
  const key = formId ? `whatsapp:${formId}:${cleanPhone}` : `whatsapp:${cleanPhone}`
  const { allowed } = await checkRateLimitAsync(key, {
    maxAttempts,
    windowMs: 3_600_000,
  })
  return allowed
}

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
  to: string
  message: string
}

function isValidPhoneNumber(phone: string): boolean {
  const cleaned = phone.replace(/\D/g, '')
  return cleaned.length >= 11 && cleaned.length <= 15
}

/**
 * Normalize and sanitize a template value before substitution.
 * NFKC normalization prevents Unicode homoglyph injection (P1-N2).
 */
function normalizeValue(value: string): string {
  return value.normalize('NFKC')
}

/**
 * Build message from template and lead data.
 * Normalizes Unicode (NFKC) on all substituted values to prevent homoglyph attacks (P1-N2).
 */
function buildMessage(template: string, leadData: FormAwareRequest['leadData']): string {
  let msg = template.normalize('NFKC')

  // Named variables (higher priority). Aceita variantes com hífen (ex.: {e-mail}).
  msg = msg.replace(/\{form_name\}/gi, `*${normalizeValue(String(leadData.form_name || 'Formulário'))}*`) // nome do form em negrito no WhatsApp (só no envio, não na UI)
  msg = msg.replace(/\{nome\}/gi, normalizeValue(String(leadData.name || leadData.nome || 'Lead')))
  msg = msg.replace(/\{e-?mail\}/gi, normalizeValue(String(leadData.email || 'N/A')))
  msg = msg.replace(/\{phone\}/gi, normalizeValue(String(leadData.phone || leadData.telefone || 'N/A')))
  msg = msg.replace(/\{response_id\}/gi, normalizeValue(String(leadData.response_id || 'N/A')))
  msg = msg.replace(/\{response_link\}/gi, normalizeValue(String(leadData.response_link || 'N/A')))
  // {meta_events}: com eventos → substitui; SEM eventos → apaga a LINHA inteira do
  // template (evita "Eventos Meta:" pendurado sem valor na mensagem).
  const metaEventsValue = normalizeValue(String(leadData.meta_events || ''))
  if (metaEventsValue) msg = msg.replace(/\{meta_events\}/gi, metaEventsValue)
  else msg = msg.replace(/^.*\{meta_events\}.*(?:\r?\n|$)/gim, '')

  // Catch-all: substitui {qualquer chave} restante.
  // Aceita chaves com hífen, espaço e acento (ex.: {telefone_contato}, {telefone de contato}).
  // A comparação é feita por chave normalizada (lowercase, sem acento, só alfanumérico)
  // para casar o que o dono digita no template com o título real da pergunta.
  const normKey = (k: string): string =>
    k.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
  const normalizedLead = new Map<string, unknown>()
  for (const [k, v] of Object.entries(leadData)) {
    const nk = normKey(k)
    if (nk && !normalizedLead.has(nk)) normalizedLead.set(nk, v)
  }
  msg = msg.replace(/\{([^{}\n]+)\}/g, (match, rawKey: string) => {
    const nk = normKey(rawKey)
    if (normalizedLead.has(nk)) return normalizeValue(String(normalizedLead.get(nk) ?? ''))
    return match // chave desconhecida: mantém literal em vez de apagar
  })

  return msg
}

/**
 * Send message via WhatsApp VPS server
 */
async function sendViaVps(phone: string, message: string): Promise<{ messageId: string }> {
  const cleanPhone = phone.replace(/\D/g, '')

  try {
    const response = await fetch(getWhatsappUrl('/api/whatsapp/send'), {
      method: 'POST',
      headers: {
        ...getWhatsappAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: cleanPhone,
        message,
      }),
      signal: AbortSignal.timeout(30_000),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      const status = response.status

      if (status === 401 || status === 403) {
        throw new Error('WHATSAPP_NOT_AUTH: VPS authentication failed')
      }
      if (status === 503) {
        throw new Error('WHATSAPP_UNAVAILABLE: VPS service unavailable')
      }

      throw new Error(`VPS_ERROR: ${status} ${text.slice(0, 200)}`)
    }

    const data = await response.json()
    // `||` (não `??`): a VPS pode devolver messageId como string vazia quando o
    // wacli não expõe `data.id` — `??` deixaria passar o "" e a telemetria
    // chegava como `msgId: N/A`. Ver briefing-whatsapp-msgid-perdido.md.
    return { messageId: data.messageId || `vps-${Date.now()}` }
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error)

    if (errMsg.includes('timeout') || errMsg.includes('ECONNREFUSED')) {
      throw new Error('WHATSAPP_UNAVAILABLE: VPS server unreachable')
    }
    if (errMsg.includes('not authenticated') || errMsg.includes('not logged in')) {
      throw new Error('WHATSAPP_NOT_AUTH: VPS WhatsApp not authenticated')
    }
    throw new Error(`WHATSAPP_ERROR: ${errMsg.slice(0, 200)}`)
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
 *    Fetches settings from DB, builds message from template, sends via VPS.
 *
 * 2. Direct (legacy/internal): { to, message }
 *    Sends directly via VPS. Requires internal auth.
 *
 * Auth: Bearer token (INTERNAL_API_SECRET) for server-to-server
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
      if (!isInternal) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
      }
      return await handleFormAwareSend(body as unknown as FormAwareRequest)
    }

    // Mode 2: Direct send (backward compat)
    if (body.to && body.message) {
      if (!isInternal) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
      }
      return await handleDirectSend(body as unknown as DirectSendRequest & { formId?: string })
    }

    return NextResponse.json(
      { success: false, error: 'Provide { formId, leadData } or { to, message }' },
      { status: 400 }
    )
  } catch (error) {
    logError('[whatsapp/send] Error:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}

async function handleFormAwareSend(
  data: FormAwareRequest,
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

  // 1b. Plan check — verify form owner has Plus or Professional (P1-N4: consolidated here)
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } }
  )
  const { data: formData } = await supabase
    .from('forms')
    .select('user_id')
    .eq('id', data.formId)
    .single()
  if (formData?.user_id) {
    const { data: ownerProfile } = await supabase
      .from('profiles')
      .select('plan, plan_expires_at')
      .eq('id', formData.user_id)
      .single()
    const plan = getEffectivePlan(ownerProfile) as PlanId
    if (!PLANS[plan]?.whatsappNotifications) {
      return NextResponse.json(
        { success: false, error: 'WhatsApp requires Plus or Professional plan' },
        { status: 403 }
      )
    }
  }

  // 2. Rate limit check — keyed by form + phone to isolate noisy forms (P1-N3)
  const cleanPhone = settings.owner_phone.replace(/\D/g, '')
  if (!(await checkWhatsAppRateLimit(cleanPhone, settings.rate_limit_per_hour ?? MAX_SENDS_PER_HOUR, data.formId))) {
    return NextResponse.json(
      { success: false, error: 'Rate limit exceeded. Try again later.' },
      { status: 429 }
    )
  }

  // 3. Build message from template (Unicode normalized)
  const message = buildMessage(settings.message_template, data.leadData)

  // 4. Validate phone
  if (!isValidPhoneNumber(settings.owner_phone)) {
    return NextResponse.json(
      { success: false, error: 'Invalid owner phone number format' },
      { status: 400 }
    )
  }

  // 5. Send via VPS
  try {
    const result = await sendViaVps(settings.owner_phone, message)
    return NextResponse.json({
      success: true,
      messageId: result.messageId,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logError(`[whatsapp/send] VPS error for form ${data.formId}:`, msg)

    if (msg.startsWith('WHATSAPP_NOT_AUTH')) {
      return NextResponse.json({ success: false, error: 'WhatsApp not authenticated' }, { status: 503 })
    }
    if (msg.startsWith('WHATSAPP_UNAVAILABLE')) {
      return NextResponse.json({ success: false, error: 'WhatsApp service unavailable' }, { status: 503 })
    }
    return NextResponse.json({ success: false, error: 'Failed to send WhatsApp message' }, { status: 502 })
  }
}

async function handleDirectSend(data: DirectSendRequest & { formId?: string }): Promise<NextResponse> {
  const cleanPhone = data.to.replace(/\D/g, '')

  // P2: Plan gate when formId is present
  if (data.formId) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { cookies: { getAll: () => [], setAll: () => {} } }
    )
    const { data: formData } = await supabase
      .from('forms')
      .select('user_id')
      .eq('id', data.formId)
      .single()
    if (formData?.user_id) {
      const { data: ownerProfile } = await supabase
        .from('profiles')
        .select('plan, plan_expires_at')
        .eq('id', formData.user_id)
        .single()
      const plan = getEffectivePlan(ownerProfile) as PlanId
      if (!PLANS[plan]?.whatsappNotifications) {
        return NextResponse.json(
          { success: false, error: 'WhatsApp requires Plus or Professional plan' },
          { status: 403 }
        )
      }
    }
  } else {
    logWarn('[whatsapp/send] Direct send without formId — no plan gate applied')
  }

  if (!isValidPhoneNumber(cleanPhone)) {
    return NextResponse.json(
      { success: false, error: 'Invalid phone number format' },
      { status: 400 }
    )
  }

  if (!(await checkWhatsAppRateLimit(cleanPhone))) {
    return NextResponse.json(
      { success: false, error: 'Rate limit exceeded' },
      { status: 429 }
    )
  }

  try {
    const result = await sendViaVps(cleanPhone, data.message)
    return NextResponse.json({
      success: true,
      messageId: result.messageId,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logError('[whatsapp/send] direct send error:', msg)

    if (msg.startsWith('WHATSAPP_NOT_AUTH')) {
      return NextResponse.json({ success: false, error: 'WhatsApp not authenticated' }, { status: 503 })
    }
    if (msg.startsWith('WHATSAPP_UNAVAILABLE')) {
      return NextResponse.json({ success: false, error: 'WhatsApp service unavailable' }, { status: 503 })
    }
    return NextResponse.json({ success: false, error: 'Failed to send message' }, { status: 502 })
  }
}
