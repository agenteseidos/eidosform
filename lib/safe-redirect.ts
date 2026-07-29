/** Aceita somente destinos locais absolutos; bloqueia //host e URLs externas. */
export function safeLocalRedirect(value: unknown, fallback = '/forms'): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return fallback
  try {
    const parsed = new URL(trimmed, 'https://eidosform.local')
    if (parsed.origin !== 'https://eidosform.local') return fallback
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return fallback
  }
}

export function withCheckoutCycle(path: string, cycle: 'monthly' | 'yearly'): string {
  const safe = safeLocalRedirect(path, '')
  if (!safe) return ''
  const parsed = new URL(safe, 'https://eidosform.local')
  parsed.searchParams.set('cycle', cycle)
  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}
