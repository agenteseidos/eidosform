import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServerClient } from '@supabase/ssr'
import { checkRateLimit } from '@/lib/rate-limit'

// Autenticar via X-API-Key header
async function authenticateApiKey(req: NextRequest): Promise<{ userId: string; plan: string } | null> {
  const apiKey = req.headers.get('x-api-key')
  if (!apiKey) return null

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } }
  )

  const { data: profile } = await supabase
    .from('profiles')
    .select('user_id, plan, api_key')
    .eq('api_key', apiKey)
    .single() as { data: { user_id: string; plan: string; api_key: string } | null }

  if (!profile) return null

  // Verificar plano Professional
  if (profile.plan !== 'professional' && profile.plan !== 'enterprise') {
    return null
  }

  // Rate limit por API key
  const limit = checkRateLimit(apiKey)
  if (!limit.allowed) return null

  return { userId: profile.user_id, plan: profile.plan }
}

// GET /api/v1/forms — listar formulários do usuário autenticado por API key
export async function GET(req: NextRequest) {
  const auth = await authenticateApiKey(req)
  if (!auth) {
    return NextResponse.json(
      { error: 'Unauthorized. Provide a valid X-API-Key header. Professional plan required.' },
      { status: 401 }
    )
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } }
  )

  const url = new URL(req.url)
  const page = parseInt(url.searchParams.get('page') ?? '1')
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20'), 100)
  const offset = (page - 1) * limit

  const { data: forms, error, count } = await supabase
    .from('forms')
    .select('id, title, slug, status, created_at, updated_at', { count: 'exact' })
    .eq('user_id', auth.userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch forms' }, { status: 500 })
  }

  return NextResponse.json({
    forms,
    pagination: {
      page,
      limit,
      total: count ?? 0,
      total_pages: Math.ceil((count ?? 0) / limit),
    },
  })
}
