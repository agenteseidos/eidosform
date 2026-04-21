import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { authenticateApiKey } from '@/lib/api-key-auth'

const ALLOWED_ORIGINS = [
  process.env.NEXT_PUBLIC_APP_URL || 'https://eidosform.com.br',
  'https://eidosform.com.br',
].filter(Boolean)

function getCorsHeaders(origin?: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin)
  return {
    'Access-Control-Allow-Origin': allowed ? origin! : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
}

// OPTIONS /api/v1/forms — CORS preflight
export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get('origin')
  return new NextResponse(null, { status: 204, headers: getCorsHeaders(origin) })
}

// GET /api/v1/forms — listar formulários do usuário autenticado por API key
export async function GET(req: NextRequest) {
  const origin = req.headers.get('origin')
  const auth = await authenticateApiKey(req)
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error, retryAfter: auth.retryAfter },
      { status: auth.status, headers: getCorsHeaders(origin) }
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
    return NextResponse.json({ error: 'Failed to fetch forms' }, { status: 500, headers: getCorsHeaders(origin) })
  }

  return NextResponse.json({
    forms,
    pagination: {
      page,
      limit,
      total: count ?? 0,
      total_pages: Math.ceil((count ?? 0) / limit),
    },
  }, { headers: getCorsHeaders(origin) })
}
