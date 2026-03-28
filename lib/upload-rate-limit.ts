import { createPublicClient } from '@/lib/supabase/public'

const WINDOW_MS = 60_000
const MAX_REQUESTS = 10
const MAX_STORE_SIZE = 20_000

interface RateLimitEntry {
  count: number
  windowStart: number
}

const memoryStore = new Map<string, RateLimitEntry>()

if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of memoryStore) {
      if (now - entry.windowStart > WINDOW_MS) memoryStore.delete(key)
    }
  }, 60_000)
}

function checkMemoryFallback(key: string) {
  const now = Date.now()
  const entry = memoryStore.get(key)

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    if (memoryStore.size >= MAX_STORE_SIZE) {
      const oldest = memoryStore.keys().next().value
      if (oldest) memoryStore.delete(oldest)
    }
    memoryStore.set(key, { count: 1, windowStart: now })
    return { allowed: true, remaining: MAX_REQUESTS - 1, resetIn: WINDOW_MS }
  }

  if (entry.count >= MAX_REQUESTS) {
    return { allowed: false, remaining: 0, resetIn: WINDOW_MS - (now - entry.windowStart) }
  }

  entry.count++
  return { allowed: true, remaining: MAX_REQUESTS - entry.count, resetIn: WINDOW_MS - (now - entry.windowStart) }
}

export async function checkUploadRateLimitAsync(userId: string) {
  try {
    const supabase = createPublicClient()
    const rpc = supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message?: string } | null }>

    const { data, error } = await rpc('check_rate_limit', {
      p_key: `upload:${userId}`,
      p_window_ms: WINDOW_MS,
      p_max_requests: MAX_REQUESTS,
    })

    if (error || !data || !Array.isArray(data) || data.length === 0) {
      return checkMemoryFallback(userId)
    }

    const row = data[0] as { allowed: boolean; current_count: number; reset_in_ms: number }
    return {
      allowed: row.allowed,
      remaining: Math.max(0, MAX_REQUESTS - row.current_count),
      resetIn: row.reset_in_ms ?? WINDOW_MS,
    }
  } catch {
    return checkMemoryFallback(userId)
  }
}
