/**
 * lib/webhook-dispatcher.ts — Dispara webhooks externos ao receber resposta
 * Retry com backoff: 4 tentativas (0, 1s, 2s, 4s).
 * P1-D: HMAC-SHA256 signature for payload verification by consumers.
 * SSRF protection — blocks private IPs and non-HTTPS URLs.
 */

import { validateWebhookUrlAsync } from './webhook-validator'
import { logError } from '@/lib/logger'

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
  /** Metadata dos campos para facilitar integração com sistemas externos */
  fields?: WebhookFieldMeta[]
}

/**
 * Generate HMAC-SHA256 signature for webhook payload.
 * Consumers can verify using: crypto.createHmac('sha256', secret).update(payload).digest('hex')
 */
async function generateWebhookSignature(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const keyData = encoder.encode(secret)
  const data = encoder.encode(payload)
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, data)
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Dispara POST para webhook_url configurada pelo usuário.
 * Retry com backoff: 4 tentativas (0, 1s, 2s, 4s).
 * Falhas são logadas mas não bloqueiam o fluxo.
 * Inclui header X-EidosForm-Signature com HMAC-SHA256 para verificação pelo consumidor.
 */
export async function dispatchWebhook(params: {
  webhookUrl: string
  formId: string
  responseId: string
  responseData: Record<string, unknown>
  /** Metadata dos campos (opcional) para enriquecer o payload */
  fields?: WebhookFieldMeta[]
}): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  const { webhookUrl, formId, responseId, responseData, fields } = params

  // SSRF validation (async — includes DNS rebinding check)
  const urlCheck = await validateWebhookUrlAsync(webhookUrl)
  if (!urlCheck.safe) {
    logError(
      `[webhook-dispatcher] BLOCKED`,
      { formId, reason: urlCheck.reason }
    )
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

  const bodyStr = JSON.stringify(payload)

  // P1-D: Generate HMAC signature so consumers can verify authenticity
  const webhookSecret = process.env.WEBHOOK_SECRET
  const signature = webhookSecret ? await generateWebhookSignature(bodyStr, webhookSecret) : null

  const delays = [0, 1000, 2000, 4000]
  let lastError: string | undefined

  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, delays[attempt]))
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-EidosForm-Event': 'form.response',
        'X-EidosForm-Form-Id': formId,
      }
      if (signature) {
        headers['X-EidosForm-Signature'] = `sha256=${signature}`
        headers['X-EidosForm-Timestamp'] = new Date().toISOString()
      }

      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers,
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

  logError(
    `[webhook-dispatcher] FAILED after 4 attempts`,
    { formId, responseId, error: lastError }
  )
  return { success: false, error: lastError }
}
