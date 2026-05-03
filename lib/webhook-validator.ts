/**
 * lib/webhook-validator.ts — SSRF protection for webhook URLs
 * Shared between form webhook endpoint and webhook dispatcher.
 * Hardened against DNS rebinding by pre-resolving hostname.
 */

// Simple cache to avoid repeated DNS lookups for the same hostname
const dnsCache = new Map<string, { ips: string[]; expiresAt: number }>()
const DNS_CACHE_TTL_MS = 60_000

type DnsResult =
  | { available: false }           // dns module unavailable (Edge Runtime) — allow best-effort
  | { available: true; ips: string[] } // resolution result (empty = failed or NXDOMAIN)

/**
 * Attempt to resolve hostname to IPv4 addresses using Node.js dns module.
 * Returns { available: false } in Edge Runtime where the dns module is absent.
 * Returns { available: true, ips: [] } when resolution fails (NXDOMAIN, timeout, etc.).
 */
async function resolveHostname(hostname: string): Promise<DnsResult> {
  // Check cache first
  const cached = dnsCache.get(hostname)
  if (cached && cached.expiresAt > Date.now()) {
    return { available: true, ips: cached.ips }
  }

  try {
    // Dynamic import to handle Edge Runtime gracefully
    const dns = await import('dns').catch(() => null)
    if (!dns || !dns.promises || typeof dns.promises.resolve4 !== 'function') {
      return { available: false }
    }

    const addresses = await dns.promises.resolve4(hostname)
    dnsCache.set(hostname, { ips: addresses, expiresAt: Date.now() + DNS_CACHE_TTL_MS })
    return { available: true, ips: addresses }
  } catch {
    // DNS available but resolution failed (NXDOMAIN, timeout, etc.) — return empty to trigger block
    return { available: true, ips: [] }
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
 * Async validation that also checks DNS resolution for private IPs and DNS rebinding.
 * DNS failure (module unavailable) → allow best-effort (Edge Runtime).
 * DNS failure (resolution error / empty result) → block (cannot confirm host is public).
 */
export async function validateWebhookUrlAsync(urlString: string): Promise<{ safe: boolean; reason?: string }> {
  // First do synchronous checks
  const syncCheck = validateWebhookUrl(urlString)
  if (!syncCheck.safe) return syncCheck

  let url: URL
  try {
    url = new URL(urlString)
  } catch {
    return { safe: false, reason: 'Invalid URL' }
  }

  const hostname = url.hostname.toLowerCase()
  // If hostname is already a numeric IP, it was validated in the sync check
  const ipMatch = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipMatch) return { safe: true }

  // Resolve hostname to detect DNS rebinding (hostname → private IP)
  const result = await resolveHostname(hostname)

  if (!result.available) {
    // dns module not available (Edge Runtime) — allow best-effort
    return { safe: true }
  }

  // DNS available but resolution returned no records — block (P2-INT2: DNS race fix)
  if (result.ips.length === 0) {
    return { safe: false, reason: 'Hostname could not be resolved — refusing for safety' }
  }

  if (result.ips.every(ip => isPrivateIP(ip))) {
    return { safe: false, reason: 'Hostname resolves to private IP addresses' }
  }

  return { safe: true }
}
