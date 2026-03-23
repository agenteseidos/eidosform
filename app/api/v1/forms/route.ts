import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { checkRateLimit } from '@/lib/rate-limit'

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

function getServiceClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } }
  )
}

// BUG-003 fix: Authenticate via Bearer JWT token (Supabase JWT)
async function authenticateBearer(req: NextRequest): Promise<{ userId: string; plan: string } | null> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null

  const token = authHeader.slice(7)
  if (!token) return null

  // Use anon client to verify the JWT
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } }
  )

  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return null

  // Fetch user plan from profiles
  const serviceClient = getServiceClient()
  const { data: profile } = await serviceClient
    .from('profiles')
    .select('plan')
    .eq('user_id', user.id)
    .single() as { data: { plan: string } | null }

  return { userId: user.id, plan: profile?.plan ?? 'free' }
}

// Authenticate via X-API-Key header (Professional/Enterprise plans)
async function authenticateApiKey(req: NextRequest): Promise<{ userId: string; plan: string } | null> {
  const apiKey = req.headers.get('x-api-key')
  if (!apiKey) return null

  const supabase = getServiceClient()

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

// BUG-003: Try API key first (cross-account), then Bearer JWT (own account)
async function authenticate(req: NextRequest): Promise<{ userId: string; plan: string } | null> {
  return (await authenticateApiKey(req)) ?? (await authenticateBearer(req))
}

// GET /api/v1/forms — listar formulários do usuário autenticado
export async function GET(req: NextRequest) {
  const auth = await authenticate(req)
  if (!auth) {
    return NextResponse.json(
      { error: 'Unauthorized. Provide a valid X-API-Key (Professional plan) or Bearer JWT token.' },
      { status: 401, headers: CORS_HEADERS }
    )
  }

  const supabase = getServiceClient()

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
