import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { checkRateLimitAsync } from '@/lib/rate-limit'

// API pública: CORS aberto para permitir chamadas de qualquer domínio
function getAllowedOrigin(): string {
  return '*'
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': getAllowedOrigin(),
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, Authorization',
  'Access-Control-Max-Age': '86400',
}

// OPTIONS /api/v1/forms — CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}


// Autenticar via X-API-Key header
async function authenticateApiKey(req: NextRequest): Promise<
  | { ok: true; userId: string; plan: string }
  | { ok: false; status: 401 | 429; error: string; retryAfter?: number }
> {
  // Tenta X-API-Key primeiro (retrocompatível)
  let apiKey = req.headers.get('x-api-key')

  // Fallback: Authorization: Bearer <api_key>
  if (!apiKey) {
    const authHeader = req.headers.get('authorization')
    if (authHeader?.startsWith('Bearer ')) {
      apiKey = authHeader.slice(7)
    }
  }

  if (!apiKey) {
    return { ok: false, status: 401, error: 'Unauthorized. Provide a valid X-API-Key header.' }
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } }
  )

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, plan, api_key')
    .eq('api_key', apiKey)
    .single() as { data: { id: string; plan: string; api_key: string } | null }

  if (!profile) {
    return { ok: false, status: 401, error: 'Unauthorized. Invalid API key.' }
  }

  if (profile.plan !== 'professional' && profile.plan !== 'enterprise') {
    return { ok: false, status: 401, error: 'Unauthorized. Professional plan required.' }
  }

  const limit = await checkRateLimitAsync(apiKey)
  if (!limit.allowed) {
    return {
      ok: false,
      status: 429,
      error: 'Rate limit exceeded for this API key.',
      retryAfter: Math.ceil(limit.resetIn / 1000),
    }
  }

  return { ok: true, userId: profile.id, plan: profile.plan }
}

// GET /api/v1/forms — listar formulários do usuário autenticado por API key
export async function GET(req: NextRequest) {
  const auth = await authenticateApiKey(req)
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error, retryAfter: auth.retryAfter },
      { status: auth.status, headers: CORS_HEADERS }
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
    return NextResponse.json({ error: 'Failed to fetch forms' }, { status: 500, headers: CORS_HEADERS })
  }

  return NextResponse.json({
    forms,
    pagination: {
      page,
      limit,
      total: count ?? 0,
      total_pages: Math.ceil((count ?? 0) / limit),
    },
  }, { headers: CORS_HEADERS })
}
