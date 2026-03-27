// lib/response-rate-limit.ts — Rate limit for POST /api/responses (10 req/min per IP)
// Uses Supabase persistent rate limiting with in-memory fallback for cold starts

import { createPublicClient } from '@/lib/supabase/public'

const WINDOW_MS = 60_000
const MAX_REQUESTS = 10

// In-memory fallback (works within same invocation only on serverless)
interface RateLimitEntry {
  count: number
  windowStart: number
}
const memoryStore = new Map<string, RateLimitEntry>()

// Cleanup old in-memory entries every 60s (only relevant if long-running)
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of memoryStore) {
      if (now - entry.windowStart > WINDOW_MS) memoryStore.delete(key)
    }
  }, 60_000)
}

function checkMemoryFallback(ip: string): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now()
  const entry = memoryStore.get(ip)

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    memoryStore.set(ip, { count: 1, windowStart: now })
    return { allowed: true, remaining: MAX_REQUESTS - 1, resetIn: WINDOW_MS }
  }

  if (entry.count >= MAX_REQUESTS) {
    const resetIn = WINDOW_MS - (now - entry.windowStart)
    return { allowed: false, remaining: 0, resetIn }
  }

  entry.count++
  return { allowed: true, remaining: MAX_REQUESTS - entry.count, resetIn: WINDOW_MS - (now - entry.windowStart) }
}

export async function checkResponseRateLimitAsync(ip: string): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
  try {
    const supabase = createPublicClient()
    const { data, error } = await supabase.rpc('check_rate_limit', {
      p_key: `resp:${ip}`,
      p_window_ms: WINDOW_MS,
      p_max_requests: MAX_REQUESTS,
    })

    if (error || !data || !Array.isArray(data) || data.length === 0) {
      // Fallback to in-memory if Supabase function doesn't exist yet
      return checkMemoryFallback(ip)
    }

    const row = data[0] as { allowed: boolean; current_count: number; reset_in_ms: number }
    return {
      allowed: row.allowed,
      remaining: Math.max(0, MAX_REQUESTS - row.current_count),
      resetIn: row.reset_in_ms ?? WINDOW_MS,
    }
  } catch {
    // Fallback to in-memory on any error
    return checkMemoryFallback(ip)
  }
}

// Synchronous version kept for backward compat (uses memory only)
export function checkResponseRateLimit(ip: string): { allowed: boolean; remaining: number; resetIn: number } {
  return checkMemoryFallback(ip)
}
