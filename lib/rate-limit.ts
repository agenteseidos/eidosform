// lib/rate-limit.ts — Rate limiter for API v1 endpoints (100 req/min per API key)
// Uses Supabase persistent rate limiting via check_rate_limit RPC with in-memory fallback.
//
// ARCHITECTURE NOTE:
// The primary rate limit is Supabase RPC (persistent across serverless invocations).
// In-memory fallback only applies if the RPC fails or doesn't exist yet.
// On serverless (Vercel), in-memory state is per-isolate and may reset on cold starts,
// so it provides best-effort protection only.
//
// TODO [SCALE]: For higher throughput (>1000 req/s), migrate to Upstash Redis:
//   npm install @upstash/ratelimit @upstash/redis
//   Use sliding window algorithm with Upstash for sub-ms latency.
//   Current Supabase RPC adds ~20-50ms per check.

import { createPublicClient } from '@/lib/supabase/public'

const WINDOW_MS = 60 * 1000 // 1 minute
const MAX_REQUESTS = 100
const MAX_STORE_SIZE = 10_000 // Prevent unbounded memory growth

// In-memory fallback
interface RateLimitEntry {
  count: number
  windowStart: number
}
const store = new Map<string, RateLimitEntry>()

// Cleanup stale entries periodically (prevents memory leak in long-running processes)
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of store) {
      if (now - entry.windowStart > WINDOW_MS) store.delete(key)
    }
  }, 60_000)
}

function checkMemoryFallback(key: string): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now()
  const entry = store.get(key)

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    // Prevent unbounded memory growth
    if (store.size >= MAX_STORE_SIZE) {
      const oldest = store.keys().next().value
      if (oldest) store.delete(oldest)
    }
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
    const rpc = supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message?: string } | null }>
    const { data, error } = await rpc('check_rate_limit', {
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
