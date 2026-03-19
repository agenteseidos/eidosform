/**
 * lib/webhook-dispatcher.ts — Dispara webhooks externos ao receber resposta
 * 1 tentativa, log de falha
 * Bug #4: SSRF protection — blocks private IPs and non-HTTPS URLs
 */

export interface WebhookPayload {
  event: 'form.response'
  form_id: string
  response_id: string
  created_at: string
  data: Record<string, unknown>
}

// SSRF protection: validate webhook URL
function isUrlSafe(urlString: string): { safe: boolean; reason?: string } {
  let url: URL
  try {
    url = new URL(urlString)
  } catch {
    return { safe: false, reason: 'Invalid URL' }
  }

  // Only allow HTTPS
  if (url.protocol !== 'https:') {
    return { safe: false, reason: 'Only HTTPS URLs are allowed' }
  }

  const hostname = url.hostname.toLowerCase()

  // Block localhost variants
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]') {
    return { safe: false, reason: 'Localhost URLs are not allowed' }
  }

  // Block private/internal IP ranges
  const ipMatch = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipMatch) {
    const [, a, b] = ipMatch.map(Number)
    if (
      a === 10 ||                              // 10.0.0.0/8
      a === 127 ||                             // 127.0.0.0/8
      (a === 172 && b >= 16 && b <= 31) ||     // 172.16.0.0/12
      (a === 192 && b === 168) ||              // 192.168.0.0/16
      (a === 169 && b === 254) ||              // 169.254.0.0/16 (link-local / AWS metadata)
      a === 0                                  // 0.0.0.0/8
    ) {
      return { safe: false, reason: 'Private/internal IP addresses are not allowed' }
    }
  }

  // Block metadata service hostnames
  if (hostname === 'metadata.google.internal' || hostname.endsWith('.internal')) {
    return { safe: false, reason: 'Internal hostnames are not allowed' }
  }

  return { safe: true }
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
  const urlCheck = isUrlSafe(webhookUrl)
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
