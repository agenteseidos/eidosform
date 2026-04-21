/**
 * lib/webhook-dispatcher.ts — Dispara webhooks externos ao receber resposta
 * 1 tentativa, log de falha
 * Bug #4: SSRF protection — blocks private IPs and non-HTTPS URLs
 */

import { validateWebhookUrl } from './webhook-validator'
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
 * Dispara POST para webhook_url configurada pelo usuário.
 * Retry com backoff: 3 tentativas (1s, 2s, 4s).
 * Falhas são logadas mas não bloqueiam o fluxo.
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

  // SSRF validation
  const urlCheck = validateWebhookUrl(webhookUrl)
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
        },
        body: JSON.stringify(payload),
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
