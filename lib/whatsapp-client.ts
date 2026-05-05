/**
 * Helpers for talking to the WhatsApp service running on the VPS
 * (wpp.eidosform.com.br by default). Centralised so that base URL,
 * auth header and error handling stay consistent.
 */

export function getWhatsappBase(): string {
  return process.env.WHATSAPP_API_URL || 'https://wpp.eidosform.com.br'
}

export function getWhatsappUrl(path: string): string {
  const base = getWhatsappBase()
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

export function getWhatsappAuthHeaders(): Record<string, string> {
  const key = process.env.WHATSAPP_API_KEY
  if (!key) {
    throw new Error('WHATSAPP_API_KEY environment variable is not set')
  }
  return {
    Authorization: `Bearer ${key}`,
  }
}
