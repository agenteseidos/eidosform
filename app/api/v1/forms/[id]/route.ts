import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { checkRateLimit } from '@/lib/rate-limit'

// API pública: CORS aberto para permitir chamadas de qualquer domínio
function getAllowedOrigin(): string {
  return '*'
}

interface RouteParams {
  params: Promise<{ id: string }>
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': getAllowedOrigin(),
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, Authorization',
  'Access-Control-Max-Age': '86400',
}

// OPTIONS — CORS preflight
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

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } }
  )

  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return null

  const serviceClient = getServiceClient()
  const { data: profile } = await serviceClient
    .from('profiles')
    .select('plan')
    .eq('user_id', user.id)
    .single() as { data: { plan: string } | null }

  return { userId: user.id, plan: profile?.plan ?? 'free' }
}

async function authenticateApiKey(req: NextRequest): Promise<{ userId: string; plan: string; apiKey: string } | null> {
  const apiKey = req.headers.get('x-api-key')
  if (!apiKey) return null

  const supabase = getServiceClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('user_id, plan, api_key')
    .eq('api_key', apiKey)
    .single() as { data: { user_id: string; plan: string; api_key: string } | null }

  if (!profile) return null
  if (profile.plan !== 'professional' && profile.plan !== 'enterprise') return null

  const limit = checkRateLimit(apiKey)
  if (!limit.allowed) return null

  return { userId: profile.user_id, plan: profile.plan, apiKey }
}

// BUG-003: Try API key first (cross-account), then Bearer JWT (own account)
async function authenticate(req: NextRequest): Promise<{ userId: string; plan: string } | null> {
  return (await authenticateApiKey(req)) ?? (await authenticateBearer(req))
}

// GET /api/v1/forms/[id]
export async function GET(req: NextRequest, { params }: RouteParams) {
  const auth = await authenticate(req)
  if (!auth) {
    return NextResponse.json(
      { error: 'Unauthorized. Provide a valid X-API-Key (Professional plan) or Bearer JWT token.' },
      { status: 401, headers: CORS_HEADERS }
    )
  }

  const { id } = await params
  const supabase = getServiceClient()
  const url = new URL(req.url)
  const subpath = url.searchParams.get('resource')

  // GET /api/v1/forms/[id]?resource=responses
  if (subpath === 'responses') {
    const page = parseInt(url.searchParams.get('page') ?? '1')
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20'), 100)
    const offset = (page - 1) * limit

    const { data: form } = await supabase
      .from('forms')
      .select('id')
      .eq('id', id)
      .eq('user_id', auth.userId)
      .single()

    if (!form) {
      return NextResponse.json(
        { error: 'Form not found' },
        { status: 404, headers: CORS_HEADERS }
      )
    }

    const { data: responses, count, error } = await supabase
      .from('responses')
      .select('id, answers, completed, last_question_answered, created_at, updated_at', { count: 'exact' })
      .eq('form_id', id)
      .eq('completed', true)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch responses' },
        { status: 500, headers: CORS_HEADERS }
      )
    }

    return NextResponse.json(
      {
        responses,
        pagination: {
          page,
          limit,
          total: count ?? 0,
          total_pages: Math.ceil((count ?? 0) / limit),
        },
      },
      { headers: CORS_HEADERS }
    )
  }

  // GET /api/v1/forms/[id] — form details
  const { data: formData, error } = await supabase
    .from('forms')
    .select('id, title, slug, status, questions, settings, created_at, updated_at')
    .eq('id', id)
    .eq('user_id', auth.userId)
    .single()

  if (error || !formData) {
    return NextResponse.json(
      { error: 'Form not found' },
      { status: 404, headers: CORS_HEADERS }
    )
  }

  return NextResponse.json({ form: formData }, { headers: CORS_HEADERS })
}

// POST /api/v1/forms/[id]
export async function POST(req: NextRequest, { params }: RouteParams) {
  const auth = await authenticate(req)
  if (!auth) {
    return NextResponse.json(
      { error: 'Unauthorized. Provide a valid X-API-Key (Professional plan) or Bearer JWT token.' },
      { status: 401, headers: CORS_HEADERS }
    )
  }

  const { id } = await params
  const supabase = getServiceClient()
  const body = await req.json()
  const { answers, completed = true } = body

  if (!answers || typeof answers !== 'object') {
    return NextResponse.json(
      { error: 'answers is required' },
      { status: 400, headers: CORS_HEADERS }
    )
  }

  const { data: form } = await supabase
    .from('forms')
    .select('id, user_id, status')
    .eq('id', id)
    .eq('user_id', auth.userId)
    .eq('status', 'published')
    .single()

  if (!form) {
    return NextResponse.json(
      { error: 'Form not found or not published' },
      { status: 404, headers: CORS_HEADERS }
    )
  }

  const { data: response, error } = await supabase
    .from('responses')
    .insert({ form_id: id, answers, completed } as never)
    .select('id')
    .single() as { data: { id: string } | null; error: unknown }

  if (error || !response) {
    return NextResponse.json(
      { error: 'Failed to save response' },
      { status: 500, headers: CORS_HEADERS }
    )
  }

  const answerItems = Object.entries(answers as Record<string, unknown>).map(([questionId, value]) => ({
    response_id: response.id,
    question_id: questionId,
    value: Array.isArray(value) ? value.join(', ') : String(value ?? ''),
  }))

  if (answerItems.length > 0) {
    await supabase.from('answer_items').insert(answerItems as never)
  }

  return NextResponse.json({ response_id: response.id }, { status: 201, headers: CORS_HEADERS })
}
