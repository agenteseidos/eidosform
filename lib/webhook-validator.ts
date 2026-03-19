/**
 * lib/webhook-validator.ts — SSRF protection for webhook URLs
 * Shared between form webhook endpoint and webhook dispatcher.
 */

export function validateWebhookUrl(urlString: string): { safe: boolean; reason?: string } {
  let url: URL
  try {
    url = new URL(urlString)
  } catch {
    return { safe: false, reason: 'Invalid URL' }
  }

  if (url.protocol !== 'https:') {
    return { safe: false, reason: 'Only HTTPS URLs are allowed' }
  }

  const hostname = url.hostname.toLowerCase()

  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname === '0.0.0.0'
  ) {
    return { safe: false, reason: 'Localhost URLs are not allowed' }
  }

  if (hostname.endsWith('.internal') || hostname === 'metadata.google.internal') {
    return { safe: false, reason: 'Internal hostnames are not allowed' }
  }

  const ipMatch = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipMatch) {
    const [, a, b] = ipMatch.map(Number)
    if (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 0
    ) {
      return { safe: false, reason: 'Private/internal IP addresses are not allowed' }
    }
  }

  return { safe: true }
}
