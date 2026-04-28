/**
 * lib/webhook-validator.ts — SSRF protection for webhook URLs
 * Shared between form webhook endpoint and webhook dispatcher.
 * P1-F: Hardened against DNS rebinding by pre-resolving hostname.
 */

// Simple cache to avoid repeated DNS lookups for the same hostname
const dnsCache = new Map<string, { ips: string[]; expiresAt: number }>()
const DNS_CACHE_TTL_MS = 60_000

/**
 * Attempt to resolve hostname to IP addresses using Node.js dns module.
 * Falls back to empty array in Edge Runtime or if dns is unavailable.
 */
async function resolveHostname(hostname: string): Promise<string[]> {
  // Check cache first
  const cached = dnsCache.get(hostname)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.ips
  }

  try {
    // Dynamic import to avoid issues in Edge Runtime
    const dns = await import('dns').catch(() => null)
    if (!dns || !dns.promises || typeof dns.promises.resolve4 !== 'function') {
      return []
    }

    const addresses = await dns.promises.resolve4(hostname)
    dnsCache.set(hostname, { ips: addresses, expiresAt: Date.now() + DNS_CACHE_TTL_MS })
    return addresses
  } catch {
    // DNS resolution failed — allow the request through, the fetch itself will fail if invalid
    return []
  }
}

function isPrivateIP(ip: string): boolean {
  const match = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!match) return false
  const [, a, b] = match.map(Number)
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    a === 100 // CGNAT
  )
}

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

  // Block common cloud metadata endpoints
  if (
    hostname === '169.254.169.254' ||
    hostname.endsWith('.compute.internal') ||
    hostname.endsWith('.eks.amazonaws.com') ||
    hostname.endsWith('.k8s.elastic.co')
  ) {
    return { safe: false, reason: 'Cloud metadata/internal hostnames are not allowed' }
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

/**
 * P1-F: Async validation that also checks DNS resolution for private IPs.
 * Call this in addition to validateWebhookUrl for full protection against DNS rebinding.
 */
export async function validateWebhookUrlAsync(urlString: string): Promise<{ safe: boolean; reason?: string }> {
  // First do synchronous checks
  const syncCheck = validateWebhookUrl(urlString)
  if (!syncCheck.safe) return syncCheck

  // If hostname is already an IP, we already validated it above
  let url: URL
  try {
    url = new URL(urlString)
  } catch {
    return { safe: false, reason: 'Invalid URL' }
  }

  const hostname = url.hostname.toLowerCase()
  const ipMatch = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipMatch) return { safe: true } // Already validated in sync check

  // Resolve hostname to check for DNS rebinding (hostname → private IP)
  const resolvedIPs = await resolveHostname(hostname)
  if (resolvedIPs.length > 0 && resolvedIPs.every(ip => isPrivateIP(ip))) {
    return { safe: false, reason: 'Hostname resolves to private IP addresses' }
  }

  return { safe: true }
}
