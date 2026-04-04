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
 * Retry simples: 1 tentativa com timeout de 10s.
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
      redirect: 'manual', // Don't follow redirects to private IPs
    })
    clearTimeout(timeout)

    if (!res.ok) {
      logError(
        `[webhook-dispatcher] FAILED`,
        { formId, responseId, status: res.status }
      )
      return { success: false, statusCode: res.status, error: `HTTP ${res.status}` }
    }

    return { success: true, statusCode: res.status }
  } catch (err) {
    clearTimeout(timeout)
    const msg = err instanceof Error ? err.message : String(err)
    logError(
      `[webhook-dispatcher] ERROR`,
      { formId, responseId, error: msg }
    )
    return { success: false, error: msg }
  }
}
