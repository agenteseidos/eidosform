/**
 * lib/meta-capi.ts — Meta Conversions API (CAPI) server-side event dispatch
 *
 * Sends conversion events (Lead) to Meta's Conversions API from the server,
 * complementing client-side pixel tracking. Uses SHA-256 hashed PII for
 * Advanced Matching and deduplicates via event_id shared with the pixel.
 *
 * Env vars (optional — graceful degradation if missing):
 *   META_ACCESS_TOKEN — System user token with CAPI permissions
 *   META_PIXEL_ID     — Meta Pixel ID
 */

const META_API_URL = 'https://graph.facebook.com/v21.0'

/**
 * SHA-256 hash a string for Meta Advanced Matching.
 * Trims, lowercases, and normalizes before hashing.
 */
async function sha256Normalize(data: string): Promise<string> {
  const encoder = new TextEncoder()
  const normalized = data.trim().toLowerCase().replace(/\s+/g, '')
  const buffer = encoder.encode(normalized)
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

interface MetaCAPIPayload {
  event_name: string
  event_time: number
  event_id: string
  action_source: 'website' | 'email' | 'app' | 'phone_call' | 'chat' | 'physical_store' | 'system_generated' | 'other'
  event_source_url?: string
  user_data: {
    em?: string[]       // hashed email
    ph?: string[]       // hashed phone
    fn?: string[]       // hashed first name
    ln?: string[]       // hashed last name
    client_ip_address?: string
    client_user_agent?: string
  }
  custom_data?: Record<string, unknown>
}

export interface MetaCAPIOptions {
  email?: string
  phone?: string
  firstName?: string
  lastName?: string
  ip?: string
  userAgent?: string
  eventId: string
  formTitle?: string
  eventSourceUrl?: string
}

/**
 * Send a conversion event to Meta CAPI.
 * Fire-and-forget — never throws. Returns success boolean for logging only.
 */
export async function sendMetaCAPIEvent(options: MetaCAPIOptions): Promise<boolean> {
  const accessToken = process.env.META_ACCESS_TOKEN
  const pixelId = process.env.META_PIXEL_ID

  if (!accessToken || !pixelId) {
    return false
  }

  try {
    // Build hashed user_data (snake_case keys per Meta CAPI spec)
    const userData: MetaCAPIPayload['user_data'] = {}

    if (options.email) {
      userData.em = [await sha256Normalize(options.email)]
    }
    if (options.phone) {
      const digitsOnly = options.phone.replace(/\D/g, '')
      if (digitsOnly.length >= 6) {
        userData.ph = [await sha256Normalize(digitsOnly)]
      }
    }
    if (options.firstName) {
      userData.fn = [await sha256Normalize(options.firstName)]
    }
    if (options.lastName) {
      userData.ln = [await sha256Normalize(options.lastName)]
    }
    if (options.ip) {
      userData.client_ip_address = options.ip
    }
    if (options.userAgent) {
      userData.client_user_agent = options.userAgent
    }

    const payload: MetaCAPIPayload = {
      event_name: 'Lead',
      event_time: Math.floor(Date.now() / 1000),
      event_id: options.eventId,
      action_source: 'website',
      ...(options.eventSourceUrl && { event_source_url: options.eventSourceUrl }),
      user_data: userData,
      ...(options.formTitle && { custom_data: { form_title: options.formTitle } }),
    }

    // test_event_code: quando setado em env (META_TEST_EVENT_CODE), o evento aparece
    // em tempo real na aba "Eventos de teste" do Events Manager. REMOVER em produção
    // após validar — eventos com test_event_code não contam pra otimização de campanhas.
    const testEventCode = process.env.META_TEST_EVENT_CODE

    const url = `${META_API_URL}/${pixelId}/events?access_token=${accessToken}`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: [payload],
        access_token: accessToken,
        ...(testEventCode && { test_event_code: testEventCode }),
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[Meta CAPI] Failed:', response.status, errorText)
      return false
    }

    const result = await response.json()
    console.log('[Meta CAPI] Event sent:', result)
    return true
  } catch (err) {
    console.error('[Meta CAPI] Error:', err)
    return false
  }
}

/**
 * Extract PII fields from form answers for Meta CAPI.
 * Looks for common field types: email, phone, name/first_name/last_name.
 */
export function extractPIIFromAnswers(
  answers: Record<string, unknown>,
  questions: Array<{ id: string; type?: string; title?: string; fields?: Array<{ id: string; ref?: string }> }>
): { email?: string; phone?: string; firstName?: string; lastName?: string } {
  const result: { email?: string; phone?: string; firstName?: string; lastName?: string } = {}

  for (const question of questions) {
    const value = answers[question.id]
    if (typeof value !== 'string' && typeof value !== 'object') continue

    const qType = question.type?.toLowerCase() ?? ''
    const qTitle = question.title?.toLowerCase() ?? ''

    if (qType === 'email' || qTitle.includes('email') || qTitle.includes('e-mail')) {
      const email = typeof value === 'string' ? value : null
      if (email && email.includes('@')) result.email = email
    }

    if (qType === 'phone' || qType === 'tel' || qTitle.includes('telefone') || qTitle.includes('phone') || qTitle.includes('whatsapp') || qTitle.includes('celular')) {
      const phone = typeof value === 'string' ? value : null
      if (phone) result.phone = phone
    }

    // Name fields — full name or split
    if (qType === 'name' || qTitle.includes('nome')) {
      const name = typeof value === 'string' ? value.trim() : null
      if (name) {
        const parts = name.split(/\s+/)
        result.firstName = parts[0]
        if (parts.length > 1) {
          result.lastName = parts.slice(1).join(' ')
        }
      }
    }

    // Short text with name-like title
    if (qType === 'short_text' && !result.firstName) {
      if (qTitle.includes('primeiro nome') || qTitle.includes('first name')) {
        const v = typeof value === 'string' ? value.trim() : null
        if (v) result.firstName = v
      }
      if (qTitle.includes('sobrenome') || qTitle.includes('last name')) {
        const v = typeof value === 'string' ? value.trim() : null
        if (v) result.lastName = v
      }
    }
  }

  return result
}
