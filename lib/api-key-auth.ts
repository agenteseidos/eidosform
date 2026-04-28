// lib/api-key-auth.ts — Shared API key authentication for v1 endpoints
// Centralizes auth logic to avoid duplication between /api/v1/forms and /api/v1/forms/[id]

import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { checkRateLimitAsync } from '@/lib/rate-limit'

export type ApiAuthSuccess = { ok: true; userId: string; plan: string; apiKey: string }
export type ApiAuthFailure = { ok: false; status: 401 | 429; error: string; retryAfter?: number }
export type ApiAuthResult = ApiAuthSuccess | ApiAuthFailure

type ApiKeyProfile = { id: string; plan: string; api_key_hash?: string | null }

/**
 * Authenticate an API v1 request via X-API-Key or Authorization: Bearer header.
 * Validates:
 *   1. Key format (must start with 'ek_' prefix)
 *   2. Key exists in profiles table
 *   3. User has professional or enterprise plan
 *   4. Rate limit not exceeded (100 req/min per key)
 */
export async function authenticateApiKey(req: NextRequest): Promise<ApiAuthResult> {
  // Extract API key from headers
  let apiKey = req.headers.get('x-api-key')

  if (!apiKey) {
    const authHeader = req.headers.get('authorization')
    if (authHeader?.startsWith('Bearer ')) {
      apiKey = authHeader.slice(7)
    }
  }

  if (!apiKey) {
    return { ok: false, status: 401, error: 'Unauthorized. Provide a valid X-API-Key header.' }
  }

  // Validate key format (must have ek_ prefix and minimum length)
  if (!apiKey.startsWith('ek_') || apiKey.length < 16) {
    return { ok: false, status: 401, error: 'Unauthorized. Invalid API key format.' }
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } }
  )

  const { data: profile } = await supabase
    .rpc('verify_api_key_hash', { p_api_key: apiKey })
    .single() as { data: ApiKeyProfile | null }

  let resolvedProfile: ApiKeyProfile | null = profile

  if (!resolvedProfile) {
    // Fallback: check plaintext api_key column for keys not yet migrated
    const { data: legacyProfile } = await supabase
      .from('profiles')
      .select('id, plan')
      .eq('api_key', apiKey)
.single() as { data: ApiKeyProfile | null }

    if (!legacyProfile) {
      return { ok: false, status: 401, error: 'Unauthorized. Invalid API key.' }
    }

    resolvedProfile = legacyProfile
  }

  if (resolvedProfile.plan !== 'professional' && resolvedProfile.plan !== 'enterprise') {
    return { ok: false, status: 401, error: 'Unauthorized. Professional plan required for API access.' }
  }

  // Rate limit check (100 req/min per API key)
  const limit = await checkRateLimitAsync(apiKey)
  if (!limit.allowed) {
    return {
      ok: false,
      status: 429,
      error: 'Rate limit exceeded for this API key.',
      retryAfter: Math.ceil(limit.resetIn / 1000),
    }
  }

  return { ok: true, userId: resolvedProfile.id, plan: resolvedProfile.plan, apiKey }
}
