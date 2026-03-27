// lib/response-rate-limit.ts — Rate limit for POST /api/responses (10 req/min per IP)
// Uses Supabase persistent rate limiting via check_rate_limit RPC with in-memory fallback.
//
// ARCHITECTURE NOTE:
// Primary: Supabase RPC check_rate_limit (persistent, works across serverless invocations)
// Fallback: In-memory Map (per-isolate, resets on cold start — best-effort only)
//
// The Supabase RPC uses an atomic upsert with sliding window, so it's safe for
// concurrent requests. In-memory is only used when RPC is unavailable.
//
// TODO [SCALE]: For high-traffic forms (>500 submissions/min), migrate to Upstash Redis:
//   npm install @upstash/ratelimit @upstash/redis
//   Benefits: sub-ms latency, no DB load, sliding window built-in.

import { createPublicClient } from '@/lib/supabase/public'

const WINDOW_MS = 60_000
const MAX_REQUESTS = 10
const MAX_STORE_SIZE = 50_000 // Prevent unbounded memory growth

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
    // Prevent unbounded memory growth from IP spray attacks
    if (memoryStore.size >= MAX_STORE_SIZE) {
      const oldest = memoryStore.keys().next().value
      if (oldest) memoryStore.delete(oldest)
    }
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
    const rpc = supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message?: string } | null }>
    const { data, error } = await rpc('check_rate_limit', {
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
