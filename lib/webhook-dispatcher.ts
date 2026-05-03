/**
 * lib/webhook-dispatcher.ts — Dispara webhooks externos ao receber resposta
 * Retry com backoff: 4 tentativas (0, 1s, 2s, 4s).
 * SSRF protection — blocks private IPs and non-HTTPS URLs.
 */

import { validateWebhookUrlAsync } from './webhook-validator'
import { logError, logWarn } from '@/lib/logger'
import { createClient } from '@supabase/supabase-js'

export interface WebhookFieldMeta {
  question_id: string
  type: string
  title: string
}

export interface WebhookPayload {
  event: 'form.response'
  form_id: string
  response_id: string
  created_at: string
  data: Record<string, unknown>
  fields?: WebhookFieldMeta[]
}

/**
 * Sort object keys recursively for deterministic JSON serialization.
 * Required so HMAC is identical across retry attempts.
 */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortKeys(v)])
    )
  }
  return value
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

/**
 * Generate HMAC-SHA256 signature for webhook payload.
 * Consumers verify: crypto.createHmac('sha256', secret).update(payload).digest('hex')
 */
async function generateWebhookSignature(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function insertDlq(params: {
  formId: string
  responseId: string
  webhookUrl: string
  error: string
  ownerEmail?: string
}): Promise<void> {
  try {
    const supabase = getSupabase()
    await supabase.from('webhook_failures').insert({
      form_id: params.formId,
      response_id: params.responseId,
      webhook_url: params.webhookUrl,
      last_error: params.error,
      owner_email: params.ownerEmail ?? null,
    })
  } catch {
    // DLQ insert failure must never crash the response flow
  }
}

/**
 * Dispara POST para webhook_url configurada pelo usuário.
 * Retry com backoff: 4 tentativas (0, 1s, 2s, 4s).
 * Falhas são logadas mas não bloqueiam o fluxo.
 *
 * WEBHOOK_SECRET is mandatory. Dispatch is aborted without it (P0-INT1).
 */
export async function dispatchWebhook(params: {
  webhookUrl: string
  formId: string
  responseId: string
  responseData: Record<string, unknown>
  fields?: WebhookFieldMeta[]
  /** Owner email for DLQ notification after all retries fail */
  ownerEmail?: string
}): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  const { webhookUrl, formId, responseId, responseData, fields, ownerEmail } = params

  // WEBHOOK_SECRET is mandatory — abort without it (P0-INT1)
  const webhookSecret = process.env.WEBHOOK_SECRET
  if (!webhookSecret) {
    logWarn('[webhook-dispatcher] WEBHOOK_SECRET not configured — dispatch aborted', { formId })
    return { success: false, error: 'WEBHOOK_SECRET not configured' }
  }

  // SSRF validation (async — includes DNS rebinding check)
  const urlCheck = await validateWebhookUrlAsync(webhookUrl)
  if (!urlCheck.safe) {
    logError('[webhook-dispatcher] BLOCKED', { formId, reason: urlCheck.reason })
    return { success: false, error: urlCheck.reason }
  }

  const payload: WebhookPayload = {
    event: 'form.response',
    form_id: formId,
    response_id: responseId,
    created_at: new Date().toISOString(),
    data: responseData,
    ...(fields && fields.length > 0 ? { fields } : {}),
  }

  // Canonical JSON: sort keys so HMAC is deterministic across retries (P1-INT2)
  const bodyStr = canonicalJson(payload)

  // Generate signature once, outside the retry loop (timestamp fixed across retries)
  const signature = await generateWebhookSignature(bodyStr, webhookSecret)
  const fixedTimestamp = new Date().toISOString()

  const delays = [0, 1000, 2000, 4000]
  let lastError: string | undefined

  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, delays[attempt]))
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)

    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-EidosForm-Event': 'form.response',
          'X-EidosForm-Form-Id': formId,
          'X-EidosForm-Signature': `sha256=${signature}`,
          'X-EidosForm-Timestamp': fixedTimestamp,
        },
        body: bodyStr,
        signal: controller.signal,
        redirect: 'manual',
      })
      clearTimeout(timeout)

      if (res.ok) return { success: true, statusCode: res.status }

      lastError = `HTTP ${res.status}`
    } catch (err) {
      clearTimeout(timeout)
      lastError = err instanceof Error ? err.message : String(err)
    }
  }

  logError('[webhook-dispatcher] FAILED after 4 attempts', { formId, responseId, error: lastError })

  // DLQ: persist failure for dead-letter queue processing
  await insertDlq({ formId, responseId, webhookUrl, error: lastError ?? 'unknown', ownerEmail })

  return { success: false, error: lastError }
}
