import type { ProfileUpdate } from '@/lib/database.types'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { getEffectivePlan } from '@/lib/plans'

// POST /api/settings/api-key — gerar/regenerar API key
export async function POST() {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  // Verificar plano Professional (considerando EXPIRAÇÃO — P1, Codex 2026-06-08).
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, plan_expires_at')
    .eq('id', user.id)
    .single() as { data: { plan: string; plan_expires_at: string | null } | null }

  const effectivePlan = getEffectivePlan(profile)
  if (effectivePlan !== 'professional' && (effectivePlan as string) !== 'enterprise') {
    return NextResponse.json(
      { error: 'Acesso à API key requer plano Professional ou Enterprise' },
      { status: 403 }
    )
  }

  // Rate limit API key operations (5 req/min per user)
  const keyLimit = await checkRateLimitAsync(`api-key-ops:${user.id}`, {
    maxAttempts: 5,
    windowMs: 60 * 1000,
  })
  if (!keyLimit.allowed) {
    return NextResponse.json(
      { error: 'Muitas operações de API key. Tente novamente mais tarde.', retryAfter: Math.ceil(keyLimit.resetIn / 1000) },
      { status: 429, headers: { 'Retry-After': Math.ceil(keyLimit.resetIn / 1000).toString() } }
    )
  }

  // Gerar nova API key (RPC generates prefixed key; fallback ensures ek_ prefix)
  const { data: keyData } = await supabase.rpc('generate_api_key') as { data: string | null }
  let newKey = keyData ?? null

  // Ensure key always has ek_ prefix (required by API v1 auth validation)
  if (!newKey || !newKey.startsWith('ek_')) {
    newKey = 'ek_' + Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map(b => b.toString(16).padStart(2, '0')).join('')
  }

  // P2-E: Store hash of API key instead of plaintext
  const { createHash } = await import('crypto')
  const keyHash = createHash('sha256').update(newKey).digest('hex')

  const { error: updateError } = await supabase
    .from('profiles')
    .update({ api_key_hash: keyHash, api_key_created_at: new Date().toISOString(), api_key: null } as ProfileUpdate)
    .eq('id', user.id)

  if (updateError) {
    return NextResponse.json({ error: 'Falha ao gerar API key' }, { status: 500 })
  }

  return NextResponse.json({ api_key: newKey })
}

// GET /api/settings/api-key — obter status da API key
export async function GET() {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('api_key_hash, plan')
    .eq('id', user.id)
    .single() as { data: { api_key_hash: string | null; plan: string } | null }

  if (!profile) {
    // Profile missing (user signed up before auto-create trigger). Use admin client
    // to bypass RLS — there is no INSERT policy for authenticated users on profiles.
    const adminSupabase = createAdminClient()
    const { data: upserted, error: upsertError } = await adminSupabase
      .from('profiles')
      .upsert(
        { id: user.id, email: user.email ?? '', plan: 'free' },
        { onConflict: 'id', ignoreDuplicates: false }
      )
      .select('api_key_hash, plan')
      .single() as { data: { api_key_hash: string | null; plan: string } | null, error: unknown }

    if (upsertError || !upserted) {
      return NextResponse.json({ has_api_key: false, api_key_preview: null, plan: 'free' })
    }

    return NextResponse.json({
      has_api_key: !!upserted.api_key_hash,
      api_key_preview: upserted.api_key_hash ? 'ek_••••••••••••' : null,
      plan: upserted.plan,
    })
  }

  // P2-E: Check api_key_hash (new) or api_key (legacy migration fallback)
  const hasKey = !!profile.api_key_hash || !!(profile as Record<string, unknown>).api_key

  return NextResponse.json({
    has_api_key: hasKey,
    api_key_preview: hasKey ? 'ek_••••••••••••' : null,
    plan: profile.plan,
  })
}

// DELETE /api/settings/api-key — revogar API key
export async function DELETE() {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  // P1 FIX: Verify plan before allowing revocation
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', user.id)
    .single() as { data: { plan: string } | null }

  if (!profile || (profile.plan !== 'professional' && profile.plan !== 'enterprise')) {
    return NextResponse.json(
      { error: 'Acesso à API key requer plano Professional ou Enterprise' },
      { status: 403 }
    )
  }

  const { error: updateError } = await supabase
    .from('profiles')
    .update({ api_key: null, api_key_hash: null, api_key_created_at: null } as ProfileUpdate)
    .eq('id', user.id)

  if (updateError) {
    return NextResponse.json({ error: 'Falha ao revogar API key' }, { status: 500 })
  }

  return NextResponse.json({ message: 'API key revogada' })
}
