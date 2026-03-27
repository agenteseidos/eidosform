// lib/rate-limit.ts — Rate limiter for API v1 endpoints (100 req/min per API key)
// Uses Supabase persistent rate limiting with in-memory fallback
// TODO: For higher scale, migrate to Upstash Redis (@upstash/ratelimit)

import { createPublicClient } from '@/lib/supabase/public'

const WINDOW_MS = 60 * 1000 // 1 minute
const MAX_REQUESTS = 100

// In-memory fallback
interface RateLimitEntry {
  count: number
  windowStart: number
}
const store = new Map<string, RateLimitEntry>()

function checkMemoryFallback(key: string): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now()
  const entry = store.get(key)

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    store.set(key, { count: 1, windowStart: now })
    return { allowed: true, remaining: MAX_REQUESTS - 1, resetIn: WINDOW_MS }
  }

  if (entry.count >= MAX_REQUESTS) {
    const resetIn = WINDOW_MS - (now - entry.windowStart)
    return { allowed: false, remaining: 0, resetIn }
  }

  entry.count++
  return { allowed: true, remaining: MAX_REQUESTS - entry.count, resetIn: WINDOW_MS - (now - entry.windowStart) }
}

// Synchronous version (in-memory only, kept for backward compat)
export function checkRateLimit(key: string): { allowed: boolean; remaining: number; resetIn: number } {
  return checkMemoryFallback(key)
}

// Async version using Supabase persistent store
export async function checkRateLimitAsync(key: string): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
  try {
    const supabase = createPublicClient()
    const { data, error } = await supabase.rpc('check_rate_limit', {
      p_key: `api:${key}`,
      p_window_ms: WINDOW_MS,
      p_max_requests: MAX_REQUESTS,
    })

    if (error || !data || !Array.isArray(data) || data.length === 0) {
      return checkMemoryFallback(key)
    }

    const row = data[0] as { allowed: boolean; current_count: number; reset_in_ms: number }
    return {
      allowed: row.allowed,
      remaining: Math.max(0, MAX_REQUESTS - row.current_count),
      resetIn: row.reset_in_ms ?? WINDOW_MS,
    }
  } catch {
    return checkMemoryFallback(key)
  }
}
