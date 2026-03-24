import type { ProfileUpdate } from '@/lib/database.types'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// POST /api/settings/api-key — gerar/regenerar API key
export async function POST(req: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Verificar plano Professional
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', user.id)
    .single() as { data: { plan: string } | null }

  if (!profile || (profile.plan !== 'professional' && profile.plan !== 'enterprise')) {
    return NextResponse.json(
      { error: 'API key access requires Professional or Enterprise plan' },
      { status: 403 }
    )
  }

  // Gerar nova API key
  const { data: keyData } = await supabase.rpc('generate_api_key') as { data: string | null }
  const newKey = keyData ?? ('ek_' + Array.from(crypto.getRandomValues(new Uint8Array(24))).map(b => b.toString(16).padStart(2, '0')).join(''))

  const { error: updateError } = await supabase
    .from('profiles')
    .update({ api_key: newKey, api_key_created_at: new Date().toISOString() } as ProfileUpdate)
    .eq('id', user.id)

  if (updateError) {
    return NextResponse.json({ error: 'Failed to generate API key' }, { status: 500 })
  }

  return NextResponse.json({ api_key: newKey })
}

// GET /api/settings/api-key — obter status da API key
export async function GET(req: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('api_key, plan')
    .eq('id', user.id)
    .single() as { data: { api_key: string | null; plan: string } | null }

  if (!profile) {
    // Create profile with free plan for new users
    const { data: newProfile, error: createError } = await supabase
      .from('profiles')
      .insert({ id: user.id, email: user.email ?? '', plan: 'free' })
      .select('api_key, plan')
      .single() as { data: { api_key: string | null; plan: string } | null, error: unknown }

    if (createError || !newProfile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    return NextResponse.json({
      has_api_key: false,
      api_key_preview: null,
      plan: newProfile.plan,
    })
  }

  const maskedKey = profile.api_key
    ? profile.api_key.slice(0, 8) + '*'.repeat(Math.max(0, profile.api_key.length - 12)) + profile.api_key.slice(-4)
    : null

  return NextResponse.json({
    has_api_key: !!profile.api_key,
    api_key_preview: maskedKey,
    plan: profile.plan,
  })
}
