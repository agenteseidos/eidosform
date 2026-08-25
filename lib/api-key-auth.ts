// lib/api-key-auth.ts — Shared API key authentication for v1 endpoints
// Centralizes auth logic to avoid duplication between /api/v1/forms and /api/v1/forms/[id]

import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { createHmac } from 'node:crypto'
import { getEffectivePlan } from '@/lib/plans'
import { PLANS } from '@/lib/plan-definitions'

export type ApiAuthSuccess = { ok: true; userId: string; plan: string; apiKey: string }
export type ApiAuthFailure = { ok: false; status: 401 | 429; error: string; retryAfter?: number }
export type ApiAuthResult = ApiAuthSuccess | ApiAuthFailure

type ApiKeyProfile = { id: string; plan: string; api_key_hash?: string | null }

/**
 * Authenticate an API v1 request via X-API-Key or Authorization: Bearer header.
 * Validates:
 *   1. Key format (must start with 'ek_' prefix)
 *   2. Key exists in profiles table
 *   3. User has professional plan
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

  if (!profile) {
    return { ok: false, status: 401, error: 'Unauthorized. Invalid API key.' }
  }

  const resolvedProfile = profile

  // Considera EXPIRAÇÃO: a RPC retorna só (id, plan), então buscamos plan_expires_at e
  // usamos getEffectivePlan — plano pago vencido vira 'free' e perde o acesso à API.
  // (P1, audit Codex 2026-06-08.)
  const { data: planRow } = await supabase
    .from('profiles')
    .select('plan, plan_expires_at, plan_status, asaas_subscription_id')
    .eq('id', resolvedProfile.id)
    .single()
  const effectivePlan = getEffectivePlan(planRow ?? { plan: resolvedProfile.plan })

  // Lê o flag oficial (PLANS[].apiAccess) em vez de comparar com 'professional':
  // um plano novo com apiAccess:true entra sem tocar aqui (D8, auditoria 2026-07-28).
  if (!PLANS[effectivePlan]?.apiAccess) {
    return { ok: false, status: 401, error: 'Unauthorized. Professional plan required for API access.' }
  }

  // Rate limit check (100 req/min per API key)
  //
  // A chave é HMAC da API key, nunca a key CRUA (E01-S1-002, fechado na triagem do D-07).
  // A tabela de rate limit persiste a chave como texto legível: usar a API key direto a
  // reintroduzia em claro no banco — o mesmo segredo que o resto do arquivo só trata hasheado.
  // Mesma técnica do D8/D11: HMAC com segredo do servidor, porque o espaço de busca de uma key
  // vazada em backup é pequeno demais para hash puro.
  const apiKeyRef = createHmac('sha256', process.env.INTERNAL_API_SECRET ?? 'fallback')
    .update(`apikey:${apiKey}`)
    .digest('hex')
    .slice(0, 32)
  const limit = await checkRateLimitAsync(`apikey:${apiKeyRef}`)
  if (!limit.allowed) {
    return {
      ok: false,
      status: 429,
      error: 'Rate limit exceeded for this API key.',
      retryAfter: Math.ceil(limit.resetIn / 1000),
    }
  }

  return { ok: true, userId: resolvedProfile.id, plan: effectivePlan, apiKey }
}
