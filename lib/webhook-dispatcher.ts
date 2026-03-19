/**
 * lib/webhook-dispatcher.ts — Dispara webhooks externos ao receber resposta
 * 1 tentativa, log de falha
 * Bug #4: SSRF protection — blocks private IPs and non-HTTPS URLs
 */

import { validateWebhookUrl } from './webhook-validator'

export interface WebhookPayload {
  event: 'form.response'
  form_id: string
  response_id: string
  created_at: string
  data: Record<string, unknown>
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
}): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  const { webhookUrl, formId, responseId, responseData } = params

  // SSRF validation
  const urlCheck = validateWebhookUrl(webhookUrl)
  if (!urlCheck.safe) {
    console.error(
      `[webhook-dispatcher] BLOCKED form=${formId} url=${webhookUrl} reason=${urlCheck.reason}`
    )
    return { success: false, error: urlCheck.reason }
  }

  const payload: WebhookPayload = {
    event: 'form.response',
    form_id: formId,
    response_id: responseId,
    created_at: new Date().toISOString(),
    data: responseData,
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
      console.error(
        `[webhook-dispatcher] FAILED form=${formId} response=${responseId} url=${webhookUrl} status=${res.status}`
      )
      return { success: false, statusCode: res.status, error: `HTTP ${res.status}` }
    }

    return { success: true, statusCode: res.status }
  } catch (err) {
    clearTimeout(timeout)
    const msg = err instanceof Error ? err.message : String(err)
    console.error(
      `[webhook-dispatcher] ERROR form=${formId} response=${responseId} url=${webhookUrl} error=${msg}`
    )
    return { success: false, error: msg }
  }
}
